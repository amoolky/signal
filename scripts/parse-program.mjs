import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

const DEFAULT_INPUT = "input_test/medical_hospital_program.xlsx";
const DEFAULT_SCHEMA = "input_test/program_schema.json";
const DEFAULT_OUTPUT = "output/program_data.json";
const AREA_TOLERANCE = 0.01;
const GROSS_TOLERANCE = 0.1;
const TABLE_DISPLAY_COLUMN_KEYS = [
  "department",
  "programGroup",
  "program",
  "quantity",
  "nsfPerUnit",
  "totalNsf",
  "floor",
  "comments",
];
const DEFAULT_TABLE_DISPLAY_LABELS = {
  department: "Department",
  programGroup: "Functional Area",
};
const DEPARTMENT_TABLE_LAYOUTS = [
  {
    name: "canonical",
    columns: {
      program: "A",
      quantity: "B",
      nsfPerUnit: "C",
      totalNsf: "D",
      floor: "E",
      comments: "F",
    },
    groupColumn: "A",
    subtotalLabelColumn: "C",
    subtotalValueColumn: "D",
    headerMatches: (row) =>
      normalizeText(getCellText(row, "A")) === "program" && normalizeText(getCellText(row, "B")) === "quantity",
  },
  {
    name: "planning-program",
    columns: {
      program: "C",
      quantity: "E",
      nsfPerUnit: "F",
      totalNsf: "G",
      floor: undefined,
      comments: "H",
    },
    groupColumn: "A",
    subtotalLabelColumn: "F",
    subtotalValueColumn: "G",
    defaultHeaders: {
      program: "Program",
      floor: "Floor",
    },
    skipLabelOnlyProgramRows: true,
    headerMatches: (row) =>
      normalizeText(getCellText(row, "E")) === "quantity" &&
      normalizeText(getCellText(row, "F")).includes("nsf") &&
      normalizeText(getCellText(row, "G")).includes("total"),
  },
];

export function parseProgramWorkbook({
  workbookPath = DEFAULT_INPUT,
  workbookBuffer,
  workbookName,
  schemaPath = DEFAULT_SCHEMA,
  generatedAt = new Date().toISOString(),
} = {}) {
  const hasWorkbookBuffer = workbookBuffer !== undefined && workbookBuffer !== null;
  const absoluteWorkbookPath = hasWorkbookBuffer ? undefined : path.resolve(workbookPath);
  const sourceFileName = sanitizeSourceFileName(
    workbookName ?? (absoluteWorkbookPath ? path.basename(absoluteWorkbookPath) : "import.xlsx"),
  );
  const sourceFileUri = absoluteWorkbookPath ? toProjectRelativePath(absoluteWorkbookPath) : undefined;
  const workbookData = Buffer.from(hasWorkbookBuffer ? workbookBuffer : fs.readFileSync(absoluteWorkbookPath));
  const absoluteSchemaPath = path.resolve(schemaPath);
  const schema = JSON.parse(fs.readFileSync(absoluteSchemaPath, "utf8"));
  const workbook = readXlsxWorkbook(workbookData);
  const program = buildProgramModel({
    workbook,
    sourceFileName,
    sourceFileUri,
    sourceChecksum: sha256Buffer(workbookData),
    schema,
    schemaPath: absoluteSchemaPath,
    generatedAt,
  });
  const schemaErrors = validateAgainstJsonSchema(program, schema);

  if (schemaErrors.length > 0) {
    const preview = schemaErrors.slice(0, 12).map((error) => `- ${error}`).join("\n");
    throw new Error(`Generated JSON does not match the schema:\n${preview}`);
  }

  return program;
}

