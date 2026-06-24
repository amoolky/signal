import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProgramWorkbook } from "./scripts/parse-program.mjs";
import { createSignalProjectArchive, readSignalProjectArchive } from "./scripts/signal-project.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const outputDir = path.resolve(rootDir, "output");
const originalProgramPath = path.resolve(rootDir, "output/program_data.json");
const savedProgramPath = path.resolve(rootDir, "output/program_data.saved.json");
const currentProjectPath = path.resolve(rootDir, "output/current_project.signal");
const uploadDir = path.resolve(rootDir, "output/imports");
const schemaPath = path.resolve(rootDir, "input_test/program_schema.json");

export default defineConfig({
  plugins: [react(), programDataApi()],
});

function programDataApi() {
  return {
    name: "signal-program-data-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(normalizeIncomingUrl(request.url), "http://localhost");
        if (!requestUrl.pathname.startsWith("/api/")) {
          next();
          return;
        }

        try {
          if (requestUrl.pathname === "/api/program-data" && request.method === "GET") {
            await ensureSavedCopy();
            const data = await fs.readFile(savedProgramPath, "utf8");
            sendJson(response, 200, data);
            return;
          }

          if (requestUrl.pathname === "/api/program-data" && request.method === "PUT") {
            const body = await readRequestBody(request);
            const data = JSON.parse(body);
            await writeSavedProgramData(data);
            sendJson(response, 200, JSON.stringify(data));
            return;
          }

          if (requestUrl.pathname === "/api/program-data/files" && request.method === "GET") {
            const files = await listProgramDataFiles();
            sendJson(response, 200, JSON.stringify({ files }));
            return;
          }

          if (requestUrl.pathname === "/api/program-data/file" && request.method === "GET") {
            const id = requestUrl.searchParams.get("id");
            const data = await readProgramDataFileById(id);
            sendJson(response, 200, JSON.stringify(data));
            return;
          }

          if (requestUrl.pathname === "/api/program-data/import" && request.method === "POST") {
            const { file } = await readMultipartFile(request);
            assertSpreadsheetFile(file.filename);
            const workbookPath = path.resolve(uploadDir, sanitizeFileName(file.filename));
            await fs.mkdir(uploadDir, { recursive: true });
            await fs.writeFile(workbookPath, file.data);

            const data = parseProgramWorkbook({
              workbookPath,
              schemaPath,
            });
            await writeSavedProgramData(data);
            sendJson(response, 200, JSON.stringify(data));
            return;
          }

          if (requestUrl.pathname === "/api/project" && request.method === "PUT") {
            const body = await readRequestBody(request);
            const snapshot = JSON.parse(body);
            const archive = await createCurrentProjectArchive(snapshot);
            await writeSavedProgramData(snapshot.programData);
            await fs.mkdir(path.dirname(currentProjectPath), { recursive: true });
            await fs.writeFile(currentProjectPath, archive);
            sendJson(response, 200, JSON.stringify(normalizeProjectSnapshot(snapshot)));
            return;
          }

          if (requestUrl.pathname === "/api/project" && request.method === "GET") {
            const archive = await readOptionalFile(currentProjectPath);
            if (!archive) {
              sendJson(response, 404, JSON.stringify({ error: "No saved project found." }));
              return;
            }

            const snapshot = normalizeProjectSnapshot(readSignalProjectArchive(archive));
            sendJson(response, 200, JSON.stringify(snapshot));
            return;
          }

          if (requestUrl.pathname === "/api/project/export" && request.method === "POST") {
            const body = await readRequestBody(request);
            const snapshot = JSON.parse(body);
            const archive = await createCurrentProjectArchive(snapshot);
            const fileName = `${sanitizeBaseName(snapshot.programData?.project?.name || "signal-project")}.signal`;
            sendBuffer(response, 200, archive, {
              "Content-Type": "application/vnd.signal.project+zip",
              "Content-Disposition": `attachment; filename="${fileName}"`,
            });
            return;
          }

          if (requestUrl.pathname === "/api/project/import" && request.method === "POST") {
            const { file } = await readMultipartFile(request);
            assertSignalFile(file.filename);
            const importedProject = readSignalProjectArchive(file.data);
            const snapshot = normalizeProjectSnapshot(importedProject);
            await writeSavedProgramData(snapshot.programData);
            await fs.mkdir(path.dirname(currentProjectPath), { recursive: true });
            await fs.writeFile(currentProjectPath, file.data);
            sendJson(response, 200, JSON.stringify(snapshot));
            return;
          }

          sendJson(response, 405, JSON.stringify({ error: "Method not allowed" }));
        } catch (error) {
          server.config.logger.error(error);
          sendJson(response, 500, JSON.stringify({ error: error.message }));
        }
      });
    },
  };
}

