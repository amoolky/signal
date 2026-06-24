import zlib from "node:zlib";

export const SIGNAL_PROJECT_FORMAT = "signal.project";
export const SIGNAL_PROJECT_VERSION = "0.1.0";

const DEFAULT_PROGRAM_DISPLAY_PATH = "tables/program/display.json";

export function createSignalProjectArchive({ programData, tableState = {}, existingArchiveBuffer } = {}) {
  if (!programData || typeof programData !== "object") {
    throw new Error("A project archive requires program data.");
  }

  const existing = existingArchiveBuffer ? readSignalProjectArchive(existingArchiveBuffer, { includeEntries: true }) : null;
  const entries = existing?.entries ? new Map(existing.entries) : new Map();
  const existingManifest = existing?.manifest;
  const now = new Date().toISOString();
  const projectName = programData.project?.name || "Untitled Project";
  const projectId = programData.project?.id || slugify(projectName);
  const versionId = uniqueEntryId(`program-${timestampSlug(now)}`, entries, ".json");
  const programPath = `programs/${versionId}/program_data.json`;
  const programVersion = {
    id: versionId,
    label: projectName,
    created_at: now,
    path: programPath,
    schema_version: programData.schema_version,
  };

  const priorVersions = Array.isArray(existingManifest?.program_versions)
    ? existingManifest.program_versions.filter((version) => version?.path && entries.has(version.path))
    : [];

  const manifest = {
    format: SIGNAL_PROJECT_FORMAT,
    format_version: SIGNAL_PROJECT_VERSION,
    created_at: existingManifest?.created_at || now,
    updated_at: now,
    project: {
      id: projectId,
      name: projectName,
    },
    current: {
      program_version_id: versionId,
    },
    program_versions: [...priorVersions, programVersion],
    table_displays: {
      program: {
        path: DEFAULT_PROGRAM_DISPLAY_PATH,
      },
    },
    drawings: existingManifest?.drawings ?? [],
    diagrams: existingManifest?.diagrams ?? [],
  };

  entries.set("manifest.json", jsonBuffer(manifest));
  entries.set(programPath, jsonBuffer(programData));
  entries.set(DEFAULT_PROGRAM_DISPLAY_PATH, jsonBuffer(normalizeTableState(tableState)));
  return writeZipEntries(entries);
}

export function readSignalProjectArchive(buffer, { includeEntries = false } = {}) {
  const entries = readZipEntries(Buffer.from(buffer));
  const manifest = parseJsonEntry(entries, "manifest.json");

  if (manifest?.format !== SIGNAL_PROJECT_FORMAT) {
    throw new Error("This is not a SIGNAL project file.");
  }

  const currentVersionId = manifest.current?.program_version_id;
  const programVersion =
    manifest.program_versions?.find((version) => version.id === currentVersionId) ??
    manifest.program_versions?.at(-1);

  if (!programVersion?.path) {
    throw new Error("The SIGNAL project does not contain a program version.");
  }

  const programData = parseJsonEntry(entries, programVersion.path);
  const tableDisplayPath = manifest.table_displays?.program?.path ?? DEFAULT_PROGRAM_DISPLAY_PATH;
  const tableState = entries.has(tableDisplayPath) ? parseJsonEntry(entries, tableDisplayPath) : {};

  return {
    manifest,
    programData,
    tableState,
    ...(includeEntries ? { entries } : {}),
  };
}

function normalizeTableState(tableState) {
  return {
    program: {
      sortConfig: tableState?.program?.sortConfig ?? null,
      advancedSortConfig: tableState?.program?.advancedSortConfig ?? null,
    },
  };
}

function parseJsonEntry(entries, entryName) {
  const entry = entries.get(entryName);
  if (!entry) throw new Error(`The SIGNAL project is missing ${entryName}.`);
  return JSON.parse(entry.toString("utf8"));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeZipEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = new Date();
  const { dosTime, dosDate } = toDosDateTime(now);

  for (const [entryName, entryData] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const data = Buffer.from(entryData);
    const name = Buffer.from(entryName.replace(/\\/g, "/"), "utf8");
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.size, 8);
  endRecord.writeUInt16LE(entries.size, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(centralDirectoryOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory signature at byte ${offset}.`);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength).replace(/\\/g, "/");

    if (fileName.startsWith("/") || fileName.includes("..")) {
      throw new Error(`Unsafe ZIP entry name: ${fileName}`);
    }

    const localSignature = buffer.readUInt32LE(localHeaderOffset);
    if (localSignature !== 0x04034b50) {
      throw new Error(`Invalid ZIP local file header for ${fileName}.`);
    }

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const compressedDataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
    const compressedData = buffer.subarray(compressedDataStart, compressedDataStart + compressedSize);
    let content;

    if (compressionMethod === 0) {
      content = Buffer.from(compressedData);
    } else if (compressionMethod === 8) {
      content = zlib.inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${fileName}.`);
    }

    entries.set(fileName, content);
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("Could not find ZIP end of central directory record.");
}

function uniqueEntryId(base, entries, extension) {
  let candidate = base;
  let suffix = 2;
  while (entries.has(`programs/${candidate}/program_data${extension}`)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function timestampSlug(value) {
  return String(value).replace(/\D/g, "").slice(0, 14) || "version";
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function slugify(value) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[+/]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}