function buildProgramModel({ workbook, sourceFileName, sourceFileUri, sourceChecksum, schema, schemaPath, generatedAt }) {
  const issues = [];
  const sourceFileId = `source-${slugify(path.basename(sourceFileName, path.extname(sourceFileName)))}`;
  const sourceFile = {
    id: sourceFileId,
    name: sourceFileName,
    format: "xlsx",
    uri: sourceFileUri,
    imported_at: generatedAt,
    checksum: sourceChecksum,
  };

  const summarySheet = workbook.sheets.find((sheet) => normalizeText(sheet.name) === "summary");
  const summary = summarySheet ? parseSummarySheet(summarySheet) : emptySummary();
  if (!summarySheet) {
    issues.push(createIssue("warning", "workbook", undefined, "No Summary sheet was found.", generatedAt));
  }

  const departmentSummaryByKey = new Map();
  for (const department of summary.departments) {
    departmentSummaryByKey.set(matchKey(department.name), department);
  }

  const floorsByNumber = new Map();
  const departmentIds = new Set();
  const groupIds = new Set();
  const itemIds = new Set();
  const departments = [];
  const programGroups = [];
  const programItems = [];
  const departmentRecords = [];
  const tableColumnHeaders = new Map();
  let issueCounter = issues.length;
  let globalGroupSort = 0;
  let globalItemSort = 0;

  const addIssue = (severity, entityType, entityId, message) => {
    issueCounter += 1;
    issues.push({
      id: `issue-${String(issueCounter).padStart(3, "0")}`,
      severity,
      entity_type: entityType,
      entity_id: entityId,
      message,
      created_at: generatedAt,
    });
  };

  const departmentSheets = workbook.sheets.filter((sheet) => normalizeText(sheet.name) !== "summary");

  for (const [sheetIndex, sheet] of departmentSheets.entries()) {
    const parsedSheet = parseDepartmentSheet(sheet);
    mergeTableColumnHeaders(tableColumnHeaders, parsedSheet.columnHeaders);
    const summaryRecord = findSummaryRecord(departmentSummaryByKey, sheet.name);
    const departmentName = summaryRecord?.name ?? parsedSheet.name ?? sheet.name;
    const departmentSlug = slugify(departmentName);
    const departmentId = uniqueId(`dept-${departmentSlug}`, departmentIds);
    const grossingFactor = summaryRecord?.grossingFactor ?? parsedSheet.grossingFactor ?? 1;
    const sortOrder = summaryRecord?.sortOrder ?? sheetIndex + 1;
    const departmentRef = summaryRecord
      ? sourceRef(sourceFileId, summarySheet, summaryRecord.rowNumber, "A", summaryRecord.name)
      : sourceRef(sourceFileId, sheet, parsedSheet.titleRowNumber ?? 1, "A", departmentName);

    if (grossingFactor === 1 && parsedSheet.grossingFactor == null && summaryRecord?.grossingFactor == null) {
      addIssue(
        "warning",
        "department",
        departmentId,
        `Department "${departmentName}" had no grossing factor; 1.0 was used.`,
      );
    }

    const summaryFloorNumbers = parseFloorNumbers(summaryRecord?.floorsLabel);
    for (const floorNumber of summaryFloorNumbers) {
      addFloor(floorsByNumber, floorNumber, sourceRef(sourceFileId, summarySheet, summaryRecord.rowNumber, "E"));
    }

    const department = {
      id: departmentId,
      name: departmentName,
      grossing_factor: grossingFactor,
      macro_program_placeholder_dgsf:
        summaryRecord?.grossDgsf ?? parsedSheet.macroProgramPlaceholderDgsf ?? parsedSheet.grossSqFeet,
      sort_order: sortOrder,
      source_ref: departmentRef,
      extensions: compactObject({
        source_sheet_name: sheet.name,
        summary_net_nsf: summaryRecord?.netNsf,
        summary_gross_dgsf: summaryRecord?.grossDgsf,
        summary_program_count: summaryRecord?.programCount,
        sheet_net_nsf: parsedSheet.netSqFeet,
        sheet_gross_dgsf: parsedSheet.grossSqFeet,
      }),
    };

    departments.push(compactObject(department));

    const createdGroups = [];
    for (const [groupIndex, parsedGroup] of parsedSheet.groups.entries()) {
      globalGroupSort += 1;
      const groupSlug = slugify(parsedGroup.name || `group-${groupIndex + 1}`);
      const groupId = uniqueId(`group-${departmentSlug}-${groupSlug}`, groupIds);
      const group = {
        id: groupId,
        department_id: departmentId,
        name: parsedGroup.name || "Ungrouped",
        sort_order: globalGroupSort,
        source_ref: sourceRef(sourceFileId, sheet, parsedGroup.rowNumber, "A", parsedGroup.name),
        extensions: compactObject({
          spreadsheet_subtotal_nsf: parsedGroup.spreadsheetSubtotalNsf,
        }),
      };
      createdGroups.push({ parsedGroup, group });
      programGroups.push(group);

      let computedGroupNsf = 0;
      for (const [itemIndex, parsedItem] of parsedGroup.items.entries()) {
        globalItemSort += 1;
        const itemSlug = slugify(parsedItem.name || `item-${itemIndex + 1}`);
        const itemId = uniqueId(`item-${departmentSlug}-${groupSlug}-${itemSlug}`, itemIds);
        const quantity = parsedItem.quantity ?? 0;
        const nsfPerUnit = parsedItem.nsfPerUnit ?? 0;
        const computedTotal = roundArea(quantity * nsfPerUnit);
        const floorNumbers = parseFloorNumbers(parsedItem.floorLabel);
        const fallbackFloorNumber = summaryFloorNumbers[0] ?? 1;
        const floorNumber = floorNumbers[0] ?? fallbackFloorNumber;
        const floorId = floorIdForNumber(floorNumber);
        addFloor(floorsByNumber, floorNumber, sourceRef(sourceFileId, sheet, parsedItem.rowNumber, "E"));

        if (floorNumbers.length > 1) {
          addIssue(
            "warning",
            "program_item",
            itemId,
            `Program item "${parsedItem.name}" listed multiple floors (${parsedItem.floorLabel}); floor ${floorNumber} was used as the primary floor.`,
          );
        }

        if (parsedItem.quantity == null || parsedItem.nsfPerUnit == null) {
          addIssue(
            "warning",
            "program_item",
            itemId,
            `Program item "${parsedItem.name}" had missing quantity or NSF/Room values; missing values were treated as 0.`,
          );
        }

        if (
          parsedItem.spreadsheetTotalNsf != null &&
          Math.abs(parsedItem.spreadsheetTotalNsf - computedTotal) > AREA_TOLERANCE
        ) {
          addIssue(
            "warning",
            "program_item",
            itemId,
            `Program item "${parsedItem.name}" has spreadsheet total ${parsedItem.spreadsheetTotalNsf}, but quantity * NSF/Room is ${computedTotal}.`,
          );
        }

        computedGroupNsf += computedTotal;
        programItems.push(
          compactObject({
            id: itemId,
            program_group_id: groupId,
            name: parsedItem.name,
            quantity,
            nsf_per_unit: nsfPerUnit,
            floor_id: floorId,
            comment: parsedItem.comment,
            sort_order: globalItemSort,
            program_type: snakeCase(parsedGroup.name),
            status: "planned",
            source_ref: sourceRef(sourceFileId, sheet, parsedItem.rowNumber, "A", parsedItem.name),
            extensions: compactObject({
              spreadsheet_total_nsf: parsedItem.spreadsheetTotalNsf,
              computed_total_nsf: computedTotal,
              original_floor_label: parsedItem.floorLabel,
              department_id: departmentId,
            }),
          }),
        );
      }

      if (
        parsedGroup.spreadsheetSubtotalNsf != null &&
        Math.abs(parsedGroup.spreadsheetSubtotalNsf - computedGroupNsf) > AREA_TOLERANCE
      ) {
        addIssue(
          "warning",
          "program_group",
          groupId,
          `Program group "${parsedGroup.name}" has spreadsheet subtotal ${parsedGroup.spreadsheetSubtotalNsf}, but parsed items total ${roundArea(computedGroupNsf)}.`,
        );
      }
    }

    for (const createdGroup of createdGroups) {
      const itemFloorIds = programItems
        .filter((item) => item.program_group_id === createdGroup.group.id)
        .map((item) => item.floor_id);
      const uniqueFloorIds = [...new Set(itemFloorIds)];
      if (uniqueFloorIds.length === 1) {
        createdGroup.group.default_floor_id = uniqueFloorIds[0];
      }
    }

    departmentRecords.push({
      department,
      summaryRecord,
      parsedSheet,
      itemIds: programItems
        .filter((item) => {
          const group = programGroups.find((programGroup) => programGroup.id === item.program_group_id);
          return group?.department_id === departmentId;
        })
        .map((item) => item.id),
    });
  }

  const departmentTotals = [];
  for (const record of departmentRecords) {
    const departmentGroupIds = programGroups
      .filter((group) => group.department_id === record.department.id)
      .map((group) => group.id);
    const departmentItems = programItems.filter((item) => departmentGroupIds.includes(item.program_group_id));
    const netNsf = roundArea(
      departmentItems.reduce((sum, item) => sum + item.quantity * item.nsf_per_unit, 0),
    );
    const grossDgsf = roundArea(netNsf * record.department.grossing_factor);
    const floorNumbers = [
      ...new Set(departmentItems.map((item) => numberFromFloorId(item.floor_id)).filter((value) => value != null)),
    ].sort((a, b) => a - b);

    departmentTotals.push({
      department_id: record.department.id,
      net_nsf: netNsf,
      grossing_factor: record.department.grossing_factor,
      gross_dgsf: grossDgsf,
      program_count: departmentItems.length,
      floor_numbers: floorNumbers,
    });

    if (record.summaryRecord?.programCount != null && record.summaryRecord.programCount !== departmentItems.length) {
      addIssue(
        "warning",
        "department",
        record.department.id,
        `Summary lists ${record.summaryRecord.programCount} program rows for "${record.department.name}", but ${departmentItems.length} were parsed.`,
      );
    }

    if (record.summaryRecord?.netNsf != null && Math.abs(record.summaryRecord.netNsf - netNsf) > AREA_TOLERANCE) {
      addIssue(
        "warning",
        "department",
        record.department.id,
        `Summary net NSF for "${record.department.name}" is ${record.summaryRecord.netNsf}, but parsed items total ${netNsf}.`,
      );
    }

    if (record.summaryRecord?.grossDgsf != null && Math.abs(record.summaryRecord.grossDgsf - grossDgsf) > GROSS_TOLERANCE) {
      addIssue(
        "warning",
        "department",
        record.department.id,
        `Summary gross DGSF for "${record.department.name}" is ${record.summaryRecord.grossDgsf}, but computed gross is ${grossDgsf}.`,
      );
    }
  }

  const projectNetNsf = roundArea(departmentTotals.reduce((sum, total) => sum + total.net_nsf, 0));
  const projectGrossDgsf = roundArea(departmentTotals.reduce((sum, total) => sum + total.gross_dgsf, 0));

  if (summary.totals.netNsf != null && Math.abs(summary.totals.netNsf - projectNetNsf) > AREA_TOLERANCE) {
    addIssue(
      "warning",
      "project",
      "project",
      `Summary total net NSF is ${summary.totals.netNsf}, but parsed departments total ${projectNetNsf}.`,
    );
  }

  if (summary.totals.grossDgsf != null && Math.abs(summary.totals.grossDgsf - projectGrossDgsf) > GROSS_TOLERANCE) {
    addIssue(
      "warning",
      "project",
      "project",
      `Summary total gross DGSF is ${summary.totals.grossDgsf}, but parsed departments total ${projectGrossDgsf}.`,
    );
  }

  const projectName = summary.title.replace(/\s+Summary$/i, "").trim() || "Architectural Program";
  const floors = [...floorsByNumber.values()].sort((a, b) => a.number - b.number);

  return compactObject({
    schema_version: "1.0.0",
    project: {
      id: slugify(projectName),
      name: projectName,
      created_at: generatedAt,
      updated_at: generatedAt,
      source_files: [sourceFile],
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
    floors,
    departments,
    program_groups: programGroups,
    program_items: programItems,
    drawings: [],
    model_elements: [],
    model_links: [],
    derived_totals_cache: {
      project_net_nsf: projectNetNsf,
      project_gross_dgsf: projectGrossDgsf,
      department_totals: departmentTotals,
    },
    validation_issues: issues,
    extensions: {
      parser: {
        name: "Signal XLSX architectural program parser",
        version: "0.1.0",
      },
      source_schema: {
        id: schema.$id,
        title: schema.title,
        uri: toProjectRelativePath(schemaPath),
      },
      import_summary: {
        source_sheet_count: workbook.sheets.length,
        parsed_department_count: departments.length,
        parsed_group_count: programGroups.length,
        parsed_program_item_count: programItems.length,
      },
      table_display: {
        columns: createTableDisplayColumns(tableColumnHeaders),
      },
    },
  });
}

function readXlsxWorkbook(buffer) {
  const zipEntries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(bufferToString(zipEntries.get("xl/sharedStrings.xml")));
  const relationships = parseRelationships(bufferToString(zipEntries.get("xl/_rels/workbook.xml.rels")));
  const sheets = parseWorkbookSheets(bufferToString(zipEntries.get("xl/workbook.xml")), relationships).map((sheet) => {
    const entryName = resolveWorkbookTarget(sheet.target);
    const worksheetXml = bufferToString(zipEntries.get(entryName));
    if (!worksheetXml) {
      throw new Error(`Worksheet XML not found for "${sheet.name}" at ${entryName}.`);
    }
    return {
      ...sheet,
      entryName,
      rows: parseWorksheet(worksheetXml, sharedStrings),
    };
  });

  return { sheets };
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

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => readTextRuns(match[1]));
}