function normalizeIncomingUrl(rawUrl) {
  if (!rawUrl) return "/";
  if (!rawUrl.startsWith("//")) return rawUrl;

  const normalizedPath = rawUrl.replace(/^\/+/, "");
  return normalizedPath ? `/${normalizedPath}` : "/";
}

async function writeSavedProgramData(data) {
  await fs.mkdir(path.dirname(savedProgramPath), { recursive: true });
  await fs.writeFile(savedProgramPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function createCurrentProjectArchive(snapshot) {
  const existingArchiveBuffer = await readOptionalFile(currentProjectPath);
  return createSignalProjectArchive({
    ...normalizeProjectSnapshot(snapshot),
    existingArchiveBuffer,
  });
}

async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function normalizeProjectSnapshot(snapshot) {
  if (!snapshot?.programData) {
    throw new Error("Project data is missing program data.");
  }

  return {
    programData: snapshot.programData,
    tableState: {
      program: {
        sortConfig: snapshot.tableState?.program?.sortConfig ?? null,
        advancedSortConfig: snapshot.tableState?.program?.advancedSortConfig ?? null,
      },
    },
  };
}

async function listProgramDataFiles() {
  const files = [];
  const seenIds = new Set();

  const addFile = (file) => {
    if (!file?.id || seenIds.has(file.id)) return;
    seenIds.add(file.id);
    files.push(file);
  };

  for (const outputFile of await listOutputProgramDataFiles()) {
    addFile(outputFile);
  }

  const archiveBuffer = await readOptionalFile(currentProjectPath);
  if (archiveBuffer) {
    const project = readSignalProjectArchive(archiveBuffer, { includeEntries: true });
    for (const version of project.manifest?.program_versions ?? []) {
      if (!version?.id || !version?.path || !project.entries.has(version.path)) continue;
      const data = JSON.parse(project.entries.get(version.path).toString("utf8"));
      if (!isProgramData(data)) continue;

      addFile({
        id: `project:${version.id}`,
        label: version.label || getProgramDataTitle(data, version.path),
        path: version.path,
        source: "project",
        createdAt: version.created_at ?? null,
        schemaVersion: data.schema_version ?? null,
      });
    }
  }

  return files;
}

async function listOutputProgramDataFiles() {
  let entries = [];
  try {
    entries = await fs.readdir(outputDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;

    const filePath = path.join(outputDir, entry.name);
    const data = await readOptionalJsonFile(filePath);
    if (!isProgramData(data)) continue;

    files.push({
      id: `output:${entry.name}`,
      label: getProgramDataTitle(data, entry.name),
      path: toProjectRelativePath(filePath),
      source: "output",
      createdAt: data.project?.updated_at ?? data.project?.created_at ?? null,
      schemaVersion: data.schema_version ?? null,
    });
  }

  return files;
}

async function readProgramDataFileById(id) {
  if (!id) throw new Error("Program data file id is required.");

  if (id.startsWith("output:")) {
    const fileName = id.slice("output:".length);
    if (path.basename(fileName) !== fileName || path.extname(fileName).toLowerCase() !== ".json") {
      throw new Error("Invalid output program data file id.");
    }

    const data = await readOptionalJsonFile(path.join(outputDir, fileName));
    if (!isProgramData(data)) throw new Error("The selected output file is not parsed program data.");
    return data;
  }

  if (id.startsWith("project:")) {
    const versionId = id.slice("project:".length);
    const archiveBuffer = await readOptionalFile(currentProjectPath);
    if (!archiveBuffer) throw new Error("No saved project found.");

    const project = readSignalProjectArchive(archiveBuffer, { includeEntries: true });
    const version = project.manifest?.program_versions?.find((entry) => entry.id === versionId);
    if (!version?.path || !project.entries.has(version.path)) {
      throw new Error("The selected project program data file was not found.");
    }

    const data = JSON.parse(project.entries.get(version.path).toString("utf8"));
    if (!isProgramData(data)) throw new Error("The selected project file is not parsed program data.");
    return data;
  }

  throw new Error("Unknown program data file id.");
}

async function readOptionalJsonFile(filePath) {
  const buffer = await readOptionalFile(filePath);
  if (!buffer) return null;
  return JSON.parse(buffer.toString("utf8"));
}

function isProgramData(data) {
  return Boolean(data && typeof data === "object" && data.project && Array.isArray(data.program_items));
}

function getProgramDataTitle(data, fallbackLabel) {
  return String(data?.project?.name ?? fallbackLabel ?? "Untitled Project").trim() || "Untitled Project";
}

function toProjectRelativePath(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

async function ensureSavedCopy() {
  try {
    await fs.access(savedProgramPath);
  } catch {
    await fs.mkdir(path.dirname(savedProgramPath), { recursive: true });
    await fs.copyFile(originalProgramPath, savedProgramPath);
  }
}

function readRequestBody(request) {
  return readRequestBuffer(request).then((buffer) => buffer.toString("utf8"));
}

function readRequestBuffer(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readMultipartFile(request) {
  const contentType = request.headers["content-type"] ?? "";
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new Error("The upload request is missing a multipart boundary.");
  }

  const fields = parseMultipartForm(await readRequestBuffer(request), boundaryMatch[1].replace(/^"|"$/g, ""));
  const file = fields.find((field) => field.filename && field.data.length > 0);
  if (!file) {
    throw new Error("No file was uploaded.");
  }
  return { file };
}

function parseMultipartForm(buffer, boundaryText) {
  const fields = [];
  const boundary = Buffer.from(`--${boundaryText}`);
  let offset = 0;

  while (offset < buffer.length) {
    const boundaryIndex = buffer.indexOf(boundary, offset);
    if (boundaryIndex < 0) break;

    const afterBoundary = boundaryIndex + boundary.length;
    if (buffer[afterBoundary] === 45 && buffer[afterBoundary + 1] === 45) break;

    let partStart = afterBoundary;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd < 0) break;

    const headers = buffer.toString("utf8", partStart, headerEnd);
    const nextBoundary = buffer.indexOf(Buffer.from(`\r\n--${boundaryText}`), headerEnd + 4);
    if (nextBoundary < 0) break;

    const disposition = headers.match(/content-disposition:\s*form-data;\s*([^\r\n]+)/i)?.[1] ?? "";
    const name = readDispositionValue(disposition, "name");
    const filename = readDispositionValue(disposition, "filename");
    fields.push({
      name,
      filename,
      data: buffer.subarray(headerEnd + 4, nextBoundary),
    });
    offset = nextBoundary + 2;
  }

  return fields;
}

function readDispositionValue(disposition, key) {
  const match = disposition.match(new RegExp(`${key}="([^"]*)"`, "i"));
  return match ? match[1] : "";
}

function assertSpreadsheetFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension !== ".xlsx" && extension !== ".xlsm") {
    throw new Error("Please import an .xlsx or .xlsm Excel file.");
  }
}

function assertSignalFile(fileName) {
  if (path.extname(fileName).toLowerCase() !== ".signal") {
    throw new Error("Please import a .signal project file.");
  }
}

function sanitizeFileName(fileName) {
  const baseName = path.basename(fileName).replace(/[^\w .()-]+/g, "_").trim();
  return `${Date.now()}-${baseName || "import.xlsx"}`;
}

function sanitizeBaseName(value) {
  return String(value)
    .trim()
    .replace(/[^\w .()-]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "signal-project";
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(body);
}

function sendBuffer(response, statusCode, body, headers = {}) {
  response.statusCode = statusCode;
  for (const [key, value] of Object.entries(headers)) {
    response.setHeader(key, value);
  }
  response.end(body);
}
