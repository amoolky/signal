import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProgramWorkbook } from "./scripts/parse-program.mjs";
import {
  createSignalProjectArchive,
  readSignalProjectArchive,
} from "./scripts/signal-project.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const outputDir = path.resolve(rootDir, "output");
const originalProgramPath = path.resolve(rootDir, "output/program_data.json");
const savedProgramPath = path.resolve(rootDir, "output/program_data.saved.json");
const parsedProgramDataDir = path.resolve(rootDir, "output/parsed");
const currentProjectPath = path.resolve(rootDir, "output/current_project.signal");
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
            const data = await readInitialProgramData();
            sendJson(response, 200, JSON.stringify(data));
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

            const data = parseProgramWorkbook({
              workbookBuffer: file.data,
              workbookName: file.filename,
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
            await writeCurrentProjectArchive(archive);
            await syncParsedProgramDataFilesFromArchive(archive);
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

          if (requestUrl.pathname === "/api/project/archive" && request.method === "PUT") {
            const archive = await readRequestBuffer(request);
            const snapshot = normalizeProjectSnapshot(readSignalProjectArchive(archive));
            await writeCurrentProjectArchive(archive);
            await syncParsedProgramDataFilesFromArchive(archive);
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
            await writeCurrentProjectArchive(file.data);
            await syncParsedProgramDataFilesFromArchive(file.data);
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

async function writeCurrentProjectArchive(archive) {
  await fs.mkdir(path.dirname(currentProjectPath), { recursive: true });
  await fs.writeFile(currentProjectPath, archive);
}

async function syncParsedProgramDataFilesFromArchive(archive) {
  const project = readSignalProjectArchive(archive, { includeEntries: true });
  const versions = Array.isArray(project.manifest?.program_versions) ? project.manifest.program_versions : [];
  const parsedDocuments = [];

  for (const version of versions) {
    if (!version?.path || !project.entries.has(version.path)) continue;

    const data = JSON.parse(project.entries.get(version.path).toString("utf8"));
    if (!isUsableProgramData(data)) continue;

    parsedDocuments.push({ version, data });
  }

  await fs.mkdir(parsedProgramDataDir, { recursive: true });
  for (const filePath of await listJsonFiles(parsedProgramDataDir)) {
    await fs.unlink(filePath);
  }

  const usedFileNames = new Set();
  for (const parsedDocument of parsedDocuments) {
    const fileName = uniqueParsedProgramDataFileName(parsedDocument, usedFileNames);
    const filePath = path.join(parsedProgramDataDir, fileName);
    await fs.writeFile(filePath, `${JSON.stringify(parsedDocument.data, null, 2)}\n`, "utf8");
  }
}

function uniqueParsedProgramDataFileName({ version, data }, usedFileNames) {
  const sourceFileName = version.source_file_name ?? data.project?.source_files?.[0]?.name ?? data.project?.name ?? version.id;
  const sourceBaseName = path.parse(sourceFileName).name || sourceFileName;
  const safeBaseName = sanitizeBaseName(sourceBaseName).replace(/\s+/g, "_") || "program-data";
  const baseName = `${safeBaseName}.program_data`;
  let candidate = `${baseName}.json`;
  let suffix = 2;

  while (usedFileNames.has(candidate)) {
    candidate = `${baseName}-${suffix}.json`;
    suffix += 1;
  }

  usedFileNames.add(candidate);
  return candidate;
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
    workspaceState: normalizeWorkspaceState(snapshot.workspaceState),
  };
}

function normalizeWorkspaceState(workspaceState) {
  return workspaceState && typeof workspaceState === "object" ? workspaceState : {};
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

  for (const projectFile of await listProjectProgramDataFiles()) {
    addFile(projectFile);
  }

  return files;
}

async function listOutputProgramDataFiles() {
  const files = [];
  for (const filePath of await listJsonFiles(outputDir)) {
    let data = null;
    try {
      data = await readOptionalJsonFile(filePath);
    } catch {
      continue;
    }

    if (!isUsableProgramData(data)) continue;

    const outputRelativePath = toOutputRelativePath(filePath);

    files.push({
      id: `output:${outputRelativePath}`,
      label: getProgramDataTitle(data, path.basename(filePath)),
      path: toProjectRelativePath(filePath),
      source: "output",
      createdAt: data.project?.updated_at ?? data.project?.created_at ?? null,
      rowCount: data.program_items.length,
      schemaVersion: data.schema_version ?? null,
    });
  }

  return files;
}

async function listProjectProgramDataFiles() {
  const archiveBuffer = await readOptionalFile(currentProjectPath);
  if (!archiveBuffer) return [];

  const project = readSignalProjectArchive(archiveBuffer, { includeEntries: true });
  const versions = Array.isArray(project.manifest?.program_versions) ? project.manifest.program_versions : [];
  const files = [];

  for (const version of versions) {
    if (!version?.id || !version.path || !project.entries.has(version.path)) continue;

    const data = JSON.parse(project.entries.get(version.path).toString("utf8"));
    if (!isProgramData(data)) continue;

    files.push({
      id: `project:${version.id}`,
      label: version.label || getProgramDataTitle(data, path.basename(version.path)),
      path: version.path,
      source: "project",
      createdAt: version.created_at ?? data.project?.updated_at ?? data.project?.created_at ?? null,
      rowCount: data.program_items.length,
      schemaVersion: data.schema_version ?? version.schema_version ?? null,
    });
  }

  return files;
}

async function readProgramDataFileById(id) {
  if (!id) throw new Error("Program data file id is required.");

  if (id.startsWith("output:")) {
    const outputRelativePath = normalizeOutputRelativePath(id.slice("output:".length));
    if (!outputRelativePath || path.extname(outputRelativePath).toLowerCase() !== ".json") {
      throw new Error("Invalid output program data file id.");
    }

    const filePath = path.resolve(outputDir, ...outputRelativePath.split("/"));
    if (!isPathWithinDirectory(filePath, outputDir)) throw new Error("Invalid output program data file id.");

    const data = await readOptionalJsonFile(filePath);
    if (!isUsableProgramData(data)) throw new Error("The selected output file is not parsed program data.");
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

async function readInitialProgramData() {
  return (
    (await readOptionalJsonFile(savedProgramPath)) ??
    (await readOptionalJsonFile(originalProgramPath)) ??
    createEmptyProgramData()
  );
}

function createEmptyProgramData(projectName = "Untitled Project") {
  const now = new Date().toISOString();
  const name = String(projectName ?? "").trim() || "Untitled Project";

  return {
    schema_version: "1.0.0",
    project: {
      id: slugify(name),
      name,
      created_at: now,
      updated_at: now,
      source_files: [],
    },
    units: {
      area: "sf",
      length: "ft",
      coordinate: "model_units",
    },
    calculation_rules: {
      program_item_total_nsf: "quantity * nsf_per_unit",
      department_net_nsf: "sum(program_item_total_nsf for program_items in department)",
      department_gross_dgsf: "department_net_nsf * grossing_factor",
      rounding: {
        area_decimals: 2,
        factor_decimals: 2,
      },
    },
    floors: [],
    departments: [],
    program_groups: [],
    program_items: [],
    drawings: [],
    model_elements: [],
    model_links: [],
    derived_totals_cache: {
      project_net_nsf: 0,
      project_gross_dgsf: 0,
      department_totals: [],
    },
    validation_issues: [],
    extensions: {
      created_in: "SIGNAL",
    },
  };
}

function isProgramData(data) {
  return Boolean(data && typeof data === "object" && data.project && Array.isArray(data.program_items));
}

function isUsableProgramData(data) {
  return isProgramData(data) && data.program_items.length > 0;
}

function getProgramDataTitle(data, fallbackLabel) {
  return String(data?.project?.name ?? fallbackLabel ?? "Untitled Project").trim() || "Untitled Project";
}

function slugify(value) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[+/]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

function toProjectRelativePath(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

function toOutputRelativePath(filePath) {
  return path.relative(outputDir, filePath).replace(/\\/g, "/");
}

function normalizeOutputRelativePath(value) {
  const normalizedPath = String(value ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (path.isAbsolute(normalizedPath) || normalizedPath.includes(":")) return "";
  if (!normalizedPath || normalizedPath.split("/").some((part) => part === ".." || part === "")) return "";
  return normalizedPath;
}

function isPathWithinDirectory(filePath, directoryPath) {
  const relativePath = path.relative(directoryPath, filePath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function listJsonFiles(directoryPath) {
  let entries = [];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(entryPath)));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".json") {
      files.push(entryPath);
    }
  }

  return files.sort((a, b) => toProjectRelativePath(a).localeCompare(toProjectRelativePath(b)));
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