function parseRelationships(xml) {
  const relationships = new Map();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = match[1];
    relationships.set(readXmlAttribute(attrs, "Id"), readXmlAttribute(attrs, "Target"));
  }
  return relationships;
}

function parseWorkbookSheets(xml, relationships) {
  const sheets = [];
  for (const match of xml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = match[1];
    const relationshipId = readXmlAttribute(attrs, "r:id");
    sheets.push({
      name: readXmlAttribute(attrs, "name"),
      sheetId: Number(readXmlAttribute(attrs, "sheetId")),
      relationshipId,
      target: relationships.get(relationshipId),
    });
  }
  return sheets;
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const attrs = rowMatch[1];
    const body = rowMatch[2];
    const rowNumber = Number(readXmlAttribute(attrs, "r")) || rows.length + 1;
    const cells = new Map();

    for (const cellMatch of body.matchAll(/<c\b([^>]*[^/])>([\s\S]*?)<\/c>/g)) {
      const cellAttrs = cellMatch[1];
      const cellBody = cellMatch[2];
      const ref = readXmlAttribute(cellAttrs, "r");
      const column = columnFromCellRef(ref);
      const value = parseCellValue(cellAttrs, cellBody, sharedStrings);

      if (value !== null && value !== "") {
        cells.set(column, {
          ref,
          column,
          value,
          type: readXmlAttribute(cellAttrs, "t"),
        });
      }
    }

    rows.push({ number: rowNumber, cells });
  }

  return rows;
}

function parseCellValue(attrs, body, sharedStrings) {
  const type = readXmlAttribute(attrs, "t");
  const rawValue = readTagValue(body, "v");

  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }

  if (type === "inlineStr") {
    return readTextRuns(body);
  }

  if (type === "b") {
    return rawValue === "1";
  }

  if (rawValue == null) {
    return "";
  }

  const decoded = decodeXml(rawValue);
  return isNumericString(decoded) ? Number(decoded) : decoded;
}

function parseSummarySheet(sheet) {
  const title =
    sheet.rows.map((row) => getCellText(row, "A")).find((value) => value.length > 0) ??
    "Architectural Program Summary";
  const headerIndex = sheet.rows.findIndex(
    (row) => normalizeText(getCellText(row, "A")) === "department" && normalizeText(getCellText(row, "B")).includes("net"),
  );
  const departments = [];
  const totals = {};

  if (headerIndex < 0) {
    return { title, departments, totals };
  }

  for (const row of sheet.rows.slice(headerIndex + 1)) {
    const name = getCellText(row, "A");
    if (!name) continue;

    if (normalizeText(name) === "total") {
      totals.netNsf = numberValue(getCell(row, "B"));
      totals.grossDgsf = numberValue(getCell(row, "D"));
      break;
    }

    departments.push({
      name,
      netNsf: numberValue(getCell(row, "B")),
      grossingFactor: numberValue(getCell(row, "C")),
      grossDgsf: numberValue(getCell(row, "D")),
      floorsLabel: getCellText(row, "E"),
      programCount: integerValue(getCell(row, "F")),
      rowNumber: row.number,
      sortOrder: departments.length + 1,
    });
  }

  return { title, departments, totals };
}

function emptySummary() {
  return {
    title: "Architectural Program Summary",
    departments: [],
    totals: {},
  };
}

function parseDepartmentSheet(sheet) {
  const titleRow = sheet.rows.find((row) => getCellText(row, "A"));
  const parsed = {
    name: normalizeDisplayLabel(sheet.name) || sheet.name,
    titleRowNumber: titleRow?.number ?? 1,
    groups: [],
  };

  for (const row of sheet.rows) {
    readDepartmentMetrics(parsed, row);
  }

  const { layout, headerIndex } = detectDepartmentTableLayout(sheet);

  if (!layout || headerIndex < 0) {
    return parsed;
  }

  parsed.columnHeaders = readDepartmentColumnHeaders(sheet.rows[headerIndex], layout);

  let currentGroup;
  for (const row of sheet.rows.slice(headerIndex + 1)) {
    const label = getLayoutCellText(row, layout, "program");
    const groupLabel = getCellText(row, layout.groupColumn);
    const quantity = getLayoutNumber(row, layout, "quantity");
    const nsfPerUnit = getLayoutNumber(row, layout, "nsfPerUnit");
    const spreadsheetTotalNsf = getLayoutNumber(row, layout, "totalNsf");
    const floorLabel = getLayoutCellText(row, layout, "floor");
    const comment = getLayoutCellText(row, layout, "comments");
    const subtotalLabel = normalizeText(getCellText(row, layout.subtotalLabelColumn));
    const subtotalValue = numberValue(getCell(row, layout.subtotalValueColumn));
    const rowHasData = Boolean(
      groupLabel ||
        label ||
        quantity != null ||
        nsfPerUnit != null ||
        spreadsheetTotalNsf != null ||
        floorLabel ||
        comment ||
        subtotalLabel,
    );

    if (!rowHasData) {
      continue;
    }

    if (subtotalLabel === "nsf subtotal") {
      if (currentGroup && currentGroup.lastItemRowNumber === row.number - 1) {
        currentGroup.spreadsheetSubtotalNsf = subtotalValue;
      } else {
        parsed.departmentSubtotalNsf = subtotalValue;
      }
      continue;
    }

    if (subtotalLabel === "grossing factor" || subtotalLabel === "dgsf subtotal") {
      continue;
    }

    const isGroupHeader = isDepartmentGroupHeader(layout, {
      groupLabel,
      label,
      quantity,
      nsfPerUnit,
      spreadsheetTotalNsf,
      floorLabel,
      comment,
    });
    if (isGroupHeader) {
      currentGroup = {
        name: groupLabel || label,
        rowNumber: row.number,
        items: [],
      };
      parsed.groups.push(currentGroup);
      continue;
    }

    if (
      layout.skipLabelOnlyProgramRows &&
      label &&
      quantity == null &&
      nsfPerUnit == null &&
      spreadsheetTotalNsf == null &&
      !floorLabel &&
      !comment
    ) {
      continue;
    }

    if (!label) {
      continue;
    }

    if (!currentGroup) {
      currentGroup = {
        name: "Ungrouped",
        rowNumber: row.number,
        items: [],
      };
      parsed.groups.push(currentGroup);
    }

    currentGroup.items.push({
      name: label,
      rowNumber: row.number,
      quantity,
      nsfPerUnit,
      spreadsheetTotalNsf,
      floorLabel,
      comment,
    });
    currentGroup.lastItemRowNumber = row.number;
  }

  return parsed;
}

function readDepartmentMetrics(parsed, row) {
  const labelB = normalizeText(getCellText(row, "B"));
  const labelC = normalizeText(getCellText(row, "C"));
  const labelD = normalizeText(getCellText(row, "D"));
  const labelH = normalizeText(getCellText(row, "H"));

  if (labelB.startsWith("departmental net")) {
    parsed.netSqFeet = parsed.netSqFeet ?? numberValue(getCell(row, "C"));
  }
  if (labelC.startsWith("departmental net")) {
    parsed.netSqFeet = parsed.netSqFeet ?? numberValue(getCell(row, "D"));
  }
  if (labelB.startsWith("departmental grossing")) {
    parsed.grossingFactor = parsed.grossingFactor ?? numberValue(getCell(row, "C"));
  }
  if (labelC.startsWith("departmental grossing")) {
    parsed.grossingFactor = parsed.grossingFactor ?? numberValue(getCell(row, "D"));
  }
  if (labelB.startsWith("departmental gross sq")) {
    parsed.grossSqFeet = parsed.grossSqFeet ?? numberValue(getCell(row, "C"));
  }
  if (labelC.startsWith("departmental gross sq")) {
    parsed.grossSqFeet = parsed.grossSqFeet ?? numberValue(getCell(row, "D"));
  }
  if (labelD.startsWith("macro program placeholder")) {
    parsed.macroProgramPlaceholderDgsf =
      parsed.macroProgramPlaceholderDgsf ?? numberValue(getCell(row, "E")) ?? numberFromText(getCellText(row, "D"));
  }
  if (labelH.startsWith("macro program placeholder")) {
    parsed.macroProgramPlaceholderDgsf =
      parsed.macroProgramPlaceholderDgsf ?? numberValue(getCell(row, "I")) ?? numberFromText(getCellText(row, "H"));
  }
  if (labelC === "grossing factor") {
    parsed.grossingFactor = parsed.grossingFactor ?? numberValue(getCell(row, "D"));
  }
  if (labelC === "dgsf subtotal") {
    parsed.grossSqFeet = parsed.grossSqFeet ?? numberValue(getCell(row, "D"));
  }
  if (normalizeText(getCellText(row, "F")) === "grossing factor") {
    parsed.grossingFactor = parsed.grossingFactor ?? numberValue(getCell(row, "G"));
  }
  if (normalizeText(getCellText(row, "F")) === "dgsf subtotal") {
    parsed.grossSqFeet = parsed.grossSqFeet ?? numberValue(getCell(row, "G"));
  }
}

function detectDepartmentTableLayout(sheet) {
  for (const [rowIndex, row] of sheet.rows.entries()) {
    const layout = DEPARTMENT_TABLE_LAYOUTS.find((candidate) => candidate.headerMatches(row));
    if (layout) {
      return { layout, headerIndex: rowIndex };
    }
  }

  return { layout: undefined, headerIndex: -1 };
}

function getLayoutCellText(row, layout, key) {
  const column = layout.columns[key];
  return column ? getCellText(row, column) : "";
}

function getLayoutNumber(row, layout, key) {
  const column = layout.columns[key];
  return column ? numberValue(getCell(row, column)) : undefined;
}

function isDepartmentGroupHeader(layout, values) {
  const hasNoItemValues =
    values.quantity == null &&
    values.nsfPerUnit == null &&
    values.spreadsheetTotalNsf == null &&
    !values.floorLabel &&
    !values.comment;

  if (!hasNoItemValues) return false;

  if (layout.groupColumn === layout.columns.program) {
    return Boolean(values.label);
  }

  return Boolean(values.groupLabel && !values.label);
}

function readDepartmentColumnHeaders(row, layout) {
  const headers = Object.fromEntries(
    ["program", "quantity", "nsfPerUnit", "totalNsf", "floor", "comments"].map((key) => [
      key,
      getLayoutCellText(row, layout, key) || layout.defaultHeaders?.[key],
    ]),
  );
  headers.department = DEFAULT_TABLE_DISPLAY_LABELS.department;
  headers.programGroup =
    layout.groupColumn === layout.columns.program
      ? DEFAULT_TABLE_DISPLAY_LABELS.programGroup
      : getCellText(row, layout.groupColumn) || DEFAULT_TABLE_DISPLAY_LABELS.programGroup;
  return compactObject(headers);
}

function mergeTableColumnHeaders(headersByColumnKey, nextHeaders = {}) {
  for (const [columnKey, label] of Object.entries(nextHeaders)) {
    const normalizedLabel = normalizeTableDisplayLabel(columnKey, label);
    if (!normalizedLabel || headersByColumnKey.has(columnKey)) continue;
    headersByColumnKey.set(columnKey, normalizedLabel);
  }
}

function createTableDisplayColumns(headersByColumnKey) {
  return TABLE_DISPLAY_COLUMN_KEYS
    .map((key) => ({
      key,
      label: headersByColumnKey.get(key) ?? DEFAULT_TABLE_DISPLAY_LABELS[key],
    }))
    .filter((column) => column.label);
}

function normalizeTableDisplayLabel(columnKey, label) {
  const normalizedLabel = normalizeDisplayLabel(label);
  if (columnKey === "programGroup" && matchKey(normalizedLabel) === "programgroup") {
    return DEFAULT_TABLE_DISPLAY_LABELS.programGroup;
  }
  return normalizedLabel;
}

function validateAgainstJsonSchema(data, schema) {
  const errors = [];

  const validate = (value, currentSchema, pathLabel) => {
    if (currentSchema.$ref) {
      validate(value, resolveSchemaRef(schema, currentSchema.$ref), pathLabel);
      return;
    }

    if (currentSchema.oneOf) {
      const matches = currentSchema.oneOf.filter((option) => {
        const optionErrors = [];
        validateWithCollector(value, option, pathLabel, optionErrors);
        return optionErrors.length === 0;
      });
      if (matches.length !== 1) {
        errors.push(`${pathLabel} must match exactly one allowed schema.`);
      }
      return;
    }

    if (currentSchema.const !== undefined && value !== currentSchema.const) {
      errors.push(`${pathLabel} must equal ${JSON.stringify(currentSchema.const)}.`);
    }

    if (currentSchema.enum && !currentSchema.enum.includes(value)) {
      errors.push(`${pathLabel} must be one of ${currentSchema.enum.join(", ")}.`);
    }

    if (currentSchema.type && !matchesType(value, currentSchema.type)) {
      errors.push(`${pathLabel} must be ${currentSchema.type}.`);
      return;
    }

    if (currentSchema.type === "object") {
      const properties = currentSchema.properties ?? {};
      for (const requiredKey of currentSchema.required ?? []) {
        if (value?.[requiredKey] === undefined) {
          errors.push(`${pathLabel}.${requiredKey} is required.`);
        }
      }

      if (currentSchema.additionalProperties === false) {
        for (const key of Object.keys(value ?? {})) {
          if (!Object.hasOwn(properties, key)) {
            errors.push(`${pathLabel}.${key} is not allowed by the schema.`);
          }
        }
      }

      for (const [key, propertySchema] of Object.entries(properties)) {
        if (value?.[key] !== undefined) {
          validate(value[key], propertySchema, `${pathLabel}.${key}`);
        }
      }
    }

    if (currentSchema.type === "array") {
      if (currentSchema.minItems != null && value.length < currentSchema.minItems) {
        errors.push(`${pathLabel} must contain at least ${currentSchema.minItems} items.`);
      }
      if (currentSchema.maxItems != null && value.length > currentSchema.maxItems) {
        errors.push(`${pathLabel} must contain no more than ${currentSchema.maxItems} items.`);
      }
      if (currentSchema.uniqueItems) {
        const uniqueValues = new Set(value.map((item) => JSON.stringify(item)));
        if (uniqueValues.size !== value.length) {
          errors.push(`${pathLabel} must contain unique items.`);
        }
      }
      value.forEach((item, index) => validate(item, currentSchema.items ?? {}, `${pathLabel}[${index}]`));
    }

    if (currentSchema.type === "string" && currentSchema.pattern) {
      const regex = new RegExp(currentSchema.pattern);
      if (!regex.test(value)) {
        errors.push(`${pathLabel} must match ${currentSchema.pattern}.`);
      }
    }

    if ((currentSchema.type === "number" || currentSchema.type === "integer") && currentSchema.minimum != null) {
      if (value < currentSchema.minimum) {
        errors.push(`${pathLabel} must be at least ${currentSchema.minimum}.`);
      }
    }
  };

  const validateWithCollector = (value, currentSchema, pathLabel, collector) => {
    const startLength = errors.length;
    validate(value, currentSchema, pathLabel);
    collector.push(...errors.splice(startLength));
  };

  validate(data, schema, "$");
  return errors;
}

function resolveSchemaRef(schema, ref) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Unsupported schema reference: ${ref}`);
  }
  return ref
    .slice(2)
    .split("/")
    .reduce((node, key) => node?.[key], schema);
}

function matchesType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

function findSummaryRecord(summaryByKey, sheetName) {
  const exact = summaryByKey.get(matchKey(sheetName));
  if (exact) return exact;

  const sheetKey = matchKey(sheetName);
  for (const [key, record] of summaryByKey.entries()) {
    if (key.includes(sheetKey) || sheetKey.includes(key)) {
      return record;
    }
  }
  return undefined;
}

function addFloor(floorsByNumber, floorNumber, ref) {
  if (!Number.isInteger(floorNumber) || floorNumber < 1 || floorsByNumber.has(floorNumber)) {
    return;
  }

  floorsByNumber.set(floorNumber, {
    id: floorIdForNumber(floorNumber),
    number: floorNumber,
    name: `Floor ${floorNumber}`,
    source_ref: ref,
  });
}

function sourceRef(sourceFileId, sheet, rowNumber, column = "A", originalLabel) {
  if (!sheet || !rowNumber) {
    return undefined;
  }
  return compactObject({
    source_file_id: sourceFileId,
    sheet_name: sheet.name,
    row: rowNumber,
    column,
    cell: `${column}${rowNumber}`,
    original_label: originalLabel,
  });
}

function createIssue(severity, entityType, entityId, message, createdAt) {
  return compactObject({
    id: "issue-001",
    severity,
    entity_type: entityType,
    entity_id: entityId,
    message,
    created_at: createdAt,
  });
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function uniqueId(base, usedIds) {
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sanitizeSourceFileName(fileName) {
  return path.basename(String(fileName ?? "import.xlsx")).replace(/[^\w .()-]+/g, "_").trim() || "import.xlsx";
}

function resolveWorkbookTarget(target) {
  const normalized = target.replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function bufferToString(buffer) {
  return buffer ? buffer.toString("utf8") : "";
}

function readXmlAttribute(attrs, name) {
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(name)}=(["'])(.*?)\\1`);
  const match = attrs.match(pattern);
  return match ? decodeXml(match[2]) : "";
}

function readTagValue(xml, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`);
  const match = xml.match(pattern);
  return match ? decodeXml(match[1]) : null;
}

function readTextRuns(xml) {
  const runs = [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
  if (runs.length > 0) {
    return runs.map((match) => decodeXml(match[1])).join("");
  }
  return decodeXml(xml.replace(/<[^>]+>/g, ""));
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function columnFromCellRef(ref) {
  return String(ref).replace(/\d+/g, "");
}

function getCell(row, column) {
  return row?.cells.get(column)?.value;
}

function getCellText(row, column) {
  const value = getCell(row, column);
  return value == null ? "" : String(value).trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeDisplayLabel(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function matchKey(value) {
  return normalizeText(value)
    .replace(/&/g, " and ")
    .replace(/[+/]/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "");
}

function slugify(value) {
  const slug = normalizeText(value)
    .replace(/&/g, " and ")
    .replace(/[+/]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

function snakeCase(value) {
  return slugify(value).replace(/-/g, "_");
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return undefined;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!isNumericString(normalized)) return undefined;
  return Number(normalized);
}

function numberFromText(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").match(/-?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?/i);
  return match ? numberValue(match[0]) : undefined;
}

function integerValue(value) {
  const number = numberValue(value);
  return number == null ? undefined : Math.trunc(number);
}

function isNumericString(value) {
  return /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(String(value).trim());
}

function parseFloorNumbers(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [Math.trunc(value)].filter((number) => number >= 1);
  }
  return [...String(value ?? "").matchAll(/\d+/g)].map((match) => Number(match[0])).filter((number) => number >= 1);
}

function floorIdForNumber(floorNumber) {
  return `floor-${floorNumber}`;
}

function numberFromFloorId(floorId) {
  const match = String(floorId).match(/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function roundArea(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toProjectRelativePath(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    schema: DEFAULT_SCHEMA,
    output: DEFAULT_OUTPUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input" || token === "-i") {
      args.input = argv[index + 1];
      index += 1;
    } else if (token === "--schema" || token === "-s") {
      args.schema = argv[index + 1];
      index += 1;
    } else if (token === "--output" || token === "-o") {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const program = parseProgramWorkbook({
    workbookPath: args.input,
    schemaPath: args.schema,
  });
  const outputPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(program, null, 2)}\n`, "utf8");
  console.log(`Wrote ${toProjectRelativePath(outputPath)}`);
  console.log(
    `Parsed ${program.departments.length} departments, ${program.program_groups.length} groups, and ${program.program_items.length} program items.`,
  );
  console.log(`Validation issues recorded in JSON: ${program.validation_issues.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
