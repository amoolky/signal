import React, { useEffect, useMemo, useRef, useState } from "react";
import { computeUnion } from "./polyUnion.js";

const PROGRAM_DATA_ENDPOINT = "/api/program-data";
const PROGRAM_DATA_FILE_ENDPOINT = "/api/program-data/file";
const PROGRAM_DATA_FILES_ENDPOINT = "/api/program-data/files";
const PROGRAM_IMPORT_ENDPOINT = "/api/program-data/import";
const PROJECT_ENDPOINT = "/api/project";
const PROJECT_ARCHIVE_ENDPOINT = "/api/project/archive";
const PROJECT_EXPORT_ENDPOINT = "/api/project/export";
const PROJECT_IMPORT_ENDPOINT = "/api/project/import";
const NON_EDITABLE_TABLE_COLUMN_KEYS = new Set(["totalNsf"]);
const TABLE_ROW_NUMBER_COLUMN_WIDTH = 34;
const TABLE_HEADER_HEIGHT = 30;
const DEFAULT_TABLE_ROW_HEIGHT = 27;
const TABLE_GRID_LINE_WIDTH = 1;
const DEFAULT_TABLE_COLUMN_WIDTH = 110;
const MIN_TABLE_ROW_HEIGHT = 20;
const MIN_TABLE_COLUMN_WIDTH = 56;
const BLANK_SPREADSHEET_ROW_COUNT = 50;
const BLANK_SPREADSHEET_COLUMN_COUNT = 26;
const TABLE_VIRTUAL_OVERSCAN_ROWS = 8;
const MAX_TABLE_HISTORY_ENTRIES = 100;
const IMPORTED_SPREADSHEET_COLUMN_KEYS = ["program", "quantity", "nsfPerUnit", "totalNsf", "floor", "comments"];
const PRIMARY_SPREADSHEET_COLUMN_KEYS = ["department", "programGroup", "program"];
const LEVEL_OF_DETAIL_OPTIONS = [
  { value: "functionalGroup", label: "Functional Group" },
  { value: "departmentFunction", label: "Department Function" },
  { value: "department", label: "Department" },
  { value: "functionalArea", label: "Functional Area" },
  { value: "room", label: "Room" },
];
const SPREADSHEET_VIEW_OPTIONS = [
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "hierarchical", label: "Hierarchical" },
];
const SPREADSHEET_HIERARCHY_LEVELS = LEVEL_OF_DETAIL_OPTIONS.filter((level) => level.value !== "room");
const HIERARCHICAL_SPREADSHEET_COLUMNS = [
  { key: "program", label: "Program/Room", className: "col-program" },
  { key: "quantity", label: "Quantity", className: "col-number" },
  { key: "nsfPerUnit", label: "NSF/Room", className: "col-number" },
  { key: "totalNsf", label: "Total NSF", className: "col-total" },
  { key: "floor", label: "Floor", className: "col-floor" },
  { key: "comments", label: "Comments", className: "col-comments" },
];

const columns = [
  { key: "department", label: "Department", className: "col-department", width: 190 },
  { key: "programGroup", label: "Functional Area", className: "col-group", width: 170 },
  { key: "program", label: "Program", className: "col-program", width: 250 },
  { key: "quantity", label: "Quantity", className: "col-number", width: 110 },
  { key: "nsfPerUnit", label: "NSF/Room", className: "col-number", width: 110 },
  { key: "totalNsf", label: "Total NSF", className: "col-total", width: 110 },
  { key: "floor", label: "Floor", className: "col-floor", width: 84 },
  { key: "comments", label: "Comments", className: "col-comments", width: 300 },
];

const blankSpreadsheetColumns = Array.from({ length: BLANK_SPREADSHEET_COLUMN_COUNT }, (_, index) => ({
  key: `blankColumn${index + 1}`,
  label: "",
  className: "col-blank",
  width: DEFAULT_TABLE_COLUMN_WIDTH,
}));

const allTableColumns = [...columns, ...blankSpreadsheetColumns];

const FORMAT_SHORTCUTS = {
  b: "bold",
  i: "italic",
  u: "underline",
};

const DEFAULT_TABLE_DOCUMENT_ID = "default-table-document";
const TABLE_VIEW_SPREADSHEET = "spreadsheet";
const TABLE_VIEW_HIERARCHICAL = "hierarchical";
const SAVE_BANNER_DURATION_MS = 2500;
const DIAGRAM_VALUES_EXTENSION_KEY = "diagram_values";
const DIAGRAM_SETTINGS_EXTENSION_KEY = "diagram_settings";
const DIAGRAM_STACKING_SETTINGS_KEY = "stacking";
const DIAGRAM_VIEW_STACKING = "stacking";
const DIAGRAM_VIEW_BLOCKING = "blocking";
const BLOCKING_TOOL_NONE = "none";
const BLOCKING_TOOL_SELECT = "select";
const BLOCKING_TOOL_RECTANGLE = "rectangle";
const BLOCKING_TOOL_POLYLINE = "polyline";
const BLOCKING_TOOL_PAN = "pan";
const BLOCKING_CIRCULATION_LABEL = "Circulation";
const BLOCKING_CIRCULATION_KEY_PREFIX = "circulation";
const BLOCKING_CIRCULATION_COLOR = "hsl(210, 6%, 72%)";
const BLOCKING_TOOL_VALUES = [
  BLOCKING_TOOL_NONE,
  BLOCKING_TOOL_SELECT,
  BLOCKING_TOOL_RECTANGLE,
  BLOCKING_TOOL_POLYLINE,
  BLOCKING_TOOL_PAN,
];

function createDefaultStackingSettings() {
  return {
    defaultFloorToFloorFeet: "12",
    defaultFloorToFloorInches: "0",
    floorHeights: {},
    floorOffsets: {},
    floorWidths: {},
    slabHeights: {},
    defaultWidth: "100",
    levelOfDetail: "functionalGroup",
    textSize: "12",
    grossSquareFootage: false,
    netSquareFootage: false,
  };
}

function createDefaultSpreadsheetSettings() {
  return {
    calculateSubtotals: "functionalGroup",
    view: "spreadsheet",
    distributeIdenticalRooms: false,
  };
}

function createDefaultBlockingFloorSettings() {
  return {
    selectedProgrammingKey: "",
    textSize: "12",
    shapes: [],
  };
}

function createDefaultBlockingSettings() {
  return {
    activeFloorKey: "floor-1",
    activeTool: BLOCKING_TOOL_SELECT,
    customFloors: [],
    gridSpacingFeet: "1",
    gridSpacingInches: "0",
    floorSettings: {
      "floor-1": createDefaultBlockingFloorSettings(),
    },
    levelOfDetail: "functionalGroup",
    structuralGridFeet: "32",
    structuralGridInches: "0",
  };
}

function normalizeSpreadsheetSettings(settings) {
  const defaults = createDefaultSpreadsheetSettings();
  const view = SPREADSHEET_VIEW_OPTIONS.some((option) => option.value === settings?.view)
    ? settings.view
    : defaults.view;
  const calculateSubtotals = LEVEL_OF_DETAIL_OPTIONS.some((option) => option.value === settings?.calculateSubtotals)
    ? settings.calculateSubtotals
    : defaults.calculateSubtotals;

  return {
    ...defaults,
    view,
    calculateSubtotals,
    distributeIdenticalRooms: Boolean(settings?.distributeIdenticalRooms),
  };
}

function createDefaultDiagramState() {
  return {
    activeView: DIAGRAM_VIEW_STACKING,
    stackingSettings: createDefaultStackingSettings(),
    blockingSettings: createDefaultBlockingSettings(),
    sourceDocumentId: "",
    stackingDiagram: null,
  };
}

function createDefaultTablePaneState(documentId = DEFAULT_TABLE_DOCUMENT_ID) {
  return {
    documentId,
    sortConfig: null,
    advancedSortConfig: null,
    selectedCells: [],
    selectionRanges: [],
    selectionAnchor: null,
  };
}

function createDefaultTableColumnWidths() {
  return Object.fromEntries(allTableColumns.map((column) => [column.key, column.width]));
}

function createEmptyTableHistory() {
  return {
    past: [],
    future: [],
  };
}

function createTableDocumentFromData(data) {
  return {
    programData: data,
    draftProjectName: getProgramTitle(data),
    draftRows: createRows(data),
    cellStyles: createCellStyles(data),
    isDirty: false,
  };
}

function distributeTableDocumentForIdenticalRooms(tableDocument) {
  if (!tableDocument?.programData) return tableDocument;

  const baseDocument = createTableDocumentFromData(tableDocument.programData);
  const draftRowsForDistribution = Array.isArray(tableDocument.draftRows) ? tableDocument.draftRows : baseDocument.draftRows;
  if (!hasDistributableProgramRows(draftRowsForDistribution)) return tableDocument;

  const cellStylesForDistribution = isPlainObject(tableDocument.cellStyles) ? tableDocument.cellStyles : baseDocument.cellStyles;
  const draftProjectNameForDistribution = typeof tableDocument.draftProjectName === "string"
    ? tableDocument.draftProjectName
    : baseDocument.draftProjectName;
  const distributedData = mergeRowsIntoProgramData(
    tableDocument.programData,
    draftRowsForDistribution,
    cellStylesForDistribution,
    draftProjectNameForDistribution,
    {
      distributeIdenticalRooms: true,
    },
  );

  return {
    ...createTableDocumentFromData(distributedData),
    isDirty: true,
  };
}

function consolidateTableDocumentForIdenticalRooms(tableDocument) {
  if (!tableDocument?.programData) return tableDocument;

  const baseDocument = createTableDocumentFromData(tableDocument.programData);
  const draftRowsForConsolidation = Array.isArray(tableDocument.draftRows) ? tableDocument.draftRows : baseDocument.draftRows;
  const cellStylesForConsolidation = isPlainObject(tableDocument.cellStyles) ? tableDocument.cellStyles : baseDocument.cellStyles;
  const draftProjectNameForConsolidation = typeof tableDocument.draftProjectName === "string"
    ? tableDocument.draftProjectName
    : baseDocument.draftProjectName;
  const mergedData = mergeRowsIntoProgramData(
    tableDocument.programData,
    draftRowsForConsolidation,
    cellStylesForConsolidation,
    draftProjectNameForConsolidation,
  );
  const didConsolidate = consolidateIdenticalProgramRooms(mergedData);
  if (!didConsolidate) return tableDocument;

  return {
    ...createTableDocumentFromData(mergedData),
    isDirty: true,
  };
}

export default function App() {
  const spreadsheetImportInputRef = useRef(null);
  const projectImportInputRef = useRef(null);
  const editingCellInputRef = useRef(null);
  const nextWorkspacePaneId = useRef(1);
  const nextStackingConflictId = useRef(1);
  const workspaceDisplayRef = useRef(null);
  const pendingSpreadsheetImportPaneIdRef = useRef(null);
  const tableViewportMetricsRef = useRef({});
  const saveBannerTimeoutRef = useRef(null);
  const [isStartDialogOpen, setIsStartDialogOpen] = useState(true);
  const [isTableOpen, setIsTableOpen] = useState(false);
  const [isDiagramsOpen, setIsDiagramsOpen] = useState(false);
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const [sideToolMenu, setSideToolMenu] = useState(null);
  const [workspaceSlots, setWorkspaceSlots] = useState([]);
  const [workspacePaneWidths, setWorkspacePaneWidths] = useState([]);
  const [paneResizeState, setPaneResizeState] = useState(null);
  const [tableColumnWidths, setTableColumnWidths] = useState(createDefaultTableColumnWidths);
  const [tableRowHeights, setTableRowHeights] = useState({});
  const [blankSpreadsheetCellValues, setBlankSpreadsheetCellValues] = useState({});
  const [tableGridResizeState, setTableGridResizeState] = useState(null);
  const [tableSelectionDragState, setTableSelectionDragState] = useState(null);
  const [tableViewportMetrics, setTableViewportMetrics] = useState({});
  const [hierarchyNodeOpenStates, setHierarchyNodeOpenStates] = useState({});
  const [tableHistory, setTableHistory] = useState(createEmptyTableHistory);
  const [stackingConflicts, setStackingConflicts] = useState([]);
  const [activeConflictCellKey, setActiveConflictCellKey] = useState(null);
  const [blockingHierarchyFocus, setBlockingHierarchyFocus] = useState(null);
  const [conflictMenu, setConflictMenu] = useState(null);
  const [footerConflictMenuPaneId, setFooterConflictMenuPaneId] = useState(null);
  const [activeWorkspacePane, setActiveWorkspacePane] = useState(null);
  const [activeTablePaneId, setActiveTablePaneId] = useState(null);
  const [activeDiagramView, setActiveDiagramView] = useState("stacking");
  const [stackingSettings, setStackingSettings] = useState(createDefaultStackingSettings);
  const [programData, setProgramData] = useState(null);
  const [tableDocuments, setTableDocuments] = useState({});
  const [draftProjectName, setDraftProjectName] = useState("");
  const [draftRows, setDraftRows] = useState([]);
  const [cellStyles, setCellStyles] = useState({});
  const [selectedTableCells, setSelectedTableCells] = useState([]);
  const [selectedTableRanges, setSelectedTableRanges] = useState([]);
  const [tableSelectionAnchor, setTableSelectionAnchor] = useState(null);
  const [sortConfig, setSortConfig] = useState(null);
  const [advancedSortConfig, setAdvancedSortConfig] = useState(null);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [columnMenu, setColumnMenu] = useState(null);
  const [openSpreadsheetTitlePaneId, setOpenSpreadsheetTitlePaneId] = useState(null);
  const [spreadsheetSettingsPaneId, setSpreadsheetSettingsPaneId] = useState(null);
  const [spreadsheetSettings, setSpreadsheetSettings] = useState(createDefaultSpreadsheetSettings);
  const [draftSpreadsheetSettings, setDraftSpreadsheetSettings] = useState(createDefaultSpreadsheetSettings);
  const [isAdvancedSortOpen, setIsAdvancedSortOpen] = useState(false);
  const [advancedSortPaneId, setAdvancedSortPaneId] = useState(null);
  const [advancedDraftRules, setAdvancedDraftRules] = useState(createDefaultAdvancedSortRules);
  const [selectedRuleKeys, setSelectedRuleKeys] = useState([]);
  const [lastSelectedRuleKey, setLastSelectedRuleKey] = useState(null);
  const [draggingRuleKey, setDraggingRuleKey] = useState(null);
  const [isAdvancedCancelConfirmOpen, setIsAdvancedCancelConfirmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [savingTablePaneId, setSavingTablePaneId] = useState(null);
  const [activeSpreadsheetImportPaneId, setActiveSpreadsheetImportPaneId] = useState(null);
  const [isProjectSaving, setIsProjectSaving] = useState(false);
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);
  const [pendingTableClosePaneId, setPendingTableClosePaneId] = useState(null);
  const [availableProgramDataFiles, setAvailableProgramDataFiles] = useState([]);
  const [loadingProgramDataFileId, setLoadingProgramDataFileId] = useState(null);
  const [editingTableCell, setEditingTableCell] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [saveBannerKey, setSaveBannerKey] = useState(0);

  tableViewportMetricsRef.current = tableViewportMetrics;

  const sortedRows = useMemo(() => sortRows(draftRows, sortConfig, advancedSortConfig), [draftRows, sortConfig, advancedSortConfig]);
  const advancedBaseRules = useMemo(() => {
    const baseAdvancedSortConfig = advancedSortPaneId
      ? getTablePaneStateById(advancedSortPaneId).advancedSortConfig
      : advancedSortConfig;
    return baseAdvancedSortConfig?.rules ?? createDefaultAdvancedSortRules();
  }, [advancedSortConfig, advancedSortPaneId, workspaceSlots]);
  const hasAdvancedSortEdits = useMemo(
    () => serializeRules(advancedDraftRules) !== serializeRules(advancedBaseRules),
    [advancedDraftRules, advancedBaseRules],
  );
  const selectedRuleKeySet = useMemo(() => new Set(selectedRuleKeys), [selectedRuleKeys]);
  const visibleRowIndexById = useMemo(() => new Map(sortedRows.map((row, index) => [row.id, index])), [sortedRows]);
  const hasUnsavedEdits = Boolean(tableDocuments[DEFAULT_TABLE_DOCUMENT_ID]?.isDirty);

  useEffect(() => {
    if (!paneResizeState) return undefined;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (event) => {
      const { leftIndex, startX, containerWidth, widths } = paneResizeState;
      if (!containerWidth) return;

      const nextWidths = [...widths];
      const rightIndex = leftIndex + 1;
      const pairTotal = nextWidths[leftIndex] + nextWidths[rightIndex];
      const minPaneWidth = Math.min(0.08, Math.max(0.01, pairTotal / 2 - 0.01));
      const delta = (event.clientX - startX) / containerWidth;
      const nextLeftWidth = Math.max(
        minPaneWidth,
        Math.min(pairTotal - minPaneWidth, widths[leftIndex] + delta),
      );

      nextWidths[leftIndex] = nextLeftWidth;
      nextWidths[rightIndex] = pairTotal - nextLeftWidth;
      setWorkspacePaneWidths(normalizePaneWidths(nextWidths));
    };

    const onMouseUp = () => setPaneResizeState(null);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [paneResizeState]);

  useEffect(() => {
    if (!tableGridResizeState) return undefined;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = tableGridResizeState.type === "column" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (event) => {
      if (tableGridResizeState.type === "column") {
        const nextWidth = Math.max(
          MIN_TABLE_COLUMN_WIDTH,
          tableGridResizeState.startWidth + event.clientX - tableGridResizeState.startClientX,
        );
        setTableColumnWidths((widths) => ({
          ...widths,
          [tableGridResizeState.columnKey]: nextWidth,
        }));
        return;
      }

      const nextHeight = Math.max(
        MIN_TABLE_ROW_HEIGHT,
        tableGridResizeState.startHeight + event.clientY - tableGridResizeState.startClientY,
      );
      setTableRowHeights((heights) => ({
        ...heights,
        [tableGridResizeState.rowId]: nextHeight,
      }));
    };

    const onMouseUp = (event) => {
      if (tableGridResizeState.type === "column") {
        const nextWidth = Math.max(
          MIN_TABLE_COLUMN_WIDTH,
          tableGridResizeState.startWidth + event.clientX - tableGridResizeState.startClientX,
        );
        if (nextWidth !== tableGridResizeState.startWidth) {
          pushTableHistorySnapshot(tableGridResizeState.historySnapshot);
          setTableColumnWidths((widths) => ({
            ...widths,
            [tableGridResizeState.columnKey]: nextWidth,
          }));
        }
      } else {
        const nextHeight = Math.max(
          MIN_TABLE_ROW_HEIGHT,
          tableGridResizeState.startHeight + event.clientY - tableGridResizeState.startClientY,
        );
        if (nextHeight !== tableGridResizeState.startHeight) {
          pushTableHistorySnapshot(tableGridResizeState.historySnapshot);
          setTableRowHeights((heights) => ({
            ...heights,
            [tableGridResizeState.rowId]: nextHeight,
          }));
        }
      }

      setTableGridResizeState(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [tableGridResizeState]);

  useEffect(() => {
    if (!tableSelectionDragState) return undefined;

    const onMouseUp = () => setTableSelectionDragState(null);
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [tableSelectionDragState]);

  useEffect(() => {
    const refreshTableViewportMetrics = () => {
      document.querySelectorAll(".table-shell[data-table-pane-id]").forEach((element) => {
        updateTableViewportMetrics(element.dataset.tablePaneId, element, getTableViewKeyFromElement(element));
      });
    };

    window.addEventListener("resize", refreshTableViewportMetrics);
    return () => window.removeEventListener("resize", refreshTableViewportMetrics);
  }, []);

  useEffect(() => {
    if (workspaceSlots.length !== workspacePaneWidths.length) {
      setWorkspacePaneWidths(createEqualPaneWidths(workspaceSlots.length));
    }
  }, [workspaceSlots.length, workspacePaneWidths.length]);

  useEffect(() => {
    refreshAvailableProgramDataFiles();
  }, []);

  useEffect(() => {
    if (!columnMenu) return undefined;

    const closeColumnMenu = () => setColumnMenu(null);
    const closeColumnMenuOnKey = (event) => {
      if (event.key === "Escape") closeColumnMenu();
    };

    window.addEventListener("click", closeColumnMenu);
    window.addEventListener("keydown", closeColumnMenuOnKey);
    return () => {
      window.removeEventListener("click", closeColumnMenu);
      window.removeEventListener("keydown", closeColumnMenuOnKey);
    };
  }, [columnMenu]);

  useEffect(() => {
    if (!openSpreadsheetTitlePaneId) return undefined;

    const closeSpreadsheetTitleMenu = () => setOpenSpreadsheetTitlePaneId(null);
    const closeSpreadsheetTitleMenuOnKey = (event) => {
      if (event.key === "Escape") closeSpreadsheetTitleMenu();
    };

    window.addEventListener("click", closeSpreadsheetTitleMenu);
    window.addEventListener("keydown", closeSpreadsheetTitleMenuOnKey);
    return () => {
      window.removeEventListener("click", closeSpreadsheetTitleMenu);
      window.removeEventListener("keydown", closeSpreadsheetTitleMenuOnKey);
    };
  }, [openSpreadsheetTitlePaneId]);

  useEffect(() => {
    if (!spreadsheetSettingsPaneId) return undefined;

    const closeSpreadsheetSettingsOnKey = (event) => {
      if (event.key === "Escape") closeSpreadsheetSettings();
    };

    window.addEventListener("keydown", closeSpreadsheetSettingsOnKey);
    return () => window.removeEventListener("keydown", closeSpreadsheetSettingsOnKey);
  }, [spreadsheetSettings, spreadsheetSettingsPaneId]);

  useEffect(() => {
    if (!conflictMenu) return undefined;

    const closeConflictMenu = () => setConflictMenu(null);
    const closeConflictMenuOnKey = (event) => {
      if (event.key === "Escape") setConflictMenu(null);
    };

    window.addEventListener("mousedown", closeConflictMenu);
    window.addEventListener("keydown", closeConflictMenuOnKey);
    return () => {
      window.removeEventListener("mousedown", closeConflictMenu);
      window.removeEventListener("keydown", closeConflictMenuOnKey);
    };
  }, [conflictMenu]);

  useEffect(() => {
    if (!footerConflictMenuPaneId) return undefined;

    const closeFooterConflictMenu = () => setFooterConflictMenuPaneId(null);
    const closeFooterConflictMenuOnKey = (event) => {
      if (event.key === "Escape") setFooterConflictMenuPaneId(null);
    };

    window.addEventListener("mousedown", closeFooterConflictMenu);
    window.addEventListener("keydown", closeFooterConflictMenuOnKey);
    return () => {
      window.removeEventListener("mousedown", closeFooterConflictMenu);
      window.removeEventListener("keydown", closeFooterConflictMenuOnKey);
    };
  }, [footerConflictMenuPaneId]);


  useEffect(() => {
    if (!isProjectMenuOpen) return undefined;

    const closeProjectMenu = () => setIsProjectMenuOpen(false);
    const closeProjectMenuOnKey = (event) => {
      if (event.key === "Escape") closeProjectMenu();
    };

    window.addEventListener("click", closeProjectMenu);
    window.addEventListener("keydown", closeProjectMenuOnKey);
    return () => {
      window.removeEventListener("click", closeProjectMenu);
      window.removeEventListener("keydown", closeProjectMenuOnKey);
    };
  }, [isProjectMenuOpen]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;

      event.preventDefault();
      if (isStartDialogOpen || isProjectSaving || isSaving) return;
      saveProjectToBackend();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    activeDiagramView,
    activeTablePaneId,
    advancedSortConfig,
    blankSpreadsheetCellValues,
    cellStyles,
    draftProjectName,
    draftRows,
    isProjectSaving,
    isSaving,
    isStartDialogOpen,
    isTableOpen,
    programData,
    sortConfig,
    spreadsheetSettings,
    stackingConflicts,
    stackingSettings,
    tableColumnWidths,
    tableDocuments,
    tableRowHeights,
    workspacePaneWidths,
    workspaceSlots,
  ]);

  useEffect(() => {
    return () => {
      if (saveBannerTimeoutRef.current) {
        window.clearTimeout(saveBannerTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isAdvancedSortOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedRuleKeys([]);
        setLastSelectedRuleKey(null);
        return;
      }

      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        applyAdvancedRuleEnabled(true);
        return;
      }

      if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        applyAdvancedRuleEnabled(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAdvancedSortOpen, selectedRuleKeys]);

  useEffect(() => {
    if (!editingTableCell) return;

    const input = editingCellInputRef.current;
    if (!input) return;

    input.focus({ preventScroll: true });
    const caretPosition = input.value.length;
    input.setSelectionRange(caretPosition, caretPosition);
  }, [editingTableCell]);

  useEffect(() => {
    if (!isTableOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.defaultPrevented || !isTablePanelActiveForKeyboard()) return;
      if (spreadsheetSettingsPaneId || isAdvancedSortOpen || isAdvancedCancelConfirmOpen || isExitConfirmOpen) return;
      if (spreadsheetSettings.view === TABLE_VIEW_HIERARCHICAL) return;

      if (editingTableCell) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelTableCellEdit();
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          commitTableCellEditAndMove(event.shiftKey ? -1 : 1, 0);
          return;
        }

        if (event.key === "Tab") {
          event.preventDefault();
          commitTableCellEditAndMove(0, event.shiftKey ? -1 : 1);
        }
        return;
      }

      const activeSelectedCells = getActiveTableSelectedCells();

      if (event.key === "Escape" && activeSelectedCells.length > 0) {
        event.preventDefault();
        blurActiveTableInput();
        return;
      }

      if (isEventFromTextEditingTarget(event)) return;

      const formatKey = FORMAT_SHORTCUTS[event.key.toLowerCase()];
      if (formatKey && (event.ctrlKey || event.metaKey) && !event.altKey && activeSelectedCells.length > 0) {
        event.preventDefault();
        applyTableCellFormat(formatKey);
        return;
      }

      if (handleActiveTableShortcut(event, activeSelectedCells)) return;

      if (shouldStartSelectedTableCellEdit(event, activeSelectedCells)) {
        event.preventDefault();
        startSelectedTableCellEdit(event.key);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isAdvancedCancelConfirmOpen,
    isAdvancedSortOpen,
    isExitConfirmOpen,
    isTableOpen,
    spreadsheetSettings,
    spreadsheetSettingsPaneId,
    editingTableCell,
    selectedTableCells,
    activeWorkspacePane,
    activeTablePaneId,
    columnMenu,
    isProjectMenuOpen,
    openSpreadsheetTitlePaneId,
    sortConfig,
    advancedSortConfig,
    tableSelectionAnchor,
    tableDocuments,
    blankSpreadsheetCellValues,
    tableColumnWidths,
    tableHistory,
    tableRowHeights,
    workspaceSlots,
  ]);

  useEffect(() => {
    if (!isDiagramsOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.defaultPrevented || !isDiagramPanelActiveForKeyboard()) return;
      if (isAdvancedSortOpen || isAdvancedCancelConfirmOpen || isExitConfirmOpen) return;

      if (event.key === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (clearActiveDiagramProgrammingSelection()) {
          event.preventDefault();
          return;
        }
      }

      if (isEventFromTextEditingTarget(event)) return;

      const isCommandKey = event.ctrlKey || event.metaKey;
      if (!isCommandKey || event.altKey || event.key.toLowerCase() !== "z") return;

      event.preventDefault();
      if (event.shiftKey) {
        redoTableAction();
      } else {
        undoTableAction();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeWorkspacePane,
    blankSpreadsheetCellValues,
    cellStyles,
    draftRows,
    isAdvancedCancelConfirmOpen,
    isAdvancedSortOpen,
    isDiagramsOpen,
    isExitConfirmOpen,
    isTableOpen,
    stackingConflicts,
    tableColumnWidths,
    tableDocuments,
    tableHistory,
    tableRowHeights,
    workspaceSlots,
  ]);

  function createTableDocumentForCurrentSpreadsheetSettings(data) {
    const nextDocument = createTableDocumentFromData(data);
    return spreadsheetSettings.distributeIdenticalRooms
      ? distributeTableDocumentForIdenticalRooms(nextDocument)
      : nextDocument;
  }

  function applyProgramData(data) {
    const nextDocument = createTableDocumentForCurrentSpreadsheetSettings(data);
    setProgramData(nextDocument.programData);
    setBlankSpreadsheetCellValues({});
    setTableDocuments({
      [DEFAULT_TABLE_DOCUMENT_ID]: nextDocument,
    });
    setDraftProjectName(nextDocument.draftProjectName);
    setDraftRows(nextDocument.draftRows);
    setCellStyles(nextDocument.cellStyles);
    setTableHistory(createEmptyTableHistory());
    setStackingConflicts([]);
    setActiveConflictCellKey(null);
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
    clearTableSelection();
    updateWorkspaceStackingDiagramsForDocument(DEFAULT_TABLE_DOCUMENT_ID, nextDocument.programData);
  }

  function getFallbackTableDocument(documentId = DEFAULT_TABLE_DOCUMENT_ID) {
    if (documentId === DEFAULT_TABLE_DOCUMENT_ID && programData) {
      return createTableDocumentFromData(programData);
    }

    return createTableDocumentFromData(createEmptyProgramData("Untitled Project"));
  }

  function getTableDocument(documentId = DEFAULT_TABLE_DOCUMENT_ID) {
    return tableDocuments[documentId] ?? getFallbackTableDocument(documentId);
  }

  function setTableDocumentFromData(documentId, data, options = {}) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const nextDocument = createTableDocumentForCurrentSpreadsheetSettings(data);
    const documentForState = options.markDirty ? { ...nextDocument, isDirty: true } : nextDocument;

    setTableDocuments((documents) => ({
      ...documents,
      [normalizedDocumentId]: documentForState,
    }));

    if (normalizedDocumentId === DEFAULT_TABLE_DOCUMENT_ID) {
      setProgramData(documentForState.programData);
      setDraftProjectName(documentForState.draftProjectName);
      setDraftRows(documentForState.draftRows);
      setCellStyles(documentForState.cellStyles);
    }

    setStackingConflicts((conflicts) =>
      options.rebuildStackingConflicts
        ? mergeStackingConflictsForDocument(conflicts, normalizedDocumentId, documentForState)
        : conflicts.filter((conflict) => conflict.documentId !== normalizedDocumentId),
    );
    setActiveConflictCellKey(null);
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
    setTableHistory(createEmptyTableHistory());
    updateWorkspaceStackingDiagramsForDocument(normalizedDocumentId, documentForState.programData);
  }

  function updateTableDocumentProgramData(documentId, nextProgramData, options = {}) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const currentDocument = getTableDocument(normalizedDocumentId);
    const nextDocument = {
      ...currentDocument,
      programData: nextProgramData,
      isDirty: options.markDirty ? true : currentDocument.isDirty,
    };

    setTableDocuments((documents) => ({
      ...documents,
      [normalizedDocumentId]: nextDocument,
    }));

    if (normalizedDocumentId === DEFAULT_TABLE_DOCUMENT_ID) {
      setProgramData(nextProgramData);
    }

    if (options.rebuildStackingConflicts) {
      setStackingConflicts((conflicts) => mergeStackingConflictsForDocument(conflicts, normalizedDocumentId, nextDocument));
    }

    updateWorkspaceStackingDiagramsForDocument(normalizedDocumentId, nextProgramData);

    return nextDocument;
  }

  function updateTableDocument(documentId, updater, { markDirty = true } = {}) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const fallbackDocument = getTableDocument(normalizedDocumentId);

    setTableDocuments((documents) => {
      const currentDocument = documents[normalizedDocumentId] ?? fallbackDocument;
      const nextDocument = updater(currentDocument);
      return {
        ...documents,
        [normalizedDocumentId]: markDirty ? { ...nextDocument, isDirty: true } : nextDocument,
      };
    });
  }

  function updateSpreadsheetTitle(documentId, value) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const nextTitle = String(value ?? "");
    const currentDocument = getTableDocument(normalizedDocumentId);
    if (currentDocument.draftProjectName === nextTitle) return;

    updateTableDocument(normalizedDocumentId, (tableDocument) => ({
      ...tableDocument,
      draftProjectName: nextTitle,
    }));

    if (normalizedDocumentId === DEFAULT_TABLE_DOCUMENT_ID) {
      setDraftProjectName(nextTitle);
    }
  }

  function getTablePaneDocumentId(paneId) {
    return getTablePaneStateById(paneId).documentId ?? DEFAULT_TABLE_DOCUMENT_ID;
  }

  function getActiveTableDocumentId() {
    return activeTablePaneId ? getTablePaneDocumentId(activeTablePaneId) : DEFAULT_TABLE_DOCUMENT_ID;
  }

  async function refreshAvailableProgramDataFiles() {
    try {
      const response = await fetch(PROGRAM_DATA_FILES_ENDPOINT);
      if (!response.ok) return;

      const data = await parseJsonResponse(response, "program data files");
      setAvailableProgramDataFiles(Array.isArray(data.files) ? data.files : []);
    } catch (error) {
      console.warn(error);
    }
  }

  function toggleSpreadsheetTitleMenu(paneId) {
    const shouldOpen = openSpreadsheetTitlePaneId !== paneId;
    setOpenSpreadsheetTitlePaneId(shouldOpen ? paneId : null);
    if (shouldOpen) refreshAvailableProgramDataFiles();
  }

  function isProjectProgramDataFileId(documentId) {
    return String(documentId ?? "").startsWith("output:") || String(documentId ?? "").startsWith("project:");
  }

  async function loadProgramDataFileDocument(documentId) {
    if (tableDocuments[documentId]) return tableDocuments[documentId].programData;
    if (!isProjectProgramDataFileId(documentId)) return getTableDocument(documentId)?.programData ?? null;

    setLoadingProgramDataFileId(documentId);
    setErrorMessage("");

    try {
      const response = await fetch(`${PROGRAM_DATA_FILE_ENDPOINT}?id=${encodeURIComponent(documentId)}`);
      if (!response.ok) {
        throw await createResponseError(response, "Could not load parsed JSON file");
      }

      const data = await parseJsonResponse(response, "parsed JSON file");
      setTableDocumentFromData(documentId, data);
      return data;
    } finally {
      setLoadingProgramDataFileId(null);
    }
  }

  async function selectTableDocumentForPane(paneId, documentId) {
    setOpenSpreadsheetTitlePaneId(null);

    try {
      await loadProgramDataFileDocument(documentId);
      updateTablePaneState(paneId, (state) => ({
        ...state,
        documentId,
        sortConfig: null,
        advancedSortConfig: null,
        selectedCells: [],
        selectionRanges: [],
        selectionAnchor: null,
      }));
      setActiveTablePaneId(paneId);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  function getAvailableTableDocumentOptions(currentDocumentId) {
    const optionsById = new Map();
    const addOption = (option) => {
      if (!isSelectableSpreadsheetOption(option) || optionsById.has(option.id)) return;
      const label = option.label || getTableDocumentOptionLabel(option.id);

      if (isImportedSpreadsheetDocumentId(option.id) && hasMatchingSavedProgramDataOption(optionsById, option, label)) return;

      optionsById.set(option.id, {
        ...option,
        label,
      });
    };

    for (const file of availableProgramDataFiles) {
      addOption({
        id: file.id,
        label: file.label,
        path: file.path,
        rowCount: file.rowCount,
        source: file.source,
      });
    }

    for (const [documentId, tableDocument] of Object.entries(tableDocuments)) {
      addOption({
        id: documentId,
        label: tableDocument.draftProjectName,
        rowCount: tableDocument.draftRows.length,
        source: "loaded",
      });
    }

    for (const slot of workspaceSlots) {
      if (getWorkspacePaneType(slot) !== "table") continue;
      const documentId = typeof slot === "string" ? DEFAULT_TABLE_DOCUMENT_ID : slot.tableState?.documentId ?? DEFAULT_TABLE_DOCUMENT_ID;
      addOption({
        id: documentId,
        label: getTableDocumentOptionLabel(documentId),
        rowCount: getTableDocument(documentId).draftRows.length,
        source: "pane",
      });
    }

    return [...optionsById.values()];
  }

  function getTableDocumentOptionLabel(documentId) {
    const tableDocument = tableDocuments[documentId] ?? (documentId === DEFAULT_TABLE_DOCUMENT_ID ? getTableDocument(documentId) : null);
    const file = availableProgramDataFiles.find((programFile) => programFile.id === documentId);
    return tableDocument?.draftProjectName || file?.label || "Untitled Project";
  }

  function hasTableDocumentUnsavedEdits(documentId = DEFAULT_TABLE_DOCUMENT_ID) {
    const tableDocument = getTableDocument(documentId);
    return Boolean(tableDocument?.programData && tableDocument.isDirty);
  }

  function applyProjectSnapshot(snapshot) {
    const workspaceState = snapshot.workspaceState ?? {};
    const restoredTableDocuments = restoreTableDocumentsFromWorkspaceState(workspaceState, snapshot.programData);
    const restoredSavedStackingConflicts = restoreStackingConflictsFromWorkspaceState(workspaceState, restoredTableDocuments);
    const restoredStackingConflicts = Object.entries(restoredTableDocuments).flatMap(([documentId, tableDocument]) =>
      deriveStackingConflictsForDocument(documentId, tableDocument, restoredSavedStackingConflicts),
    );
    const defaultDocument = restoredTableDocuments[DEFAULT_TABLE_DOCUMENT_ID] ?? createTableDocumentFromData(snapshot.programData);
    const programTableState = snapshot.tableState?.program ?? {};
    const restoredWorkspaceSlots = validateWorkspaceSlotsBlockingSettings(
      restoreWorkspaceSlots(workspaceState.workspaceSlots),
      restoredTableDocuments,
    );
    const restoredPaneWidths = restoreWorkspacePaneWidths(workspaceState.workspacePaneWidths, restoredWorkspaceSlots.length);
    const restoredActiveTablePaneId = isWorkspacePaneIdInSlots(restoredWorkspaceSlots, workspaceState.activeTablePaneId)
      ? workspaceState.activeTablePaneId
      : null;
    const firstDiagramState = restoredWorkspaceSlots.find((slot) => getWorkspacePaneType(slot) === "diagrams")?.diagramState;

    setProgramData(snapshot.programData);
    setBlankSpreadsheetCellValues(isPlainObject(workspaceState.blankSpreadsheetCellValues) ? workspaceState.blankSpreadsheetCellValues : {});
    setTableDocuments(restoredTableDocuments);
    setDraftProjectName(defaultDocument.draftProjectName);
    setDraftRows(defaultDocument.draftRows);
    setCellStyles(defaultDocument.cellStyles);
    setTableHistory(createEmptyTableHistory());
    setStackingConflicts(restoredStackingConflicts);
    setActiveConflictCellKey(null);
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
    setTableColumnWidths(restoreTableColumnWidths(workspaceState.tableColumnWidths));
    setTableRowHeights(isPlainObject(workspaceState.tableRowHeights) ? workspaceState.tableRowHeights : {});
    setSortConfig(normalizeSortConfig(programTableState.sortConfig));
    setAdvancedSortConfig(normalizeAdvancedSortConfig(programTableState.advancedSortConfig));
    setSelectedTableCells([]);
    setSelectedTableRanges([]);
    setTableSelectionAnchor(null);
    setWorkspaceSlots(restoredWorkspaceSlots);
    setWorkspacePaneWidths(restoredPaneWidths);
    syncWorkspaceToolFlags(restoredWorkspaceSlots);
    setActiveTablePaneId(restoredActiveTablePaneId);
    setActiveWorkspacePane(restoredActiveTablePaneId ? { id: restoredActiveTablePaneId, type: "table" } : null);
    setActiveDiagramView(firstDiagramState?.activeView ?? "stacking");
    setStackingSettings({
      ...createDefaultStackingSettings(),
      ...(firstDiagramState?.stackingSettings ?? {}),
    });
    setSpreadsheetSettings(normalizeSpreadsheetSettings(workspaceState.spreadsheetSettings));
    setDraftSpreadsheetSettings(normalizeSpreadsheetSettings(workspaceState.spreadsheetSettings));
    setIsToolMenuOpen(false);
    setSideToolMenu(null);
    setIsProjectMenuOpen(false);
    setColumnMenu(null);
    setOpenSpreadsheetTitlePaneId(null);
    setSpreadsheetSettingsPaneId(null);
    setEditingTableCell(null);
    setTableSelectionDragState(null);
    setIsExitConfirmOpen(false);
    setPendingTableClosePaneId(null);
    closeAdvancedSortDialog();
    nextWorkspacePaneId.current = Math.max(nextWorkspacePaneId.current, getNextWorkspacePaneId(restoredWorkspaceSlots));
    nextStackingConflictId.current = Math.max(nextStackingConflictId.current, getNextStackingConflictId(restoredStackingConflicts));
  }

  async function handleCreateNewProject() {
    const data = createEmptyProgramData("Untitled Project");
    applyProjectSnapshot({
      programData: data,
      tableState: createDefaultProjectTableState(),
    });
    setWorkspaceSlots([]);
    setWorkspacePaneWidths([]);
    setActiveWorkspacePane(null);
    setActiveTablePaneId(null);
    setIsTableOpen(false);
    setIsDiagramsOpen(false);
    setIsToolMenuOpen(false);
    setSideToolMenu(null);
    setIsStartDialogOpen(false);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const savedData = await putProgramData(data);
      applyProgramData(savedData);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function handleLoadLastProject() {
    setIsLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const response = await fetch(PROJECT_ENDPOINT, { cache: "no-store" });
      if (!response.ok) {
        throw await createResponseError(response, "Could not load last project");
      }

      const snapshot = await parseJsonResponse(response, "last project");
      applyProjectSnapshot(snapshot);
      setIsStartDialogOpen(false);
      setStatusMessage("Loaded last project.");
      refreshAvailableProgramDataFiles();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function openSpreadsheetImportPicker(paneId = null) {
    pendingSpreadsheetImportPaneIdRef.current = paneId;
    spreadsheetImportInputRef.current?.click();
  }

  function openProjectImportPicker() {
    setIsProjectMenuOpen(false);
    projectImportInputRef.current?.click();
  }

  async function handleSpreadsheetImportChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await importSpreadsheetFile(file);
  }

  async function handleProjectImportChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await importProjectFile(file);
  }

  async function importSpreadsheetFile(file) {
    const targetPaneId = pendingSpreadsheetImportPaneIdRef.current;
    const importedDocumentId = targetPaneId ? createImportedTableDocumentId(file) : DEFAULT_TABLE_DOCUMENT_ID;

    setIsImporting(true);
    setActiveSpreadsheetImportPaneId(targetPaneId);
    setIsLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(PROGRAM_IMPORT_ENDPOINT, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw await createResponseError(response, "Could not import spreadsheet");
      }

      const data = await parseJsonResponse(response, "imported spreadsheet");
      if (targetPaneId) {
        setTableDocumentFromData(importedDocumentId, data);
        updateTablePaneState(targetPaneId, (state) => ({
          ...state,
          documentId: importedDocumentId,
          sortConfig: null,
          advancedSortConfig: null,
          selectedCells: [],
          selectionRanges: [],
          selectionAnchor: null,
        }));
        setActiveTablePaneId(targetPaneId);
        setActiveWorkspacePane({ id: targetPaneId, type: "table" });
      } else {
        const tablePane = createWorkspacePane("table", importedDocumentId);
        applyProgramData(data);
        setSortConfig(null);
        setAdvancedSortConfig(null);
        setIsToolMenuOpen(false);
        setSideToolMenu(null);
        setIsDiagramsOpen(false);
        setIsTableOpen(true);
        setWorkspaceSlots([tablePane]);
        setWorkspacePaneWidths([1]);
        setActiveWorkspacePane({ id: tablePane.id, type: "table" });
        setActiveTablePaneId(tablePane.id);
      }
      setIsStartDialogOpen(false);
      await refreshAvailableProgramDataFiles();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      pendingSpreadsheetImportPaneIdRef.current = null;
      setActiveSpreadsheetImportPaneId(null);
      setIsImporting(false);
      setIsLoading(false);
    }
  }

  async function importProjectFile(file) {
    setIsImporting(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(PROJECT_IMPORT_ENDPOINT, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw await createResponseError(response, "Could not import project");
      }

      const snapshot = await parseJsonResponse(response, "imported project");
      applyProjectSnapshot(snapshot);
      setIsStartDialogOpen(false);
      setStatusMessage(`Imported ${file.name}.`);
      refreshAvailableProgramDataFiles();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsImporting(false);
    }
  }

  async function putProgramData(nextData) {
    const response = await fetch(PROGRAM_DATA_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextData),
    });

    if (!response.ok) {
      throw await createResponseError(response, "Could not save program data");
    }

    return parseJsonResponse(response, "saved program data");
  }

  function createProjectSnapshot() {
    const currentProgramData = getCurrentProgramData();

    return {
      programData: currentProgramData,
      tableState: {
        program: {
          sortConfig,
          advancedSortConfig,
        },
      },
      workspaceState: createWorkspaceStateSnapshot(currentProgramData),
    };
  }

  function createWorkspaceStateSnapshot(currentProgramData) {
    const serializableWorkspaceSlots = workspaceSlots.map((slot, index) => createSerializableWorkspaceSlot(slot, index));

    return {
      version: 1,
      workspaceSlots: serializableWorkspaceSlots,
      workspacePaneWidths: getPaneWidthsForCount(serializableWorkspaceSlots.length),
      tableDocuments: createSerializableTableDocuments(currentProgramData),
      blankSpreadsheetCellValues,
      tableColumnWidths,
      tableRowHeights,
      activeTablePaneId: isWorkspacePaneIdInSlots(serializableWorkspaceSlots, activeTablePaneId) ? activeTablePaneId : null,
      stackingConflicts: createSerializableStackingConflicts(),
      activeDiagramView,
      stackingSettings,
      spreadsheetSettings,
    };
  }

  function createSerializableStackingConflicts() {
    return stackingConflicts
      .map(normalizeStackingConflictForSnapshot)
      .filter(Boolean);
  }

  function normalizeStackingConflictForSnapshot(conflict) {
    if (!isPlainObject(conflict)) return null;

    const columnKey = String(conflict.columnKey || "floor");
    if (!allTableColumns.some((column) => column.key === columnKey)) return null;

    const rowIds = Array.isArray(conflict.rowIds)
      ? conflict.rowIds.map((rowId) => String(rowId)).filter(Boolean)
      : [];
    if (rowIds.length === 0) return null;

    return {
      id: String(conflict.id || ""),
      columnKey,
      documentId: String(conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID),
      rowIds: [...new Set(rowIds)],
      segmentLabel: String(conflict.segmentLabel || "Dragged rectangle"),
      sourceDiagramPaneId: String(conflict.sourceDiagramPaneId ?? ""),
      sourceFloorKey: String(conflict.sourceFloorKey ?? ""),
      sourceFloorLabel: String(conflict.sourceFloorLabel || "Previous floor"),
      sourceFloorValue: String(conflict.sourceFloorValue ?? ""),
      status: conflict.status === "ignored" ? "ignored" : "pending",
      targetFloorKey: String(conflict.targetFloorKey ?? ""),
      targetFloorLabel: String(conflict.targetFloorLabel || `Floor ${conflict.targetFloorValue ?? ""}`),
      targetFloorValue: String(conflict.targetFloorValue ?? ""),
    };
  }

  function createSerializableWorkspaceSlot(slot, index) {
    const type = getWorkspacePaneType(slot);
    const id = getWorkspacePaneId(slot, index);

    return {
      id,
      type,
      tableState: normalizeWorkspaceTableState(typeof slot === "string" ? createDefaultTablePaneState() : slot.tableState),
      diagramState: normalizeWorkspaceDiagramState(typeof slot === "string" ? createDefaultDiagramState() : slot.diagramState),
    };
  }

  function createSerializableTableDocuments(currentProgramData) {
    const documents = {};

    for (const [documentId, tableDocument] of Object.entries(tableDocuments)) {
      documents[documentId] = normalizeTableDocumentForSnapshot(documentId, tableDocument, currentProgramData);
    }

    if (!documents[DEFAULT_TABLE_DOCUMENT_ID]) {
      documents[DEFAULT_TABLE_DOCUMENT_ID] = createTableDocumentFromData(currentProgramData);
    }

    return documents;
  }

  function normalizeTableDocumentForSnapshot(documentId, tableDocument, currentProgramData) {
    const fallbackProgramData =
      documentId === DEFAULT_TABLE_DOCUMENT_ID
        ? currentProgramData
        : tableDocument?.programData ?? createEmptyProgramData(tableDocument?.draftProjectName || "Untitled Project");
    const baseDocument = createTableDocumentFromData(fallbackProgramData);
    const draftRowsForSnapshot = Array.isArray(tableDocument?.draftRows) ? tableDocument.draftRows : baseDocument.draftRows;
    const cellStylesForSnapshot = isPlainObject(tableDocument?.cellStyles) ? tableDocument.cellStyles : baseDocument.cellStyles;
    const draftProjectNameForSnapshot = typeof tableDocument?.draftProjectName === "string" ? tableDocument.draftProjectName : baseDocument.draftProjectName;
    const shouldUseCurrentProgramData =
      spreadsheetSettings.distributeIdenticalRooms &&
      documentId === DEFAULT_TABLE_DOCUMENT_ID &&
      fallbackProgramData === currentProgramData;
    const programDataForSnapshot = shouldUseCurrentProgramData
      ? fallbackProgramData
      : mergeRowsIntoProgramData(
          fallbackProgramData,
          draftRowsForSnapshot,
          cellStylesForSnapshot,
          draftProjectNameForSnapshot,
          {
            distributeIdenticalRooms: spreadsheetSettings.distributeIdenticalRooms,
          },
        );

    return {
      programData: programDataForSnapshot,
      draftProjectName: draftProjectNameForSnapshot,
      draftRows: spreadsheetSettings.distributeIdenticalRooms ? createRows(programDataForSnapshot) : draftRowsForSnapshot,
      cellStyles: spreadsheetSettings.distributeIdenticalRooms ? createCellStyles(programDataForSnapshot) : cellStylesForSnapshot,
      isDirty: Boolean(tableDocument?.isDirty),
    };
  }

  function restoreTableDocumentsFromWorkspaceState(workspaceState, fallbackProgramData) {
    const restoredDocuments = {};
    const storedDocuments = isPlainObject(workspaceState?.tableDocuments) ? workspaceState.tableDocuments : {};

    for (const [documentId, tableDocument] of Object.entries(storedDocuments)) {
      if (!documentId || !isPlainObject(tableDocument)) continue;
      restoredDocuments[documentId] = restoreTableDocument(tableDocument, fallbackProgramData);
    }

    if (!restoredDocuments[DEFAULT_TABLE_DOCUMENT_ID]) {
      restoredDocuments[DEFAULT_TABLE_DOCUMENT_ID] = createTableDocumentFromData(fallbackProgramData);
    }

    return restoredDocuments;
  }

  function restoreTableDocument(tableDocument, fallbackProgramData) {
    const baseProgramData = isPlainObject(tableDocument.programData) ? tableDocument.programData : fallbackProgramData;
    const baseDocument = createTableDocumentFromData(baseProgramData);

    return {
      programData: baseProgramData,
      draftProjectName: typeof tableDocument.draftProjectName === "string" ? tableDocument.draftProjectName : baseDocument.draftProjectName,
      draftRows: Array.isArray(tableDocument.draftRows) ? tableDocument.draftRows : baseDocument.draftRows,
      cellStyles: isPlainObject(tableDocument.cellStyles) ? tableDocument.cellStyles : baseDocument.cellStyles,
      isDirty: Boolean(tableDocument.isDirty),
    };
  }

  function restoreStackingConflictsFromWorkspaceState(workspaceState, tableDocumentsForRestore) {
    const storedConflicts = Array.isArray(workspaceState?.stackingConflicts) ? workspaceState.stackingConflicts : [];

    return storedConflicts
      .map((conflict, index) => restoreStackingConflict(conflict, index, tableDocumentsForRestore))
      .filter(Boolean);
  }

  function restoreStackingConflict(conflict, index, tableDocumentsForRestore) {
    const normalizedConflict = normalizeStackingConflictForSnapshot(conflict);
    if (!normalizedConflict) return null;

    const tableDocument = tableDocumentsForRestore[normalizedConflict.documentId];
    const rows = Array.isArray(tableDocument?.draftRows) ? tableDocument.draftRows : [];
    if (rows.length === 0) return null;

    const rowsById = new Map(rows.map((row) => [String(row.id), row]));
    const rowIds = normalizedConflict.rowIds
      .filter((rowId) => {
        const row = rowsById.get(String(rowId));
        if (!row) return false;
        if (normalizedConflict.columnKey !== "floor") return true;
        return !doFloorValuesMatch(row.floor, normalizedConflict.targetFloorValue);
      })
      .map((rowId) => rowsById.get(String(rowId)).id);

    if (rowIds.length === 0) return null;

    return {
      ...normalizedConflict,
      id: normalizedConflict.id || `stacking-conflict-${index + 1}`,
      rowIds,
    };
  }

  function restoreWorkspaceSlots(storedSlots) {
    if (!Array.isArray(storedSlots)) return [];

    return storedSlots
      .map((slot, index) => {
        const type = slot?.type === "table" || slot?.type === "diagrams" ? slot.type : null;
        if (!type) return null;

        return {
          id: normalizeWorkspacePaneId(slot.id, type, index),
          type,
          tableState: normalizeWorkspaceTableState(slot.tableState),
          diagramState: normalizeWorkspaceDiagramState(slot.diagramState),
        };
      })
      .filter(Boolean);
  }

  function validateWorkspaceSlotsBlockingSettings(slots, documentsById) {
    if (!Array.isArray(slots)) return [];

    return slots.map((slot) => {
      if (typeof slot === "string" || getWorkspacePaneType(slot) !== "diagrams") return slot;

      const diagramState = slot.diagramState ?? createDefaultDiagramState();
      const sourceDocumentId = String(diagramState.sourceDocumentId || "");
      const sourceProgramData = sourceDocumentId ? documentsById?.[sourceDocumentId]?.programData : null;
      if (!sourceProgramData) return slot;

      const validation = validateBlockingSettingsForProgramData(sourceProgramData, diagramState.blockingSettings);
      if (!validation.changed) return slot;

      return {
        ...slot,
        diagramState: {
          ...diagramState,
          blockingSettings: validation.settings,
        },
      };
    });
  }

  function normalizeWorkspacePaneId(value, type, index) {
    const id = String(value ?? "").trim();
    return id || `workspace-pane-${type}-${index + 1}`;
  }

  function normalizeWorkspaceTableState(tableState) {
    const selectionRanges = getSelectionRangesFromState(tableState);

    return {
      documentId: String(tableState?.documentId || DEFAULT_TABLE_DOCUMENT_ID),
      sortConfig: normalizeSortConfig(tableState?.sortConfig),
      advancedSortConfig: normalizeAdvancedSortConfig(tableState?.advancedSortConfig),
      selectedCells: [],
      selectionRanges,
      selectionAnchor: normalizeTableCellReference(tableState?.selectionAnchor),
    };
  }

  function normalizeWorkspaceDiagramState(diagramState) {
    const activeView = diagramState?.activeView === DIAGRAM_VIEW_BLOCKING || diagramState?.activeView === "areas"
      ? DIAGRAM_VIEW_BLOCKING
      : DIAGRAM_VIEW_STACKING;

    return {
      activeView,
      stackingSettings: {
        ...createDefaultStackingSettings(),
        ...(isPlainObject(diagramState?.stackingSettings) ? diagramState.stackingSettings : {}),
      },
      blockingSettings: normalizeBlockingSettings(diagramState?.blockingSettings),
      sourceDocumentId: String(diagramState?.sourceDocumentId ?? ""),
      stackingDiagram: diagramState?.stackingDiagram ?? null,
    };
  }

  function normalizeTableCellReference(cell) {
    if (!cell?.rowId || !cell?.columnKey) return null;
    return {
      rowId: String(cell.rowId),
      columnKey: String(cell.columnKey),
    };
  }

  function restoreWorkspacePaneWidths(storedWidths, count) {
    if (count <= 0) return [];
    if (!Array.isArray(storedWidths) || storedWidths.length !== count) return createEqualPaneWidths(count);

    const widths = storedWidths.map((width) => Number(width)).filter((width) => Number.isFinite(width) && width > 0);
    return widths.length === count ? normalizePaneWidths(widths) : createEqualPaneWidths(count);
  }

  function restoreTableColumnWidths(storedWidths) {
    return isPlainObject(storedWidths)
      ? {
          ...createDefaultTableColumnWidths(),
          ...storedWidths,
        }
      : createDefaultTableColumnWidths();
  }

  function isWorkspacePaneIdInSlots(slots, paneId) {
    if (!paneId) return false;
    return slots.some((slot, index) => getWorkspacePaneId(slot, index) === paneId);
  }

  function getNextWorkspacePaneId(slots) {
    let nextId = 1;

    for (const slot of slots) {
      const match = String(slot?.id ?? "").match(/^workspace-pane-(\d+)$/);
      if (!match) continue;
      nextId = Math.max(nextId, Number(match[1]) + 1);
    }

    return nextId;
  }

  function getNextStackingConflictId(conflicts) {
    let nextId = 1;

    for (const conflict of conflicts) {
      const match = String(conflict?.id ?? "").match(/^stacking-conflict-(\d+)$/);
      if (!match) continue;
      nextId = Math.max(nextId, Number(match[1]) + 1);
    }

    return nextId;
  }

  function getCurrentProgramData() {
    const defaultDocument = tableDocuments[DEFAULT_TABLE_DOCUMENT_ID];

    if (defaultDocument?.programData) {
      return isTableOpen
        ? mergeRowsIntoProgramData(
            defaultDocument.programData,
            defaultDocument.draftRows,
            defaultDocument.cellStyles,
            defaultDocument.draftProjectName,
            {
              distributeIdenticalRooms: spreadsheetSettings.distributeIdenticalRooms,
            },
          )
        : defaultDocument.programData;
    }

    if (!programData) {
      return createEmptyProgramData(normalizeProjectName(draftProjectName) || "Untitled Project");
    }

    return isTableOpen
      ? mergeRowsIntoProgramData(programData, draftRows, cellStyles, draftProjectName, {
          distributeIdenticalRooms: spreadsheetSettings.distributeIdenticalRooms,
        })
      : programData;
  }

  async function saveProjectToBackend() {
    setIsProjectSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const response = await fetch(PROJECT_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createProjectSnapshot()),
      });

      if (!response.ok) {
        throw await createResponseError(response, "Could not save project");
      }

      await parseJsonResponse(response, "saved project");
      setStatusMessage("Project saved.");
      showSavedBanner();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsProjectSaving(false);
    }
  }

  function showSavedBanner() {
    if (saveBannerTimeoutRef.current) {
      window.clearTimeout(saveBannerTimeoutRef.current);
    }

    setSaveBannerKey((key) => key + 1);
    saveBannerTimeoutRef.current = window.setTimeout(() => {
      setSaveBannerKey(0);
      saveBannerTimeoutRef.current = null;
    }, SAVE_BANNER_DURATION_MS);
  }

  async function exportProjectFile() {
    setIsProjectMenuOpen(false);
    setIsProjectSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const snapshot = createProjectSnapshot();
      const response = await fetch(PROJECT_EXPORT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });

      if (!response.ok) {
        throw await createResponseError(response, "Could not export project");
      }

      const blob = await response.blob();
      const didSave = await saveBlobToFile(blob, `${sanitizeFileName(getProgramTitle(snapshot.programData))}.signal`);
      if (didSave) {
        await rememberProjectArchive(blob);
        setStatusMessage("Project exported.");
      }
    } catch (error) {
      if (error.name !== "AbortError") setErrorMessage(error.message);
    } finally {
      setIsProjectSaving(false);
    }
  }

  function toggleProjectMenu(event) {
    event.stopPropagation();
    setIsProjectMenuOpen((isOpen) => !isOpen);
  }

  function toggleToolMenu() {
    setSideToolMenu(null);
    setIsToolMenuOpen((isOpen) => !isOpen);
  }

  function toggleSideToolMenu(side) {
    setIsToolMenuOpen(false);
    setSideToolMenu((currentSide) => (currentSide === side ? null : side));
  }

  function openDiagrams() {
    const diagramsPane = createWorkspacePane("diagrams");
    setIsToolMenuOpen(false);
    setSideToolMenu(null);
    setIsTableOpen(false);
    setIsExitConfirmOpen(false);
    setIsDiagramsOpen(true);
    setWorkspaceSlots([diagramsPane]);
    setWorkspacePaneWidths([1]);
    setActiveWorkspacePane({ id: diagramsPane.id, type: "diagrams" });
    refreshAvailableProgramDataFiles();
  }

  function closeDiagrams() {
    const nextSlots = workspaceSlots.filter((slot) => getWorkspacePaneType(slot) !== "diagrams");
    setWorkspaceSlots(nextSlots);
    setWorkspacePaneWidths(createEqualPaneWidths(nextSlots.length));
    syncWorkspaceToolFlags(nextSlots);
    setSideToolMenu(null);
    setActiveWorkspacePane((currentPane) => (currentPane?.type === "diagrams" ? null : currentPane));
  }

  function getCurrentWorkspaceSlots() {
    if (workspaceSlots.length > 0) return workspaceSlots;
    if (isTableOpen) return [createWorkspacePane("table")];
    if (isDiagramsOpen) return [createWorkspacePane("diagrams")];
    return [];
  }

  function placeToolInWorkspaceSlots(tool, side, nextPane = createWorkspacePane(tool)) {
    const currentSlots = getCurrentWorkspaceSlots();
    return side === "left" ? [nextPane, ...currentSlots] : [...currentSlots, nextPane];
  }

  function createWorkspacePane(type, tableDocumentId = DEFAULT_TABLE_DOCUMENT_ID) {
    const id = `workspace-pane-${nextWorkspacePaneId.current}`;
    nextWorkspacePaneId.current += 1;
    return {
      id,
      type,
      tableState: createDefaultTablePaneState(tableDocumentId),
      diagramState: createDefaultDiagramState(),
    };
  }

  function getWorkspacePaneType(slot) {
    return typeof slot === "string" ? slot : slot.type;
  }

  function getWorkspacePaneId(slot, index) {
    return typeof slot === "string" ? `${slot}-${index}` : slot.id;
  }

  function activateWorkspacePane(paneId, paneType) {
    if (!paneId || !paneType) return;
    setActiveWorkspacePane((currentPane) =>
      currentPane?.id === paneId && currentPane?.type === paneType
        ? currentPane
        : { id: paneId, type: paneType },
    );
    if (paneType === "table") setActiveTablePaneId(paneId);
  }

  function clearActiveWorkspacePane(paneId) {
    setActiveWorkspacePane((currentPane) => (currentPane?.id === paneId ? null : currentPane));
  }

  function isTablePanelActiveForKeyboard() {
    return !activeWorkspacePane || activeWorkspacePane.type === "table";
  }

  function isDiagramPanelActiveForKeyboard() {
    return activeWorkspacePane?.type === "diagrams" || (!activeWorkspacePane && isDiagramsOpen && !isTableOpen);
  }

  function getActiveDiagramPaneEntry() {
    const activeDiagramPaneId = activeWorkspacePane?.type === "diagrams" ? activeWorkspacePane.id : "";
    const diagramPaneEntries = workspaceSlots
      .map((slot, index) => ({
        slot,
        index,
        paneId: getWorkspacePaneId(slot, index),
      }))
      .filter((entry) => getWorkspacePaneType(entry.slot) === "diagrams");

    if (activeDiagramPaneId) {
      return diagramPaneEntries.find((entry) => entry.paneId === activeDiagramPaneId) ?? null;
    }

    return diagramPaneEntries[0] ?? null;
  }

  function clearActiveDiagramProgrammingSelection() {
    const activeDiagramPaneEntry = getActiveDiagramPaneEntry();
    const activeDiagramPane = activeDiagramPaneEntry?.slot;
    if (!activeDiagramPane || typeof activeDiagramPane === "string") return false;

    const diagramState = activeDiagramPane.diagramState ?? createDefaultDiagramState();
    if (normalizeDiagramView(diagramState.activeView) !== DIAGRAM_VIEW_BLOCKING) return false;

    const blockingSettings = normalizeBlockingSettings(diagramState.blockingSettings);
    const sourceProgramData = diagramState.sourceDocumentId
      ? tableDocuments[diagramState.sourceDocumentId]?.programData
      : null;
    const floorTabs = getBlockingFloorTabs(sourceProgramData, blockingSettings);
    const activeFloorKey = getActiveBlockingFloorKey(blockingSettings, floorTabs);
    const activeFloorSettings = getBlockingFloorSettings(blockingSettings, activeFloorKey);
    const shouldClearProgramming =
      Boolean(activeFloorSettings.selectedProgrammingKey) ||
      blockingSettings.activeTool === BLOCKING_TOOL_NONE;

    if (!shouldClearProgramming) return false;

    updateWorkspacePane(activeDiagramPaneEntry.paneId, (pane) => {
      const currentState = pane.diagramState ?? createDefaultDiagramState();
      const currentBlockingSettings = normalizeBlockingSettings(currentState.blockingSettings);
      const currentSourceProgramData = currentState.sourceDocumentId
        ? tableDocuments[currentState.sourceDocumentId]?.programData
        : null;
      const currentFloorTabs = getBlockingFloorTabs(currentSourceProgramData, currentBlockingSettings);
      const currentActiveFloorKey = getActiveBlockingFloorKey(currentBlockingSettings, currentFloorTabs);
      const currentFloorSettings = getBlockingFloorSettings(currentBlockingSettings, currentActiveFloorKey);

      return {
        ...pane,
        diagramState: {
          ...currentState,
          blockingSettings: normalizeBlockingSettings({
            ...currentBlockingSettings,
            activeTool: BLOCKING_TOOL_SELECT,
            floorSettings: {
              ...currentBlockingSettings.floorSettings,
              [currentActiveFloorKey]: normalizeBlockingFloorSettings({
                ...currentFloorSettings,
                selectedProgrammingKey: "",
              }),
            },
          }),
        },
      };
    });

    return true;
  }

  function syncWorkspaceToolFlags(slots) {
    setIsTableOpen(slots.some((slot) => getWorkspacePaneType(slot) === "table"));
    setIsDiagramsOpen(slots.some((slot) => getWorkspacePaneType(slot) === "diagrams"));
  }

  function createEqualPaneWidths(count) {
    if (count <= 0) return [];
    return Array.from({ length: count }, () => 1 / count);
  }

  function normalizePaneWidths(widths) {
    if (widths.length === 0) return [];
    const total = widths.reduce((sum, width) => sum + Math.max(0.01, width), 0);
    return widths.map((width) => Math.max(0.01, width) / total);
  }

  function getPaneWidthsForCount(count) {
    if (workspacePaneWidths.length === count) return normalizePaneWidths(workspacePaneWidths);
    return createEqualPaneWidths(count);
  }

  function getPaneWidthsWithAddedPane(currentCount, side) {
    if (currentCount <= 0) return [1];
    const currentWidths = getPaneWidthsForCount(currentCount);
    const newPaneWidth = 1 / (currentCount + 1);
    const scaledWidths = currentWidths.map((width) => width * (1 - newPaneWidth));
    return normalizePaneWidths(side === "left" ? [newPaneWidth, ...scaledWidths] : [...scaledWidths, newPaneWidth]);
  }

  function getPaneWidthsWithoutPane(paneId) {
    const currentWidths = getPaneWidthsForCount(workspaceSlots.length);
    const nextWidths = workspaceSlots
      .map((slot, index) => ({ id: getWorkspacePaneId(slot, index), width: currentWidths[index] }))
      .filter((pane) => pane.id !== paneId)
      .map((pane) => pane.width);
    return normalizePaneWidths(nextWidths);
  }

  function updateWorkspacePane(paneId, updater) {
    setWorkspaceSlots((slots) =>
      slots.map((slot, index) => {
        if (getWorkspacePaneId(slot, index) !== paneId || typeof slot === "string") return slot;
        return updater(slot);
      }),
    );
  }

  function updateTablePaneState(paneId, updater) {
    if (!paneId) {
      const nextState = updater({
        documentId: DEFAULT_TABLE_DOCUMENT_ID,
        sortConfig,
        advancedSortConfig,
        selectedCells: selectedTableCells,
        selectionRanges: selectedTableRanges,
        selectionAnchor: tableSelectionAnchor,
      });
      setSortConfig(nextState.sortConfig ?? null);
      setAdvancedSortConfig(nextState.advancedSortConfig ?? null);
      setSelectedTableRanges(getSelectionRangesFromState(nextState));
      setSelectedTableCells([]);
      setTableSelectionAnchor(nextState.selectionAnchor ?? null);
      return;
    }

    updateWorkspacePane(paneId, (pane) => ({
      ...pane,
      tableState: updater(pane.tableState ?? createDefaultTablePaneState()),
    }));
  }

  function getTablePaneStateById(paneId) {
    const pane = workspaceSlots.find((slot, index) => getWorkspacePaneId(slot, index) === paneId);
    return typeof pane === "string" ? createDefaultTablePaneState() : pane?.tableState ?? createDefaultTablePaneState();
  }

  function createTableHistorySnapshot(overrides = {}) {
    return {
      tableDocuments,
      draftRows,
      cellStyles,
      blankSpreadsheetCellValues,
      tableColumnWidths,
      tableRowHeights,
      stackingConflicts,
      ...overrides,
    };
  }

  function createDiagramHistorySnapshot() {
    return createTableHistorySnapshot({ workspaceSlots });
  }

  function pushTableHistorySnapshot(snapshot = createTableHistorySnapshot()) {
    if (!snapshot) return;

    setTableHistory((history) => ({
      past: [...history.past, snapshot].slice(-MAX_TABLE_HISTORY_ENTRIES),
      future: [],
    }));
  }

  function applyTableHistorySnapshot(snapshot) {
    if (!snapshot) return;

    setTableDocuments(snapshot.tableDocuments ?? {});
    setDraftRows(snapshot.draftRows ?? []);
    setCellStyles(snapshot.cellStyles ?? {});
    setBlankSpreadsheetCellValues(snapshot.blankSpreadsheetCellValues ?? {});
    setTableColumnWidths(snapshot.tableColumnWidths ?? createDefaultTableColumnWidths());
    setTableRowHeights(snapshot.tableRowHeights ?? {});
    setStackingConflicts(snapshot.stackingConflicts ?? []);
    setActiveConflictCellKey(null);
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);

    if (Array.isArray(snapshot.workspaceSlots)) {
      const nextWorkspaceSlots = snapshot.workspaceSlots;
      setWorkspaceSlots(nextWorkspaceSlots);
      setWorkspacePaneWidths((widths) =>
        widths.length === nextWorkspaceSlots.length ? widths : createEqualPaneWidths(nextWorkspaceSlots.length),
      );
      syncWorkspaceToolFlags(nextWorkspaceSlots);
      setActiveWorkspacePane((currentPane) =>
        currentPane && isWorkspacePaneIdInSlots(nextWorkspaceSlots, currentPane.id) ? currentPane : null,
      );
      setActiveTablePaneId((currentPaneId) =>
        isWorkspacePaneIdInSlots(nextWorkspaceSlots, currentPaneId) ? currentPaneId : null,
      );
    }
  }

  function undoTableAction() {
    if (tableHistory.past.length === 0) return;

    const previousSnapshot = tableHistory.past[tableHistory.past.length - 1];
    const currentSnapshot = createTableHistorySnapshot(
      Array.isArray(previousSnapshot.workspaceSlots) ? { workspaceSlots } : {},
    );
    applyTableHistorySnapshot(previousSnapshot);
    setEditingTableCell(null);
    setTableHistory({
      past: tableHistory.past.slice(0, -1),
      future: [currentSnapshot, ...tableHistory.future].slice(0, MAX_TABLE_HISTORY_ENTRIES),
    });
  }

  function redoTableAction() {
    if (tableHistory.future.length === 0) return;

    const nextSnapshot = tableHistory.future[0];
    const currentSnapshot = createTableHistorySnapshot(
      Array.isArray(nextSnapshot.workspaceSlots) ? { workspaceSlots } : {},
    );
    applyTableHistorySnapshot(nextSnapshot);
    setEditingTableCell(null);
    setTableHistory({
      past: [...tableHistory.past, currentSnapshot].slice(-MAX_TABLE_HISTORY_ENTRIES),
      future: tableHistory.future.slice(1),
    });
  }

  function registerTableShell(paneId, element) {
    if (!paneId || !element) return;

    const viewKey = getTableViewKeyFromElement(element);
    restoreTableViewportMetrics(paneId, element, viewKey);
    updateTableViewportMetrics(paneId, element, viewKey);
  }

  function captureCurrentTableViewportMetrics() {
    if (typeof document === "undefined") return;

    const elements = [...document.querySelectorAll(".table-shell[data-table-pane-id]")].filter(
      (element) => element instanceof HTMLElement,
    );
    if (elements.length === 0) return;

    setTableViewportMetrics((metricsByPaneId) =>
      elements.reduce((nextMetricsByPaneId, element) => {
        const paneId = element.dataset.tablePaneId;
        const viewKey = getTableViewKeyFromElement(element);
        return setTableViewportMetricsForPane(nextMetricsByPaneId, paneId, viewKey, readTableViewportMetrics(element));
      }, metricsByPaneId),
    );
  }

  function restoreTableViewportMetrics(paneId, element, viewKey) {
    const metrics = getTableViewportMetricsFromState(tableViewportMetricsRef.current, paneId, viewKey);
    if (!metrics) return;

    if (element.scrollLeft !== metrics.scrollLeft) {
      element.scrollLeft = metrics.scrollLeft;
    }
    if (element.scrollTop !== metrics.scrollTop) {
      element.scrollTop = metrics.scrollTop;
    }
  }

  function updateTableViewportMetrics(paneId, element, viewKey = TABLE_VIEW_SPREADSHEET) {
    if (!paneId || !element) return;

    const nextMetrics = readTableViewportMetrics(element);

    setTableViewportMetrics((metricsByPaneId) => {
      return setTableViewportMetricsForPane(metricsByPaneId, paneId, viewKey, nextMetrics);
    });
  }

  function getTableViewportMetricsForPane(paneId, viewKey) {
    return getTableViewportMetricsFromState(tableViewportMetrics, paneId, viewKey);
  }

  function getTableViewportMetricsFromState(metricsByPaneId, paneId, viewKey) {
    const paneMetrics = metricsByPaneId?.[paneId];
    if (!paneMetrics) return null;
    if (isTableViewportMetrics(paneMetrics)) {
      return viewKey === TABLE_VIEW_SPREADSHEET ? paneMetrics : null;
    }

    return isTableViewportMetrics(paneMetrics[viewKey]) ? paneMetrics[viewKey] : null;
  }

  function setTableViewportMetricsForPane(metricsByPaneId, paneId, viewKey, nextMetrics) {
    if (!paneId || !isTableViewportMetrics(nextMetrics)) return metricsByPaneId;

    const normalizedViewKey = viewKey === TABLE_VIEW_HIERARCHICAL ? TABLE_VIEW_HIERARCHICAL : TABLE_VIEW_SPREADSHEET;
    const paneMetrics = metricsByPaneId[paneId];
    const currentMetrics = getTableViewportMetricsFromState(metricsByPaneId, paneId, normalizedViewKey);
    if (areTableViewportMetricsEqual(currentMetrics, nextMetrics)) return metricsByPaneId;

    const nextPaneMetrics = isTableViewportMetrics(paneMetrics)
      ? { [TABLE_VIEW_SPREADSHEET]: paneMetrics }
      : { ...(isPlainObject(paneMetrics) ? paneMetrics : {}) };

    return {
      ...metricsByPaneId,
      [paneId]: {
        ...nextPaneMetrics,
        [normalizedViewKey]: nextMetrics,
      },
    };
  }

  function readTableViewportMetrics(element) {
    return {
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
    };
  }

  function areTableViewportMetricsEqual(currentMetrics, nextMetrics) {
    return Boolean(
      currentMetrics &&
        currentMetrics.scrollLeft === nextMetrics.scrollLeft &&
        currentMetrics.scrollTop === nextMetrics.scrollTop &&
        currentMetrics.clientWidth === nextMetrics.clientWidth &&
        currentMetrics.clientHeight === nextMetrics.clientHeight,
    );
  }

  function isTableViewportMetrics(value) {
    return Boolean(
      value &&
        Number.isFinite(value.scrollLeft) &&
        Number.isFinite(value.scrollTop) &&
        Number.isFinite(value.clientWidth) &&
        Number.isFinite(value.clientHeight),
    );
  }

  function getTableViewKeyFromElement(element) {
    return element?.dataset?.tableView === TABLE_VIEW_HIERARCHICAL ? TABLE_VIEW_HIERARCHICAL : TABLE_VIEW_SPREADSHEET;
  }

  function getActiveTableSelectedCells() {
    return getTableNavigationContext(activeTablePaneId ?? null).selectedCells;
  }

  function closeWorkspacePane(paneId) {
    const nextSlots = workspaceSlots.filter((slot, index) => getWorkspacePaneId(slot, index) !== paneId);
    const nextWidths = getPaneWidthsWithoutPane(paneId);
    setWorkspaceSlots(nextSlots);
    setWorkspacePaneWidths(nextWidths);
    syncWorkspaceToolFlags(nextSlots);
    setSideToolMenu(null);
    clearActiveWorkspacePane(paneId);
    if (openSpreadsheetTitlePaneId === paneId) setOpenSpreadsheetTitlePaneId(null);
    if (activeTablePaneId === paneId) setActiveTablePaneId(null);
    if (advancedSortPaneId === paneId) closeAdvancedSortDialog();

    if (!nextSlots.some((slot) => getWorkspacePaneType(slot) === "table")) {
      setIsAdvancedSortOpen(false);
      setIsAdvancedCancelConfirmOpen(false);
      setIsExitConfirmOpen(false);
      setColumnMenu(null);
      clearTableSelection();
    }
  }

  async function prepareTableForWorkspace() {
    setIsExitConfirmOpen(false);
    setStatusMessage("");
    setErrorMessage("");

    if (programData) {
      if (!tableDocuments[DEFAULT_TABLE_DOCUMENT_ID]) {
        setTableDocumentFromData(DEFAULT_TABLE_DOCUMENT_ID, programData);
      }
      clearTableSelection();
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(PROGRAM_DATA_ENDPOINT);
      if (!response.ok) {
        throw new Error(`Could not load program data (${response.status}).`);
      }
      const data = await parseJsonResponse(response, "program data");
      applyProgramData(data);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function openWorkspaceTool(tool, side = "right") {
    const currentSlots = getCurrentWorkspaceSlots();
    const nextPane = createWorkspacePane(tool);
    const nextSlots = placeToolInWorkspaceSlots(tool, side, nextPane);
    setIsToolMenuOpen(false);
    setSideToolMenu(null);
    setWorkspaceSlots(nextSlots);
    setWorkspacePaneWidths(getPaneWidthsWithAddedPane(currentSlots.length, side));
    setActiveWorkspacePane({ id: nextPane.id, type: tool });
    if (tool === "table") setActiveTablePaneId(nextPane.id);
    syncWorkspaceToolFlags(nextSlots);

    if (nextSlots.some((slot) => getWorkspacePaneType(slot) === "table")) {
      await prepareTableForWorkspace();
    }

    if (nextSlots.some((slot) => getWorkspacePaneType(slot) === "diagrams")) {
      refreshAvailableProgramDataFiles();
    }
  }

  async function openTable() {
    const tablePane = createWorkspacePane("table");
    setIsToolMenuOpen(false);
    setSideToolMenu(null);
    setIsDiagramsOpen(false);
    setIsTableOpen(true);
    setWorkspaceSlots([tablePane]);
    setWorkspacePaneWidths([1]);
    setActiveWorkspacePane({ id: tablePane.id, type: "table" });
    setActiveTablePaneId(tablePane.id);
    await prepareTableForWorkspace();
  }

  function updateRow(rowId, field, value, documentId = DEFAULT_TABLE_DOCUMENT_ID, { recordHistory = true } = {}) {
    const tableDocument = getTableDocument(documentId);
    const existingRow = tableDocument.draftRows.find((row) => row.id === rowId);
    const isExistingRow = Boolean(existingRow);

    if (!isExistingRow && tableDocument.draftRows.length === 0) {
      const currentValue = blankSpreadsheetCellValues[documentId]?.[rowId]?.[field] ?? "";
      if (String(currentValue) === String(value ?? "")) return;
      if (recordHistory) pushTableHistorySnapshot();

      setBlankSpreadsheetCellValues((values) => ({
        ...values,
        [documentId]: {
          ...(values[documentId] ?? {}),
          [rowId]: {
            ...(values[documentId]?.[rowId] ?? {}),
            [field]: value,
          },
        },
      }));
      return;
    }

    if (!existingRow || String(existingRow[field] ?? "") === String(value ?? "")) return;
    if (recordHistory) pushTableHistorySnapshot();

    const nextRows = tableDocument.draftRows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row));
    const nextDocument = {
      ...tableDocument,
      draftRows: nextRows,
    };

    updateTableDocument(documentId, () => nextDocument);
    if ((documentId || DEFAULT_TABLE_DOCUMENT_ID) === DEFAULT_TABLE_DOCUMENT_ID) {
      setDraftRows(nextRows);
    }
    if (field === "floor") {
      setStackingConflicts((conflicts) => mergeStackingConflictsForDocument(conflicts, documentId, nextDocument));
    }
  }

  function handleStackingSegmentFloorChange(sourceDocumentId, change, sourceDiagramPaneId = "") {
    const targetFloorValue = getStackingConflictFloorValue(change.targetFloor, change.targetFloorKey);
    const documentId = sourceDocumentId || DEFAULT_TABLE_DOCUMENT_ID;
    const tableDocument = getTableDocument(documentId);
    const representedRowIds = getStackingSegmentRepresentedRowIds(tableDocument, change);
    if (representedRowIds.length === 0) return;

    const targetFloorId = getFloorIdForStackingValue(targetFloorValue, `floor-${change.targetFloorKey ?? targetFloorValue}`);
    const floorIdsByItemId = new Map(representedRowIds.map((rowId) => [String(rowId), targetFloorId]));
    const nextDocumentsById = new Map();

    for (const { documentId: candidateDocumentId, tableDocument: candidateDocument } of getStackingConflictCandidateDocuments(documentId)) {
      const candidateItemIds = new Set((candidateDocument.programData?.program_items ?? []).map((item) => String(item.id ?? "")));
      const candidateFloorIdsByItemId = new Map(
        [...floorIdsByItemId].filter(([rowId]) => candidateItemIds.has(String(rowId))),
      );
      if (candidateFloorIdsByItemId.size === 0) continue;

      const result = updateProgramDataFloorAssignments(candidateDocument.programData, candidateFloorIdsByItemId, "diagram");
      if (!result.changed) continue;

      nextDocumentsById.set(candidateDocumentId, {
        ...candidateDocument,
        programData: result.data,
        isDirty: true,
      });
    }

    if (nextDocumentsById.size === 0) return;

    setTableDocuments((documents) => ({
      ...documents,
      ...Object.fromEntries(nextDocumentsById),
    }));

    const defaultDocument = nextDocumentsById.get(DEFAULT_TABLE_DOCUMENT_ID);
    if (defaultDocument) {
      setProgramData(defaultDocument.programData);
    }

    for (const [candidateDocumentId, nextDocument] of nextDocumentsById) {
      updateWorkspaceStackingDiagramsForDocument(candidateDocumentId, nextDocument.programData);
    }

    setStackingConflicts((conflicts) => {
      let nextConflicts = conflicts;
      for (const [candidateDocumentId, nextDocument] of nextDocumentsById) {
        nextConflicts = mergeStackingConflictsForDocument(nextConflicts, candidateDocumentId, nextDocument);
      }
      return nextConflicts;
    });

    const nextDocumentConflicts = [...nextDocumentsById].flatMap(([candidateDocumentId, nextDocument]) =>
      deriveStackingConflictsForDocument(candidateDocumentId, nextDocument, stackingConflicts),
    );
    const affectedRowIds = new Set(representedRowIds);
    const visibleConflict = nextDocumentConflicts.find(
      (conflict) =>
        conflict.status === "pending" &&
        conflict.rowIds.some((rowId) => affectedRowIds.has(rowId)) &&
        getTablePaneIdsForDocument(conflict.documentId).length > 0,
    ) ?? nextDocumentConflicts.find((conflict) => conflict.status === "pending" && conflict.rowIds.some((rowId) => affectedRowIds.has(rowId)));

    setConflictMenu(null);
    if (visibleConflict) {
      const nextCellKey = getDocumentCellKey(visibleConflict.documentId, visibleConflict.rowIds[0], visibleConflict.columnKey);
      setActiveConflictCellKey(nextCellKey);
      scrollTableConflictIntoView(visibleConflict.documentId, visibleConflict.rowIds[0], visibleConflict.columnKey, {
        rowIds: visibleConflict.rowIds,
      });
    } else {
      setActiveConflictCellKey((currentCellKey) => {
        if (!currentCellKey) return currentCellKey;
        return [...nextDocumentsById.keys()].some((candidateDocumentId) =>
          representedRowIds.some((rowId) => getDocumentCellKey(candidateDocumentId, rowId, "floor") === currentCellKey),
        )
          ? null
          : currentCellKey;
      });
    }
  }

  function getStackingConflictCandidateDocuments(preferredDocumentId) {
    const candidates = new Map();
    const preferredDocument = preferredDocumentId ? getTableDocument(preferredDocumentId) : null;
    const preferredProgramData = preferredDocument?.programData ?? null;
    const addCandidate = (documentId, tableDocument) => {
      const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
      const document = tableDocument ?? getTableDocument(normalizedDocumentId);
      if (!document?.draftRows?.length) return;
      if (
        preferredProgramData &&
        normalizedDocumentId !== (preferredDocumentId || DEFAULT_TABLE_DOCUMENT_ID) &&
        !doProgramDataSourcesMatch(preferredProgramData, document.programData)
      ) {
        return;
      }
      candidates.set(normalizedDocumentId, {
        documentId: normalizedDocumentId,
        tableDocument: document,
      });
    };

    if (preferredDocumentId) addCandidate(preferredDocumentId, preferredDocument);
    for (const [documentId, tableDocument] of Object.entries(tableDocuments)) {
      addCandidate(documentId, tableDocument);
    }
    addCandidate(DEFAULT_TABLE_DOCUMENT_ID, getTableDocument(DEFAULT_TABLE_DOCUMENT_ID));

    return [...candidates.values()];
  }

  function updateLinkedDocumentsDiagramFloorAssignments(preferredDocumentId, floorIdsByItemId) {
    const nextDocumentsById = new Map();

    for (const { documentId: candidateDocumentId, tableDocument: candidateDocument } of getStackingConflictCandidateDocuments(preferredDocumentId)) {
      const candidateItemIds = new Set((candidateDocument.programData?.program_items ?? []).map((item) => String(item.id ?? "")));
      const candidateFloorIdsByItemId = new Map(
        [...floorIdsByItemId].filter(([rowId]) => candidateItemIds.has(String(rowId))),
      );
      if (candidateFloorIdsByItemId.size === 0) continue;

      const result = updateProgramDataFloorAssignments(candidateDocument.programData, candidateFloorIdsByItemId, "diagram");
      if (!result.changed) continue;

      nextDocumentsById.set(candidateDocumentId, {
        ...candidateDocument,
        programData: result.data,
        isDirty: true,
      });
    }

    return nextDocumentsById;
  }

  function applyUpdatedTableDocuments(nextDocumentsById) {
    if (!(nextDocumentsById instanceof Map) || nextDocumentsById.size === 0) return;

    setTableDocuments((documents) => ({
      ...documents,
      ...Object.fromEntries(nextDocumentsById),
    }));

    const defaultDocument = nextDocumentsById.get(DEFAULT_TABLE_DOCUMENT_ID);
    if (defaultDocument) {
      setProgramData(defaultDocument.programData);
    }
  }

  function refreshUpdatedWorkspaceStackingDiagrams(nextDocumentsById) {
    for (const [candidateDocumentId, nextDocument] of nextDocumentsById) {
      updateWorkspaceStackingDiagramsForDocument(candidateDocumentId, nextDocument.programData);
    }
  }

  function refreshLinkedWorkspaceStackingDiagrams(preferredDocumentId) {
    for (const { documentId: candidateDocumentId, tableDocument: candidateDocument } of getStackingConflictCandidateDocuments(preferredDocumentId)) {
      updateWorkspaceStackingDiagramsForDocument(candidateDocumentId, candidateDocument.programData);
    }
  }

  function buildStackingDiagramForSource(sourceProgramData, paneSettings) {
    return buildHealthcareStackingDiagram(
      sourceProgramData,
      getEffectiveStackingSettingsForProgramData(sourceProgramData, paneSettings),
    );
  }

  function updateWorkspaceStackingDiagramsForDocument(documentId, sourceProgramData) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;

    setWorkspaceSlots((slots) =>
      slots.map((slot, index) => {
        if (typeof slot === "string" || getWorkspacePaneType(slot) !== "diagrams") return slot;

        const diagramState = slot.diagramState ?? createDefaultDiagramState();
        if ((diagramState.sourceDocumentId || "") !== normalizedDocumentId) return slot;

        const blockingValidation = validateBlockingSettingsForProgramData(sourceProgramData, diagramState.blockingSettings);
        const nextDiagramState = {
          ...diagramState,
          stackingDiagram: buildStackingDiagramForSource(
            sourceProgramData,
            diagramState.stackingSettings ?? createDefaultStackingSettings(),
          ),
        };
        if (blockingValidation.changed) {
          nextDiagramState.blockingSettings = blockingValidation.settings;
        }

        return {
          ...slot,
          diagramState: nextDiagramState,
        };
      }),
    );
  }

  function getTablePaneIdsForDocument(documentId) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const slots = workspaceSlots.length > 0 ? workspaceSlots : (isTableOpen ? ["table"] : []);

    return slots
      .map((slot, index) => {
        if (getWorkspacePaneType(slot) !== "table") return null;
        const paneId = getWorkspacePaneId(slot, index);
        const paneDocumentId = typeof slot === "string"
          ? DEFAULT_TABLE_DOCUMENT_ID
          : slot.tableState?.documentId ?? DEFAULT_TABLE_DOCUMENT_ID;
        return paneDocumentId === normalizedDocumentId ? paneId : null;
      })
      .filter(Boolean);
  }

  function getPreferredTablePaneIdForDocument(documentId) {
    const tablePaneIds = getTablePaneIdsForDocument(documentId);
    if (activeTablePaneId && tablePaneIds.includes(activeTablePaneId)) return activeTablePaneId;
    return tablePaneIds[0] ?? null;
  }

  function getTablePaneEntries() {
    const slots = workspaceSlots.length > 0 ? workspaceSlots : (isTableOpen ? ["table"] : []);

    return slots
      .map((slot, index) => {
        if (getWorkspacePaneType(slot) !== "table") return null;
        const paneId = getWorkspacePaneId(slot, index);
        const tableState = typeof slot === "string"
          ? createDefaultTablePaneState()
          : slot.tableState ?? createDefaultTablePaneState();

        return {
          paneId,
          tableState,
          documentId: tableState.documentId ?? DEFAULT_TABLE_DOCUMENT_ID,
        };
      })
      .filter(Boolean);
  }

  function getTablePaneTargetForDocument(documentId) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const tablePaneEntries = getTablePaneEntries();
    const matchingEntries = tablePaneEntries.filter((entry) => entry.documentId === normalizedDocumentId);
    const activeMatchingEntry = matchingEntries.find((entry) => entry.paneId === activeTablePaneId);
    if (activeMatchingEntry) return activeMatchingEntry;
    if (matchingEntries[0]) return matchingEntries[0];

    const activeEntry = tablePaneEntries.find((entry) => entry.paneId === activeTablePaneId);
    if (activeEntry) return activeEntry;
    return tablePaneEntries[0] ?? null;
  }

  function createBlockingHierarchyTableState(documentId, baseState, target) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const shouldKeepTableState = (baseState?.documentId ?? DEFAULT_TABLE_DOCUMENT_ID) === normalizedDocumentId;
    const nextState = shouldKeepTableState
      ? {
          ...baseState,
          documentId: normalizedDocumentId,
        }
      : createDefaultTablePaneState(normalizedDocumentId);

    if (target?.rowId) {
      const cell = { rowId: target.rowId, columnKey: "program" };
      return {
        ...nextState,
        selectedCells: [],
        selectionRanges: [createSelectionRange(cell)],
        selectionAnchor: cell,
      };
    }

    return {
      ...nextState,
      selectedCells: [],
      selectionRanges: [],
      selectionAnchor: null,
    };
  }

  function applyBlockingHierarchyTableState(paneTarget, documentId, tableState) {
    if (paneTarget?.paneId) {
      updateTablePaneState(paneTarget.paneId, () => tableState);
      return paneTarget.paneId;
    }

    const tablePane = {
      ...createWorkspacePane("table", documentId || DEFAULT_TABLE_DOCUMENT_ID),
      tableState,
    };
    const currentSlots = workspaceSlots.length > 0 ? workspaceSlots : getCurrentWorkspaceSlots();
    const nextSlots = [...currentSlots, tablePane];
    setSideToolMenu(null);
    setWorkspaceSlots(nextSlots);
    setWorkspacePaneWidths(getPaneWidthsWithAddedPane(currentSlots.length, "right"));
    syncWorkspaceToolFlags(nextSlots);
    return tablePane.id;
  }

  function ensureHierarchicalSpreadsheetView() {
    if (spreadsheetSettings.view === TABLE_VIEW_HIERARCHICAL) return;

    captureCurrentTableViewportMetrics();
    finishTableCellEdit();
    const nextSettings = normalizeSpreadsheetSettings({
      ...spreadsheetSettings,
      view: TABLE_VIEW_HIERARCHICAL,
    });
    setSpreadsheetSettings(nextSettings);
    setDraftSpreadsheetSettings((settings) => normalizeSpreadsheetSettings({
      ...settings,
      view: TABLE_VIEW_HIERARCHICAL,
    }));
  }

  function clearBlockingHierarchyFocus() {
    if (blockingHierarchyFocus?.paneId && blockingHierarchyFocus.rowId) {
      updateTablePaneState(blockingHierarchyFocus.paneId, (state) => ({
        ...state,
        selectedCells: [],
        selectionRanges: [],
        selectionAnchor: null,
      }));
    }

    setBlockingHierarchyFocus(null);
  }

  function focusBlockingSelectionInHierarchy(sourceDocumentId, selectedShapes, requestedLevel) {
    const selectedProgrammingAttribute = (selectedShapes ?? [])
      .map((shape) => normalizeBlockingProgrammingAttribute(shape?.programmingAttribute))
      .find(Boolean);

    if (!selectedProgrammingAttribute) {
      clearBlockingHierarchyFocus();
      return;
    }

    const documentId = sourceDocumentId || DEFAULT_TABLE_DOCUMENT_ID;
    const paneTarget = getTablePaneTargetForDocument(documentId);
    const targetTableState = paneTarget?.tableState ?? createDefaultTablePaneState(documentId);
    const target = getBlockingHierarchyFocusTarget(documentId, targetTableState, selectedProgrammingAttribute, requestedLevel);
    if (!target) {
      clearBlockingHierarchyFocus();
      return;
    }

    ensureHierarchicalSpreadsheetView();
    const nextTableState = createBlockingHierarchyTableState(documentId, targetTableState, target);
    const paneId = applyBlockingHierarchyTableState(paneTarget, documentId, nextTableState);
    setActiveTablePaneId(paneId);
    setBlockingHierarchyFocus({
      documentId,
      paneId,
      level: target.level,
      nodeKey: target.nodeKey ?? null,
      rowId: target.rowId ?? null,
    });

    if (target.rowId) {
      const cell = { rowId: target.rowId, columnKey: "program" };
      expandHierarchyToConflictRows(documentId, paneId, [target.rowId]);
      requestHierarchyScroll(() =>
        scrollTableCellsIntoCenteredView(paneId, [target.rowId], cell.columnKey, {
          behavior: "smooth",
          topInset: 16,
        }),
      );
      return;
    }

    if (target.nodeKey) {
      expandHierarchyToNode(documentId, paneId, target.nodeKey);
      requestHierarchyScroll(() =>
        scrollHierarchyNodeIntoView(paneId, target.nodeKey, {
          behavior: "smooth",
        }),
      );
    }
  }

  function getBlockingHierarchyFocusTarget(documentId, tableState, programmingAttribute, requestedLevel) {
    const tableDocument = getTableDocument(documentId);
    if (!tableDocument?.programData) return null;

    const rows = getTableRowsForDisplay(
      documentId,
      tableDocument,
      tableState.sortConfig ?? null,
      tableState.advancedSortConfig ?? null,
    );
    if (rows.length === 0) return null;

    const rowIdSet = new Set(rows.map((row) => String(row.id ?? "")).filter(Boolean));
    const hierarchy = buildSpreadsheetHierarchy(tableDocument.programData, rows);
    const requestedHierarchyLevel = getBlockingLevelOfDetailValue(requestedLevel, programmingAttribute.level);
    const programmedRowId = getBlockingProgrammingAttributeRowId(programmingAttribute);

    if (programmedRowId && rowIdSet.has(programmedRowId)) {
      if (requestedHierarchyLevel === "room") {
        return { level: "room", rowId: programmedRowId };
      }

      const rowNode = findHierarchyNodeForRowAtLevel(hierarchy, programmedRowId, requestedHierarchyLevel);
      if (rowNode) return { level: rowNode.level, nodeKey: rowNode.key };
      return { level: "room", rowId: programmedRowId };
    }

    const sourceNode = findHierarchyNodeByKey(hierarchy, programmingAttribute.key);
    if (!sourceNode) return null;

    if (requestedHierarchyLevel === "room") {
      const sourceRowIds = getHierarchyNodeRowIds(sourceNode);
      if (sourceRowIds.length === 1) return { level: "room", rowId: sourceRowIds[0] };
      return { level: sourceNode.level, nodeKey: sourceNode.key };
    }

    const targetNode =
      getHierarchyNodeForRequestedLevel(hierarchy, sourceNode, requestedHierarchyLevel) ??
      sourceNode;

    return { level: targetNode.level, nodeKey: targetNode.key };
  }

  function getBlockingProgrammingAttributeRowId(programmingAttribute) {
    const key = String(programmingAttribute?.key ?? "");
    return key.startsWith("room:") ? key.slice("room:".length) : "";
  }

  function getHierarchyNodeForRequestedLevel(root, sourceNode, requestedLevel) {
    if (!sourceNode || !requestedLevel || requestedLevel === "room") return null;
    if (sourceNode.level === requestedLevel) return sourceNode;

    const ancestorNode = findHierarchyAncestorNodeAtLevel(root, sourceNode.key, requestedLevel);
    if (ancestorNode) return ancestorNode;

    const descendantNodes = [];
    collectHierarchyNodesAtLevel(sourceNode, requestedLevel, descendantNodes);
    return descendantNodes.length === 1 ? descendantNodes[0] : null;
  }

  function findHierarchyAncestorNodeAtLevel(root, nodeKey, level) {
    const nodePath = findHierarchyNodePath(root, nodeKey);
    return nodePath.find((node) => node.level === level) ?? null;
  }

  function findHierarchyNodePath(node, nodeKey, path = []) {
    if (!node) return [];

    const nextPath = [...path, node];
    if (node.key === nodeKey) return nextPath;

    for (const child of node.children ?? []) {
      const childPath = findHierarchyNodePath(child, nodeKey, nextPath);
      if (childPath.length > 0) return childPath;
    }

    return [];
  }

  function collectHierarchyNodesAtLevel(node, level, nodes) {
    if (!node) return;
    if (node.level === level) nodes.push(node);
    for (const child of node.children ?? []) collectHierarchyNodesAtLevel(child, level, nodes);
  }

  function findHierarchyNodeForRowAtLevel(node, rowId, level) {
    if (!doesHierarchyNodeContainRow(node, rowId)) return null;
    if (node.level === level) return node;

    for (const child of node.children ?? []) {
      const childNode = findHierarchyNodeForRowAtLevel(child, rowId, level);
      if (childNode) return childNode;
    }

    return null;
  }

  function doesHierarchyNodeContainRow(node, rowId) {
    const normalizedRowId = String(rowId ?? "");
    if (!normalizedRowId) return false;
    if ((node.rows ?? []).some((row) => String(row.id ?? "") === normalizedRowId)) return true;
    return (node.children ?? []).some((child) => doesHierarchyNodeContainRow(child, normalizedRowId));
  }

  function findHierarchyNodeByKey(node, nodeKey) {
    if (!node || !nodeKey) return null;
    if (node.key === nodeKey) return node;

    for (const child of node.children ?? []) {
      const match = findHierarchyNodeByKey(child, nodeKey);
      if (match) return match;
    }

    return null;
  }

  function expandHierarchyToNode(documentId, paneId, nodeKey) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const tableDocument = getTableDocument(normalizedDocumentId);
    const tableState = getTablePaneStateById(paneId);
    const rows = getTableRowsForDisplay(
      normalizedDocumentId,
      tableDocument,
      tableState.sortConfig ?? null,
      tableState.advancedSortConfig ?? null,
    );
    const hierarchy = buildSpreadsheetHierarchy(tableDocument.programData, rows);
    const nodePath = findHierarchyNodePath(hierarchy, nodeKey).filter((node) => node.key !== "root");
    if (nodePath.length === 0) return false;

    openHierarchyNodeKeys(paneId, normalizedDocumentId, nodePath.map((node) => node.key));
    return true;
  }

  function openHierarchyNodeKeys(paneId, documentId, nodeKeys) {
    const openNodeKeys = [...new Set((nodeKeys ?? []).filter(Boolean))];
    if (openNodeKeys.length === 0) return false;

    const stateKey = getHierarchyOpenStateKey(paneId, documentId || DEFAULT_TABLE_DOCUMENT_ID);
    setHierarchyNodeOpenStates((states) => {
      const currentState = states[stateKey] ?? {};
      const nextState = { ...currentState };
      let changed = false;

      for (const nodeKey of openNodeKeys) {
        if (nextState[nodeKey] === true) continue;
        nextState[nodeKey] = true;
        changed = true;
      }

      return changed
        ? {
            ...states,
            [stateKey]: nextState,
          }
        : states;
    });

    return true;
  }

  function requestHierarchyScroll(callback) {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(callback);
    });
  }

  function scrollTableConflictIntoView(documentId, rowId, columnKey, options = {}) {
    if (typeof document === "undefined") return;

    const tablePaneIds = getTablePaneIdsForDocument(documentId);
    const paneId = tablePaneIds.includes(options.paneId) ? options.paneId : tablePaneIds[0];
    if (!paneId) return;

    const conflictRowIds = [
      ...new Set(
        (Array.isArray(options.rowIds) && options.rowIds.length > 0 ? options.rowIds : [rowId])
          .map((currentRowId) => String(currentRowId ?? ""))
          .filter(Boolean),
      ),
    ];
    const tableState = getTablePaneStateById(paneId);
    const tableDocument = getTableDocument(documentId);
    const rows = getTableRowsForDisplay(
      documentId,
      tableDocument,
      tableState.sortConfig ?? null,
      tableState.advancedSortConfig ?? null,
    );
    const columnsForDocument = getTableColumnsForDocument(tableDocument, spreadsheetSettings);
    const rowIndexes = conflictRowIds
      .map((conflictRowId) => rows.findIndex((row) => String(row.id) === conflictRowId))
      .filter((rowIndex) => rowIndex >= 0);
    const columnIndex = columnsForDocument.findIndex((column) => column.key === columnKey);

    if (rowIndexes.length === 0 || columnIndex < 0) return;

    const paneSelector = `[data-pane-id="${escapeAttributeSelectorValue(paneId)}"]`;
    const shell = document.querySelector(`${paneSelector} .table-shell`);
    if (
      shell instanceof HTMLElement &&
      shell.dataset.tableView === TABLE_VIEW_HIERARCHICAL
    ) {
      expandHierarchyToConflictRows(documentId, paneId, conflictRowIds);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() =>
          scrollTableCellsIntoCenteredView(paneId, conflictRowIds, columnKey, {
            behavior: options.behavior ?? "smooth",
          }),
        );
      });
      return;
    }

    const firstRowIndex = Math.min(...rowIndexes);
    const lastRowIndex = Math.max(...rowIndexes);
    const headerHeight = getRenderedTableHeaderHeight();
    const conflictTop = headerHeight + rows
      .slice(0, firstRowIndex)
      .reduce((sum, row) => sum + getRenderedTableRowHeight(row.id), 0);
    const conflictBottom = conflictTop + rows
      .slice(firstRowIndex, lastRowIndex + 1)
      .reduce((sum, row) => sum + getRenderedTableRowHeight(row.id), 0);
    const conflictLeft = TABLE_ROW_NUMBER_COLUMN_WIDTH + columnsForDocument
      .slice(0, columnIndex)
      .reduce((sum, column) => sum + getTableColumnWidth(column.key), 0);
    const conflictRight = conflictLeft + getTableColumnWidth(columnKey);

    window.requestAnimationFrame(() => {
      const currentShell = document.querySelector(`${paneSelector} .table-shell`);
      if (!(currentShell instanceof HTMLElement)) return;

      const top = getCenteredScrollValueForRange(
        conflictTop,
        conflictBottom,
        currentShell.clientHeight,
        currentShell.scrollHeight,
        headerHeight,
      );
      const left = getCenteredScrollValueForRange(
        conflictLeft,
        conflictRight,
        currentShell.clientWidth,
        currentShell.scrollWidth,
      );

      currentShell.scrollTo({
        top,
        left,
        behavior: options.behavior ?? "smooth",
      });
    });
  }

  function focusFirstStackingConflictForDocument(documentId) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const conflict = stackingConflicts.find(
      (currentConflict) =>
        currentConflict.documentId === normalizedDocumentId &&
        currentConflict.status === "pending" &&
        currentConflict.rowIds.length > 0,
    );
    if (!conflict) return;

    const rowId = conflict.rowIds[0];
    setActiveConflictCellKey(getDocumentCellKey(normalizedDocumentId, rowId, conflict.columnKey));
    setConflictMenu(null);
    scrollTableConflictIntoView(normalizedDocumentId, rowId, conflict.columnKey, {
      rowIds: conflict.rowIds,
    });
  }

  function focusStackingConflict(conflictId, paneId = null) {
    const conflict = stackingConflicts.find((currentConflict) => currentConflict.id === conflictId);
    if (!conflict || conflict.rowIds.length === 0) return;

    const documentId = conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const tablePaneIds = getTablePaneIdsForDocument(documentId);
    const targetPaneId = tablePaneIds.includes(paneId) ? paneId : tablePaneIds[0];
    const rowId = conflict.rowIds[0];
    setActiveConflictCellKey(getDocumentCellKey(documentId, rowId, conflict.columnKey));
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
    expandHierarchyToConflictRows(documentId, targetPaneId, conflict.rowIds);
    scrollTableConflictIntoView(documentId, rowId, conflict.columnKey, {
      paneId: targetPaneId,
      rowIds: conflict.rowIds,
    });
  }

  function getStackingConflictRowIdsForSegmentFloorChange(documentId, change, sourceFloorValue) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const segmentLabel = normalizeStackingGroupKey(change.segment?.label ?? "");
    if (!segmentLabel) return [];

    return [
      ...new Set(
        stackingConflicts.flatMap((conflict) => {
          if ((conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID) !== normalizedDocumentId || conflict.columnKey !== "floor") return [];
          if (normalizeStackingGroupKey(conflict.segmentLabel ?? "") !== segmentLabel) return [];
          if (!doFloorValuesMatch(conflict.targetFloorValue, sourceFloorValue)) return [];
          return conflict.rowIds ?? [];
        }),
      ),
    ];
  }

  function getStackingSegmentRepresentedRowIds(tableDocument, change) {
    const sourceItemIds = [...new Set((change.segment?.sourceItemIds ?? []).map((rowId) => String(rowId)).filter(Boolean))];
    const sourceFloorValue = getStackingConflictFloorValue(change.sourceFloor, change.sourceFloorKey);
    const segmentLabel = normalizeStackingGroupKey(change.segment?.label ?? "");
    if (!segmentLabel) return sourceItemIds;

    const programData = tableDocument.programData ?? {};
    const departmentsById = new Map((programData.departments ?? []).map((department) => [department.id, department]));
    const groupsById = new Map((programData.program_groups ?? []).map((group) => [group.id, group]));
    const itemsById = new Map((programData.program_items ?? []).map((item) => [item.id, item]));

    const fallbackRowIds = (tableDocument.draftRows ?? [])
      .filter((row) => {
        const item = itemsById.get(row.id);
        const itemDiagramFloorValue = normalizeFloorConflictValue(
          getProgramDataFloorValue(programData, getProgramItemDiagramFloorId(item), getProgramItemDiagramFloorId(item)),
          getProgramItemDiagramFloorId(item),
        );
        if (!doFloorValuesMatch(itemDiagramFloorValue, sourceFloorValue)) return false;
        const group = groupsById.get(item?.program_group_id ?? row.groupId);
        const department = departmentsById.get(group?.department_id ?? item?.extensions?.department_id ?? row.departmentId);
        return getStackingConflictRowLabels(row, item, group, department)
          .some((value) => normalizeStackingGroupKey(value ?? "") === segmentLabel);
      })
      .map((row) => row.id);

    return [...new Set([...sourceItemIds, ...fallbackRowIds])];
  }

  function getStackingConflictRowLabels(row, item, group, department) {
    return [
      row.department,
      row.programGroup,
      row.program,
      department?.name,
      group?.name,
      item?.name,
      item?.source_ref?.original_label,
      readStackingProperty(item, ["department_name", "departmentName"]),
      readStackingProperty(item, ["department_function", "departmentFunction", "department_function_name", "departmentFunctionName"]),
      readStackingProperty(group, ["department_function", "departmentFunction", "department_function_name", "departmentFunctionName"]),
      readStackingProperty(department, ["department_function", "departmentFunction", "department_function_name", "departmentFunctionName"]),
      readStackingProperty(item, ["functional_area", "functionalArea", "functional_area_name", "functionalAreaName"]),
      readStackingProperty(group, ["functional_area", "functionalArea", "functional_area_name", "functionalAreaName"]),
      readStackingProperty(department, ["functional_area", "functionalArea", "functional_area_name", "functionalAreaName"]),
      readStackingProperty(item, ["functional_group", "functionalGroup", "functional_group_name", "functionalGroupName"]),
      readStackingProperty(group, ["functional_group", "functionalGroup", "functional_group_name", "functionalGroupName"]),
      readStackingProperty(department, ["functional_group", "functionalGroup", "functional_group_name", "functionalGroupName"]),
    ].filter((value) => value !== undefined && value !== null && value !== "");
  }

  function getPendingStackingConflictsForDocument(documentId) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    return stackingConflicts.filter(
      (conflict) =>
        (conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID) === normalizedDocumentId &&
        conflict.status === "pending" &&
        (conflict.rowIds?.length ?? 0) > 0,
    );
  }

  function getUnresolvedStackingConflictsForDocument(documentId) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    return stackingConflicts.filter(
      (conflict) =>
        (conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID) === normalizedDocumentId &&
        (conflict.status === "pending" || conflict.status === "ignored") &&
        (conflict.rowIds?.length ?? 0) > 0,
    );
  }

  function getRowsWithAppliedStackingConflicts(documentId, rows) {
    const pendingConflicts = getPendingStackingConflictsForDocument(documentId);
    if (pendingConflicts.length === 0) return rows;

    return rows.map((row) => {
      let matchingConflict = null;
      for (let index = pendingConflicts.length - 1; index >= 0; index -= 1) {
        const conflict = pendingConflicts[index];
        if (
          conflict.columnKey === "floor" &&
          conflict.rowIds.includes(row.id) &&
          !doFloorValuesMatch(row.floor, conflict.targetFloorValue)
        ) {
          matchingConflict = conflict;
          break;
        }
      }

      return matchingConflict ? { ...row, floor: matchingConflict.targetFloorValue } : row;
    });
  }

  function resolveStackingConflict(conflictId) {
    resolveStackingConflicts([conflictId]);
  }

  function updateStackingConflictDiagramToMatch(conflictId) {
    const conflict = stackingConflicts.find((currentConflict) => currentConflict.id === conflictId);
    if (!conflict) return;

    const documentId = conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const sourceFloorId = getFloorIdForStackingValue(
      conflict.sourceFloorValue,
      conflict.sourceFloorKey || `floor-${conflict.sourceFloorValue}`,
    );
    const floorIdsByItemId = new Map((conflict.rowIds ?? []).map((rowId) => [String(rowId), sourceFloorId]));

    const nextDocumentsById = updateLinkedDocumentsDiagramFloorAssignments(documentId, floorIdsByItemId);
    if (nextDocumentsById.size === 0) {
      refreshLinkedWorkspaceStackingDiagrams(documentId);
      setStackingConflicts((conflicts) => conflicts.filter((currentConflict) => currentConflict.id !== conflictId));
      setActiveConflictCellKey(null);
      setConflictMenu(null);
      setFooterConflictMenuPaneId(null);
      return;
    }

    applyUpdatedTableDocuments(nextDocumentsById);
    refreshUpdatedWorkspaceStackingDiagrams(nextDocumentsById);
    setStackingConflicts((conflicts) => {
      let nextConflicts = conflicts;
      for (const [candidateDocumentId, nextDocument] of nextDocumentsById) {
        nextConflicts = mergeStackingConflictsForDocument(nextConflicts, candidateDocumentId, nextDocument);
      }
      return nextConflicts.filter((currentConflict) => currentConflict.id !== conflictId);
    });
    setActiveConflictCellKey(null);
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
  }

  function getStackingConflictSpreadsheetFloorValue(conflict) {
    const documentId = conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const tableDocument = getTableDocument(documentId);
    const rowsById = new Map((tableDocument.draftRows ?? []).map((row) => [row.id, row]));
    const candidateValues = [];

    for (const rowId of conflict.rowIds ?? []) {
      const row = rowsById.get(rowId);
      const floorValue = String(row?.floor ?? "").trim();
      if (!floorValue || doFloorValuesMatch(floorValue, conflict.targetFloorValue)) continue;
      candidateValues.push(floorValue);
    }

    return (
      candidateValues.find((floorValue) => doFloorValuesMatch(floorValue, conflict.sourceFloorValue)) ??
      candidateValues[0] ??
      String(conflict.sourceFloorValue ?? "").trim()
    );
  }

  function updateWorkspaceSlotsForStackingConflictDiagram(slots, conflict, spreadsheetFloorValue) {
    const candidatePaneGroups = getStackingConflictDiagramPaneCandidateGroups(slots, conflict);

    for (const candidatePaneIds of candidatePaneGroups) {
      let matched = false;
      let changed = false;
      const nextSlots = slots.map((slot, index) => {
        if (typeof slot === "string" || getWorkspacePaneType(slot) !== "diagrams") return slot;

        const paneId = getWorkspacePaneId(slot, index);
        if (!candidatePaneIds.has(paneId)) return slot;

        const diagramState = slot.diagramState ?? createDefaultDiagramState();
        const result = updateStackingDiagramToMatchConflictFloor(
          diagramState.stackingDiagram,
          conflict,
          spreadsheetFloorValue,
        );
        if (!result.matched) return slot;

        matched = true;
        if (!result.changed) return slot;

        changed = true;
        return {
          ...slot,
          diagramState: {
            ...diagramState,
            stackingDiagram: result.diagram,
          },
        };
      });

      if (matched) {
        return {
          slots: changed ? nextSlots : slots,
          matched,
        };
      }
    }

    return { slots, matched: false };
  }

  function getStackingConflictDiagramPaneCandidateGroups(slots, conflict) {
    const normalizedDocumentId = conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const sourceDiagramPaneId = String(conflict.sourceDiagramPaneId ?? "");
    const diagramPanes = slots
      .map((slot, index) => (
        typeof slot === "string" || getWorkspacePaneType(slot) !== "diagrams"
          ? null
          : {
              paneId: getWorkspacePaneId(slot, index),
              sourceDocumentId: slot.diagramState?.sourceDocumentId ?? "",
            }
      ))
      .filter(Boolean);
    const candidateGroups = [];

    if (sourceDiagramPaneId) {
      const sourcePaneIds = diagramPanes
        .filter((pane) => pane.paneId === sourceDiagramPaneId)
        .map((pane) => pane.paneId);
      if (sourcePaneIds.length > 0) candidateGroups.push(new Set(sourcePaneIds));
    }

    const sourceDocumentPaneIds = diagramPanes
      .filter((pane) => pane.sourceDocumentId === normalizedDocumentId)
      .map((pane) => pane.paneId);
    if (sourceDocumentPaneIds.length > 0) candidateGroups.push(new Set(sourceDocumentPaneIds));

    if (candidateGroups.length === 0 && diagramPanes.length === 1) {
      candidateGroups.push(new Set([diagramPanes[0].paneId]));
    }

    return candidateGroups;
  }

  function resolveStackingConflicts(conflictIds) {
    const conflictIdSet = new Set(conflictIds);
    const conflictsToResolve = stackingConflicts.filter((conflict) => conflictIdSet.has(conflict.id));
    if (conflictsToResolve.length === 0) return;

    const conflictsByDocument = new Map();
    for (const conflict of conflictsToResolve) {
      const documentId = conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID;
      const documentConflicts = conflictsByDocument.get(documentId) ?? [];
      documentConflicts.push(conflict);
      conflictsByDocument.set(documentId, documentConflicts);
    }

    const nextDocumentsById = new Map();
    let changed = false;
    let rowsChanged = false;

    for (const [documentId, documentConflicts] of conflictsByDocument) {
      const tableDocument = getTableDocument(documentId);
      const floorIdsByItemId = new Map();
      const nextRows = tableDocument.draftRows.map((row) => {
        let matchingConflict = null;
        for (let index = documentConflicts.length - 1; index >= 0; index -= 1) {
          const conflict = documentConflicts[index];
          if (conflict.rowIds.includes(row.id) && !doFloorValuesMatch(row.floor, conflict.targetFloorValue)) {
            matchingConflict = conflict;
            break;
          }
        }
        if (!matchingConflict) return row;

        const targetFloorId = getFloorIdForStackingValue(
          matchingConflict.targetFloorValue,
          matchingConflict.targetFloorKey || `floor-${matchingConflict.targetFloorValue}`,
        );
        floorIdsByItemId.set(String(row.id), targetFloorId);
        return { ...row, floor: matchingConflict.targetFloorValue };
      });

      const floorResult = updateProgramDataFloorAssignments(tableDocument.programData, floorIdsByItemId, "spreadsheet");
      const didRowsChange = nextRows.some((row, index) => row !== tableDocument.draftRows[index]);
      if (didRowsChange || floorResult.changed) {
        changed = true;
        rowsChanged = rowsChanged || didRowsChange;
        nextDocumentsById.set(documentId, {
          ...tableDocument,
          programData: floorResult.changed ? floorResult.data : tableDocument.programData,
          draftRows: nextRows,
          isDirty: true,
        });
      }
    }

    if (rowsChanged) pushTableHistorySnapshot();

    if (changed) {
      setTableDocuments((documents) => ({
        ...documents,
        ...Object.fromEntries(nextDocumentsById),
      }));

      const defaultDocument = nextDocumentsById.get(DEFAULT_TABLE_DOCUMENT_ID);
      if (defaultDocument) {
        setProgramData(defaultDocument.programData);
        setDraftRows(defaultDocument.draftRows);
      }

      refreshUpdatedWorkspaceStackingDiagrams(nextDocumentsById);
    }

    setStackingConflicts((conflicts) => {
      let nextConflicts = conflicts;
      for (const [documentId, nextDocument] of nextDocumentsById) {
        nextConflicts = mergeStackingConflictsForDocument(nextConflicts, documentId, nextDocument);
      }
      return nextConflicts.filter((conflict) => !conflictIdSet.has(conflict.id));
    });
    setActiveConflictCellKey(null);
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
  }

  function ignoreStackingConflict(conflictId) {
    setStackingConflicts((conflicts) =>
      conflicts.map((conflict) =>
        conflict.id === conflictId
          ? {
              ...conflict,
              status: conflict.status === "ignored" ? "pending" : "ignored",
            }
          : conflict,
      ),
    );
    setActiveConflictCellKey(null);
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
  }

  function ignoreStackingConflicts(conflictIds) {
    const conflictIdSet = new Set(conflictIds);
    if (conflictIdSet.size === 0) return;

    setStackingConflicts((conflicts) =>
      {
        const targetConflicts = conflicts.filter((conflict) => conflictIdSet.has(conflict.id));
        const shouldUnignoreAll = targetConflicts.length > 0 && targetConflicts.every((conflict) => conflict.status === "ignored");

        return conflicts.map((conflict) =>
          conflictIdSet.has(conflict.id)
            ? {
                ...conflict,
                status: shouldUnignoreAll ? "pending" : "ignored",
              }
            : conflict,
        );
      },
    );
    setActiveConflictCellKey(null);
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
  }

  function reconcileStackingConflictsForCell(documentId, rowId, columnKey, value) {
    if (columnKey !== "floor") return;

    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    setStackingConflicts((conflicts) =>
      conflicts
        .map((conflict) => {
          if (conflict.documentId !== normalizedDocumentId || !conflict.rowIds.includes(rowId)) return conflict;
          if (!doFloorValuesMatch(value, conflict.targetFloorValue)) return conflict;

          return {
            ...conflict,
            rowIds: conflict.rowIds.filter((conflictRowId) => conflictRowId !== rowId),
          };
        })
        .filter((conflict) => conflict.rowIds.length > 0),
    );
  }

  function handleStackingConflictCellInteraction(documentId, rowId, columnKey) {
    const conflict = getStackingConflictForCell(documentId, rowId, columnKey);
    if (!conflict) return;
    setActiveConflictCellKey(getDocumentCellKey(documentId, rowId, columnKey));
    setConflictMenu(null);
  }

  function getStackingConflictForCell(documentId, rowId, columnKey) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    return stackingConflicts.find(
      (conflict) =>
        conflict.documentId === normalizedDocumentId &&
        conflict.columnKey === columnKey &&
        conflict.rowIds.includes(rowId),
    ) ?? null;
  }

  function renderStackingConflictControl(stackingConflict, documentCellKey) {
    if (!stackingConflict) return null;

    const isConflictMenuOpen =
      conflictMenu?.conflictId === stackingConflict.id &&
      conflictMenu?.cellKey === documentCellKey;

    return (
      <div
        className="stacking-conflict-control"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className={[
            "stacking-conflict-button",
            stackingConflict.status === "ignored" ? "is-ignored" : "",
          ].filter(Boolean).join(" ")}
          type="button"
          aria-label="Show information conflict"
          aria-expanded={isConflictMenuOpen}
          onClick={() => {
            setFooterConflictMenuPaneId(null);
            setConflictMenu((currentMenu) =>
              currentMenu?.conflictId === stackingConflict.id && currentMenu?.cellKey === documentCellKey
                ? null
                : {
                    cellKey: documentCellKey,
                    conflictId: stackingConflict.id,
                  },
            );
          }}
        >
          <span aria-hidden="true">!</span>
        </button>
        {isConflictMenuOpen && (
          <div className="stacking-conflict-menu" role="dialog" aria-label="Information conflict">
            <p>
              <strong>Information conflict:</strong>{" "}
              {getStackingConflictExplanation(stackingConflict)}
            </p>
            <div className="stacking-conflict-menu-actions">
              <button type="button" onClick={() => resolveStackingConflict(stackingConflict.id)}>
                Update to match diagram
              </button>
              <button type="button" onClick={() => updateStackingConflictDiagramToMatch(stackingConflict.id)}>
                Update diagram to match
              </button>
              <button
                className={stackingConflict.status === "ignored" ? "is-toggle-on" : ""}
                type="button"
                aria-pressed={stackingConflict.status === "ignored"}
                onClick={() => ignoreStackingConflict(stackingConflict.id)}
              >
                Temporarily ignore
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function getVisibleStackingConflictAnchorCellKeys(documentId, visibleRows) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const visibleRowIds = visibleRows.map(({ row }) => row.id);
    const anchorKeys = new Set();

    for (const conflict of stackingConflicts) {
      if (conflict.documentId !== normalizedDocumentId) continue;

      const activeRowId = conflict.rowIds.find(
        (rowId) => getDocumentCellKey(normalizedDocumentId, rowId, conflict.columnKey) === activeConflictCellKey,
      );
      if (activeRowId && visibleRowIds.includes(activeRowId)) {
        anchorKeys.add(getDocumentCellKey(normalizedDocumentId, activeRowId, conflict.columnKey));
        continue;
      }

      const visibleRowId = visibleRowIds.find((rowId) => conflict.rowIds.includes(rowId));
      if (visibleRowId) anchorKeys.add(getDocumentCellKey(normalizedDocumentId, visibleRowId, conflict.columnKey));
    }

    return anchorKeys;
  }

  function getHierarchyNodeRowIds(node) {
    return [
      ...(node.rows ?? []).map((row) => String(row.id ?? "")).filter(Boolean),
      ...(node.children ?? []).flatMap((child) => getHierarchyNodeRowIds(child)),
    ];
  }

  function getHierarchyNodePendingConflicts(documentId, node) {
    const rowIdSet = new Set(getHierarchyNodeRowIds(node));
    if (rowIdSet.size === 0) return [];

    return getPendingStackingConflictsForDocument(documentId).filter((conflict) =>
      (conflict.rowIds ?? []).some((rowId) => rowIdSet.has(String(rowId ?? ""))),
    );
  }

  function shouldShowHierarchyNodeConflictButton(documentId, node, isOpen) {
    if (isOpen && ((node.children?.length ?? 0) > 0 || (node.rows?.length ?? 0) > 0)) return false;
    return getHierarchyNodePendingConflicts(documentId, node).length > 0;
  }

  function focusHierarchyNodeConflict(documentId, paneId, node) {
    const nodeConflicts = getHierarchyNodePendingConflicts(documentId, node);
    const firstConflict = nodeConflicts[0];
    if (!firstConflict) return;

    const nodeRowIdSet = new Set(getHierarchyNodeRowIds(node));
    const conflictRowIds = [
      ...new Set(
        nodeConflicts
          .flatMap((conflict) => conflict.rowIds ?? [])
          .filter((rowId) => nodeRowIdSet.has(String(rowId ?? ""))),
      ),
    ];
    const firstRowId = firstConflict.rowIds.find((rowId) => nodeRowIdSet.has(String(rowId ?? ""))) ?? conflictRowIds[0];
    if (!firstRowId) return;

    setActiveConflictCellKey(getDocumentCellKey(documentId, firstRowId, firstConflict.columnKey));
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
    expandHierarchyToConflictRows(documentId, paneId, conflictRowIds);
    scrollTableConflictIntoView(documentId, firstRowId, firstConflict.columnKey, {
      paneId,
      rowIds: firstConflict.rowIds,
    });
  }

  function expandHierarchyToConflictRows(documentId, paneId, rowIds) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const rowIdSet = new Set((rowIds ?? []).map((rowId) => String(rowId ?? "")).filter(Boolean));
    if (rowIdSet.size === 0) return false;

    const tableDocument = getTableDocument(normalizedDocumentId);
    const tableState = getTablePaneStateById(paneId);
    const rows = getTableRowsForDisplay(
      normalizedDocumentId,
      tableDocument,
      tableState.sortConfig ?? null,
      tableState.advancedSortConfig ?? null,
    );
    const hierarchy = buildSpreadsheetHierarchy(tableDocument.programData, rows);
    const openNodeKeys = [];
    for (const child of hierarchy.children ?? []) {
      collectHierarchyOpenKeysForRows(child, rowIdSet, openNodeKeys);
    }

    if (openNodeKeys.length === 0) return false;

    const stateKey = getHierarchyOpenStateKey(paneId, normalizedDocumentId);
    setHierarchyNodeOpenStates((states) => {
      const currentState = states[stateKey] ?? {};
      const nextState = { ...currentState };
      let changed = false;

      for (const nodeKey of openNodeKeys) {
        if (nextState[nodeKey] === true) continue;
        nextState[nodeKey] = true;
        changed = true;
      }

      return changed
        ? {
            ...states,
            [stateKey]: nextState,
          }
        : states;
    });

    return true;
  }

  function collectHierarchyOpenKeysForRows(node, rowIdSet, openNodeKeys) {
    const directMatch = (node.rows ?? []).some((row) => rowIdSet.has(String(row.id ?? "")));
    let childMatch = false;

    for (const child of node.children ?? []) {
      if (collectHierarchyOpenKeysForRows(child, rowIdSet, openNodeKeys)) {
        childMatch = true;
      }
    }

    const hasMatch = directMatch || childMatch;
    if (hasMatch) openNodeKeys.push(node.key);
    return hasMatch;
  }

  function getTableRowsForDisplay(documentId, tableDocument, paneSortConfig = null, paneAdvancedSortConfig = null) {
    if (tableDocument.draftRows.length > 0) {
      return sortRows(tableDocument.draftRows, paneSortConfig, paneAdvancedSortConfig);
    }

    const blankValuesByRowId = blankSpreadsheetCellValues[documentId] ?? {};
    return createBlankSpreadsheetRows().map((row) => ({
      ...row,
      ...(blankValuesByRowId[row.id] ?? {}),
    }));
  }

  function getTableColumnWidth(columnKey) {
    return tableColumnWidths[columnKey] ?? allTableColumns.find((column) => column.key === columnKey)?.width ?? DEFAULT_TABLE_COLUMN_WIDTH;
  }

  function getTableColumnStyle(columnKey) {
    const width = getTableColumnWidth(columnKey);
    return {
      width: `${width}px`,
      minWidth: `${width}px`,
    };
  }

  function getHierarchyTableHeaderStyle(node, columnKey) {
    const style = getTableColumnStyle(columnKey);
    const fillColor = node?.fillColor || node?.rows?.[0]?.hierarchyFillColor;
    return fillColor ? { ...style, "--hierarchy-table-header-fill": fillColor } : style;
  }

  function getTableRowHeight(rowId) {
    return tableRowHeights[rowId] ?? DEFAULT_TABLE_ROW_HEIGHT;
  }

  function getRenderedTableRowHeight(rowId) {
    return getTableRowHeight(rowId) + TABLE_GRID_LINE_WIDTH;
  }

  function getRenderedTableHeaderHeight() {
    return TABLE_HEADER_HEIGHT + TABLE_GRID_LINE_WIDTH;
  }

  function getProgramTableMinWidth() {
    return `${TABLE_ROW_NUMBER_COLUMN_WIDTH + columns.reduce((sum, column) => sum + getTableColumnWidth(column.key), 0)}px`;
  }

  function getPaneTableMinWidth(paneColumns = columns) {
    return `${TABLE_ROW_NUMBER_COLUMN_WIDTH + paneColumns.reduce((sum, column) => sum + getTableColumnWidth(column.key), 0)}px`;
  }

  function getHierarchicalTableMinWidth(tableColumns = HIERARCHICAL_SPREADSHEET_COLUMNS) {
    return `${tableColumns.reduce((sum, column) => sum + getTableColumnWidth(column.key), 0)}px`;
  }

  function startTableColumnResize(event, columnKey) {
    event.preventDefault();
    event.stopPropagation();
    setTableGridResizeState({
      type: "column",
      columnKey,
      startClientX: event.clientX,
      startWidth: getTableColumnWidth(columnKey),
      historySnapshot: createTableHistorySnapshot(),
    });
  }

  function startTableRowResize(event, rowId) {
    event.preventDefault();
    event.stopPropagation();
    setTableGridResizeState({
      type: "row",
      rowId,
      startClientY: event.clientY,
      startHeight: getTableRowHeight(rowId),
      historySnapshot: createTableHistorySnapshot(),
    });
  }

  function startSelectedTableCellEdit(replacementValue) {
    const selectedCells = getActiveTableSelectedCells();
    if (selectedCells.length !== 1) return;

    const cell = parseCellKey(selectedCells[0]);
    if (!cell) return;

    startTableCellEdit(cell.rowId, cell.columnKey, activeTablePaneId ?? null, { replacementValue });
  }

  function startTableCellEdit(rowId, columnKey, paneId, { replacementValue } = {}) {
    const documentId = paneId ? getTablePaneDocumentId(paneId) : DEFAULT_TABLE_DOCUMENT_ID;
    const tableDocument = getTableDocument(documentId);
    if (!isEditableTableCell(columnKey, tableDocument)) return;

    const row = getTableRowsForDisplay(documentId, tableDocument).find((draftRow) => draftRow.id === rowId);
    if (!row) return;

    const originalValue = String(row[columnKey] ?? "");
    setEditingTableCell({
      paneId: paneId ?? null,
      documentId,
      rowId,
      columnKey,
      originalValue,
    });

    if (replacementValue !== undefined) {
      updateRow(rowId, columnKey, replacementValue, documentId);
    }
  }

  function finishTableCellEdit() {
    setEditingTableCell(null);
  }

  function commitTableCellEditAndMove(rowDelta, columnDelta) {
    if (!editingTableCell) return;

    const { paneId, rowId, columnKey } = editingTableCell;
    setEditingTableCell(null);
    blurActiveTableInput();
    moveTableSelectionFromCell(paneId, rowId, columnKey, rowDelta, columnDelta);
  }

  function cancelTableCellEdit() {
    if (!editingTableCell) return;

    updateRow(
      editingTableCell.rowId,
      editingTableCell.columnKey,
      editingTableCell.originalValue,
      editingTableCell.documentId,
      { recordHistory: false },
    );
    setEditingTableCell(null);
    blurActiveTableInput();
  }

  function handleActiveTableShortcut(event, activeSelectedCells) {
    const key = event.key;
    const normalizedKey = key.toLowerCase();
    const isCommandKey = event.ctrlKey || event.metaKey;

    if (isCommandKey && !event.altKey && normalizedKey === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redoTableAction();
      } else {
        undoTableAction();
      }
      return true;
    }

    if (isCommandKey && !event.altKey && normalizedKey === "a") {
      event.preventDefault();
      selectAllActiveTableCells();
      return true;
    }

    if (isCommandKey && !event.altKey && normalizedKey === "c" && activeSelectedCells.length > 0) {
      event.preventDefault();
      copyActiveTableSelectionToClipboard();
      return true;
    }

    if (isCommandKey && !event.altKey && normalizedKey === "x" && activeSelectedCells.length > 0) {
      event.preventDefault();
      copyActiveTableSelectionToClipboard({ cut: true });
      return true;
    }

    if (isCommandKey && !event.altKey && normalizedKey === "v") {
      event.preventDefault();
      pasteClipboardIntoActiveTableSelection();
      return true;
    }

    if ((key === "Delete" || key === "Backspace") && activeSelectedCells.length > 0) {
      event.preventDefault();
      clearActiveTableCellContents();
      return true;
    }

    if (key === "F2" && activeSelectedCells.length === 1) {
      event.preventDefault();
      startSelectedTableCellEdit();
      return true;
    }

    if (key === "Enter") {
      event.preventDefault();
      moveActiveTableSelection(event.shiftKey ? -1 : 1, 0);
      return true;
    }

    if (key === "Tab") {
      event.preventDefault();
      moveActiveTableSelection(0, event.shiftKey ? -1 : 1);
      return true;
    }

    if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      const rowDelta = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
      const columnDelta = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
      moveActiveTableSelection(rowDelta, columnDelta, { extend: event.shiftKey });
      return true;
    }

    if (key === "Home" || key === "End") {
      event.preventDefault();
      moveActiveTableSelectionToEdge(key === "Home" ? "start" : "end", {
        extend: event.shiftKey,
        includeRows: isCommandKey,
      });
      return true;
    }

    return false;
  }

  function handleTableCellInputBlur(rowId, columnKey, paneId) {
    if (isTableCellEditing(paneId, rowId, columnKey)) {
      finishTableCellEdit();
    }
  }

  function handleTableCellDoubleClick(event, rowId, columnKey, paneId) {
    if (isTableCellEditing(paneId, rowId, columnKey)) return;

    const documentId = paneId ? getTablePaneDocumentId(paneId) : DEFAULT_TABLE_DOCUMENT_ID;
    const tableDocument = getTableDocument(documentId);
    if (!isEditableTableCell(columnKey, tableDocument)) return;

    event.preventDefault();
    selectSingleTableCell(rowId, columnKey, paneId);
    startTableCellEdit(rowId, columnKey, paneId);
  }

  function shouldStartSelectedTableCellEdit(event, activeSelectedCells) {
    if (activeSelectedCells.length !== 1) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (openSpreadsheetTitlePaneId || columnMenu || isProjectMenuOpen) return false;
    if (!isPrintableTableEditKey(event)) return false;
    if (isEventFromTextEditingTarget(event)) return false;

    const cell = parseCellKey(activeSelectedCells[0]);
    const context = getTableNavigationContext();
    return Boolean(cell && isEditableTableCell(cell.columnKey, context.tableDocument));
  }

  function isTableCellEditing(paneId, rowId, columnKey) {
    return Boolean(
      editingTableCell &&
        (editingTableCell.paneId ?? null) === (paneId ?? null) &&
        editingTableCell.rowId === rowId &&
        editingTableCell.columnKey === columnKey
    );
  }

  function getTableNavigationContext(paneId = activeTablePaneId ?? null) {
    const tableState = paneId
      ? getTablePaneStateById(paneId)
      : {
          documentId: DEFAULT_TABLE_DOCUMENT_ID,
          sortConfig,
          advancedSortConfig,
          selectedCells: selectedTableCells,
          selectionRanges: selectedTableRanges,
          selectionAnchor: tableSelectionAnchor,
        };
    const documentId = tableState.documentId ?? DEFAULT_TABLE_DOCUMENT_ID;
    const tableDocument = getTableDocument(documentId);
    const rows = getTableRowsForDisplay(
      documentId,
      tableDocument,
      tableState.sortConfig ?? null,
      tableState.advancedSortConfig ?? null,
    );
    const tableColumns = getTableColumnsForDocument(tableDocument, spreadsheetSettings);

    const columnIndexByKey = new Map(tableColumns.map((column, index) => [column.key, index]));
    const rowIndexById = new Map(rows.map((row, index) => [row.id, index]));
    const selectionRanges = getSelectionRangesFromState(tableState);

    return {
      paneId,
      documentId,
      tableDocument,
      columns: tableColumns,
      columnIndexByKey,
      rows,
      rowIndexById,
      selectionRanges,
      selectedCells: getCellKeysInSelectionRanges(selectionRanges, rowIndexById, rows, tableColumns),
      selectionAnchor: tableState.selectionAnchor ?? null,
    };
  }

  function getNavigationCell(context) {
    if (context.selectionAnchor && context.rowIndexById.has(context.selectionAnchor.rowId)) {
      return context.selectionAnchor;
    }

    const selectedCell = parseCellKey(context.selectedCells[0]);
    if (selectedCell && context.rowIndexById.has(selectedCell.rowId)) return selectedCell;

    const firstRow = context.rows[0];
    const firstColumn = context.columns[0];
    return firstRow && firstColumn ? { rowId: firstRow.id, columnKey: firstColumn.key } : null;
  }

  function moveActiveTableSelection(rowDelta, columnDelta, { extend = false } = {}) {
    const context = getTableNavigationContext();
    const currentCell = getNavigationCell(context);
    if (!currentCell) return;

    moveTableSelectionFromCell(context.paneId, currentCell.rowId, currentCell.columnKey, rowDelta, columnDelta, { extend });
  }

  function moveTableSelectionFromCell(paneId, rowId, columnKey, rowDelta, columnDelta, { extend = false } = {}) {
    const context = getTableNavigationContext(paneId);
    const currentRowIndex = context.rowIndexById.get(rowId);
    const currentColumnIndex = context.columnIndexByKey.get(columnKey);
    if (currentRowIndex === undefined || currentColumnIndex === undefined) return;

    selectTableCellAtPosition(context, currentRowIndex + rowDelta, currentColumnIndex + columnDelta, {
      extend,
      anchor: context.selectionAnchor ?? { rowId, columnKey },
    });
  }

  function moveActiveTableSelectionToEdge(edge, { extend = false, includeRows = false } = {}) {
    const context = getTableNavigationContext();
    const currentCell = getNavigationCell(context);
    if (!currentCell) return;

    const currentRowIndex = context.rowIndexById.get(currentCell.rowId);
    const currentColumnIndex = context.columnIndexByKey.get(currentCell.columnKey);
    if (currentRowIndex === undefined || currentColumnIndex === undefined) return;

    selectTableCellAtPosition(
      context,
      includeRows ? (edge === "start" ? 0 : context.rows.length - 1) : currentRowIndex,
      edge === "start" ? 0 : context.columns.length - 1,
      {
        extend,
        anchor: context.selectionAnchor ?? currentCell,
      },
    );
  }

  function selectTableCellAtPosition(context, rowIndex, columnIndex, { extend = false, anchor = null } = {}) {
    const nextRowIndex = clamp(rowIndex, 0, context.rows.length - 1);
    const nextColumnIndex = clamp(columnIndex, 0, context.columns.length - 1);
    const row = context.rows[nextRowIndex];
    const column = context.columns[nextColumnIndex];
    if (!row || !column) return;

    const nextCell = { rowId: row.id, columnKey: column.key };
    const nextAnchor = extend ? anchor ?? nextCell : nextCell;
    updateTablePaneState(context.paneId, (state) => ({
      ...state,
      selectedCells: [],
      selectionRanges: [createSelectionRange(nextAnchor, nextCell)],
      selectionAnchor: nextAnchor,
    }));
    if (context.paneId) setActiveTablePaneId(context.paneId);
    scrollTableCellIntoView(context.paneId, nextCell.rowId, nextCell.columnKey);
  }

  function selectAllActiveTableCells() {
    const context = getTableNavigationContext();
    if (context.rows.length === 0) return;

    updateTablePaneState(context.paneId, (state) => ({
      ...state,
      selectedCells: [],
      selectionRanges: [
        createSelectionRange(
          { rowId: context.rows[0].id, columnKey: context.columns[0].key },
          {
            rowId: context.rows[context.rows.length - 1].id,
            columnKey: context.columns[context.columns.length - 1].key,
          },
        ),
      ],
      selectionAnchor: { rowId: context.rows[0].id, columnKey: context.columns[0].key },
    }));
  }

  function clearActiveTableCellContents() {
    const context = getTableNavigationContext();
    if (context.selectedCells.length === 0) return;

    const updatesByRowId = new Map();
    for (const cellKey of context.selectedCells) {
      const cell = parseCellKey(cellKey);
      if (!cell || !isEditableTableCell(cell.columnKey, context.tableDocument)) continue;

      const rowUpdates = updatesByRowId.get(cell.rowId) ?? {};
      rowUpdates[cell.columnKey] = "";
      updatesByRowId.set(cell.rowId, rowUpdates);
    }

    applyTableCellUpdates(context, updatesByRowId);
  }

  function copyActiveTableSelectionToClipboard({ cut = false } = {}) {
    const text = getActiveTableSelectionText();
    if (!text) return;

    writeTextToClipboard(text)
      .then(() => {
        if (cut) clearActiveTableCellContents();
      })
      .catch((error) => console.warn(error));
  }

  function pasteClipboardIntoActiveTableSelection() {
    readTextFromClipboard()
      .then((text) => pasteTextIntoActiveTableSelection(text))
      .catch((error) => console.warn(error));
  }

  function getActiveTableSelectionText() {
    const context = getTableNavigationContext();
    if (context.selectedCells.length === 0) return "";

    const selectedSet = new Set(context.selectedCells);
    const selectedPositions = context.selectedCells
      .map(parseCellKey)
      .filter(Boolean)
      .map((cell) => ({
        rowIndex: context.rowIndexById.get(cell.rowId),
        columnIndex: context.columnIndexByKey.get(cell.columnKey),
      }))
      .filter((position) => position.rowIndex !== undefined && position.columnIndex !== undefined);

    if (selectedPositions.length === 0) return "";

    const minRowIndex = Math.min(...selectedPositions.map((position) => position.rowIndex));
    const maxRowIndex = Math.max(...selectedPositions.map((position) => position.rowIndex));
    const minColumnIndex = Math.min(...selectedPositions.map((position) => position.columnIndex));
    const maxColumnIndex = Math.max(...selectedPositions.map((position) => position.columnIndex));
    const lines = [];

    for (let rowIndex = minRowIndex; rowIndex <= maxRowIndex; rowIndex += 1) {
      const row = context.rows[rowIndex];
      const values = [];

      for (let columnIndex = minColumnIndex; columnIndex <= maxColumnIndex; columnIndex += 1) {
        const column = context.columns[columnIndex];
        if (!row || !column || !selectedSet.has(getCellKey(row.id, column.key))) {
          values.push("");
        } else if (column.key === "totalNsf" && context.tableDocument.draftRows.length > 0) {
          values.push(String(formatArea(computeTotalNsf(row.quantity, row.nsfPerUnit))));
        } else {
          values.push(String(row[column.key] ?? ""));
        }
      }

      lines.push(values.join("\t"));
    }

    return lines.join("\n");
  }

  function pasteTextIntoActiveTableSelection(text) {
    const values = parseClipboardTableText(text);
    if (values.length === 0) return;

    const context = getTableNavigationContext();
    const startCell = getNavigationCell(context);
    if (!startCell) return;

    if (values.length === 1 && values[0].length === 1 && context.selectedCells.length > 1) {
      fillSelectedTableCells(context, values[0][0]);
      return;
    }

    const startRowIndex = context.rowIndexById.get(startCell.rowId);
    const startColumnIndex = context.columnIndexByKey.get(startCell.columnKey);
    if (startRowIndex === undefined || startColumnIndex === undefined) return;

    const updatesByRowId = new Map();
    let lastRowIndex = startRowIndex;
    let lastColumnIndex = startColumnIndex;

    for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
      const row = context.rows[startRowIndex + rowOffset];
      if (!row) break;

      for (let columnOffset = 0; columnOffset < values[rowOffset].length; columnOffset += 1) {
        const column = context.columns[startColumnIndex + columnOffset];
        if (!column) break;

        lastRowIndex = startRowIndex + rowOffset;
        lastColumnIndex = startColumnIndex + columnOffset;
        if (!isEditableTableCell(column.key, context.tableDocument)) continue;

        const rowUpdates = updatesByRowId.get(row.id) ?? {};
        rowUpdates[column.key] = values[rowOffset][columnOffset];
        updatesByRowId.set(row.id, rowUpdates);
      }
    }

    applyTableCellUpdates(context, updatesByRowId);

    const endRow = context.rows[Math.min(lastRowIndex, context.rows.length - 1)];
    const endColumn = context.columns[Math.min(lastColumnIndex, context.columns.length - 1)];
    if (endRow && endColumn) {
      updateTablePaneState(context.paneId, (state) => ({
        ...state,
        selectedCells: [],
        selectionRanges: [createSelectionRange(startCell, { rowId: endRow.id, columnKey: endColumn.key })],
        selectionAnchor: startCell,
      }));
      scrollTableCellIntoView(context.paneId, endRow.id, endColumn.key);
    }
  }

  function fillSelectedTableCells(context, value) {
    const updatesByRowId = new Map();

    for (const cellKey of context.selectedCells) {
      const cell = parseCellKey(cellKey);
      if (!cell || !isEditableTableCell(cell.columnKey, context.tableDocument)) continue;

      const rowUpdates = updatesByRowId.get(cell.rowId) ?? {};
      rowUpdates[cell.columnKey] = value;
      updatesByRowId.set(cell.rowId, rowUpdates);
    }

    applyTableCellUpdates(context, updatesByRowId);
  }

  function applyTableCellUpdates(context, updatesByRowId) {
    if (updatesByRowId.size === 0) return;

    if (context.tableDocument.draftRows.length === 0) {
      const documentValues = blankSpreadsheetCellValues[context.documentId] ?? {};
      const hasChanges = [...updatesByRowId.entries()].some(([rowId, rowUpdates]) =>
        Object.entries(rowUpdates).some(([columnKey, value]) =>
          String(documentValues[rowId]?.[columnKey] ?? "") !== String(value ?? ""),
        ),
      );
      if (!hasChanges) return;

      pushTableHistorySnapshot();
      setBlankSpreadsheetCellValues((values) => {
        const documentValues = values[context.documentId] ?? {};
        const nextDocumentValues = { ...documentValues };

        for (const [rowId, rowUpdates] of updatesByRowId.entries()) {
          nextDocumentValues[rowId] = {
            ...(nextDocumentValues[rowId] ?? {}),
            ...rowUpdates,
          };
        }

        return {
          ...values,
          [context.documentId]: nextDocumentValues,
        };
      });
      return;
    }

    const rowsById = new Map(context.tableDocument.draftRows.map((row) => [row.id, row]));
    const hasChanges = [...updatesByRowId.entries()].some(([rowId, rowUpdates]) => {
      const row = rowsById.get(rowId);
      return Object.entries(rowUpdates).some(([columnKey, value]) => String(row?.[columnKey] ?? "") !== String(value ?? ""));
    });
    if (!hasChanges) return;

    pushTableHistorySnapshot();
    updateTableDocument(context.documentId, (tableDocument) => ({
      ...tableDocument,
      draftRows: tableDocument.draftRows.map((row) => (
        updatesByRowId.has(row.id) ? { ...row, ...updatesByRowId.get(row.id) } : row
      )),
    }));
  }

  function clearTableSelection() {
    setSelectedTableCells([]);
    setSelectedTableRanges([]);
    setTableSelectionAnchor(null);
    setWorkspaceSlots((slots) =>
      slots.map((slot) => (
        typeof slot === "string" || getWorkspacePaneType(slot) !== "table"
          ? slot
          : {
              ...slot,
              tableState: {
                ...(slot.tableState ?? createDefaultTablePaneState()),
                selectedCells: [],
                selectionRanges: [],
                selectionAnchor: null,
              },
            }
      )),
    );
  }

  function clearActiveTableSelection() {
    if (!activeTablePaneId) {
      clearTableSelection();
      return;
    }

    updateTablePaneState(activeTablePaneId, (state) => ({
      ...state,
      selectedCells: [],
      selectionRanges: [],
      selectionAnchor: null,
    }));
  }

  function selectSingleTableCell(rowId, columnKey, paneId) {
    const cell = { rowId, columnKey };
    if (paneId) setActiveTablePaneId(paneId);
    updateTablePaneState(paneId, (state) => ({
      ...state,
      selectedCells: [],
      selectionRanges: [createSelectionRange(cell)],
      selectionAnchor: cell,
    }));
  }

  function handleTableCellMouseDown(
    event,
    rowId,
    columnKey,
    paneId,
    paneSelectionRanges = selectedTableRanges,
    paneSelectionAnchor = tableSelectionAnchor,
    paneVisibleRowIndexById = visibleRowIndexById,
    paneSortedRows = sortedRows,
    paneColumns = columns,
  ) {
    if (event.button !== 0) return;
    if (isTableCellEditing(paneId, rowId, columnKey)) return;

    event.preventDefault();
    blurActiveElement();
    if (editingTableCell) finishTableCellEdit();
    if (paneId) setActiveTablePaneId(paneId);
    handleStackingConflictCellInteraction(paneId ? getTablePaneDocumentId(paneId) : DEFAULT_TABLE_DOCUMENT_ID, rowId, columnKey);

    const cell = { rowId, columnKey };
    const cellKey = getCellKey(rowId, columnKey);

    if (event.shiftKey) {
      blurActiveTableInput();
      const anchor = paneSelectionAnchor ?? cell;
      updateTablePaneState(paneId, (state) => ({
        ...state,
        selectedCells: [],
        selectionRanges: [createSelectionRange(anchor, cell)],
        selectionAnchor: paneSelectionAnchor ?? cell,
      }));
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      blurActiveTableInput();
      const paneSelectedCells = getCellKeysInSelectionRanges(paneSelectionRanges, paneVisibleRowIndexById, paneSortedRows, paneColumns);
      updateTablePaneState(paneId, (state) => ({
        ...state,
        selectedCells: [],
        selectionRanges: getSelectionRangesFromCellKeys(
          paneSelectedCells.includes(cellKey)
            ? paneSelectedCells.filter((key) => key !== cellKey)
            : [...paneSelectedCells, cellKey],
        ),
        selectionAnchor: cell,
      }));
      return;
    }

    selectSingleTableCell(rowId, columnKey, paneId);
    setTableSelectionDragState({
      paneId: paneId ?? null,
      anchor: cell,
    });
  }

  function handleTableCellMouseEnter(rowId, columnKey, paneId, paneVisibleRowIndexById, paneSortedRows, paneColumns) {
    if (!tableSelectionDragState) return;
    if ((paneId ?? null) !== (tableSelectionDragState.paneId ?? null)) return;

    const nextCell = { rowId, columnKey };
    updateTablePaneState(paneId, (state) => ({
      ...state,
      selectedCells: [],
      selectionRanges: [createSelectionRange(tableSelectionDragState.anchor, nextCell)],
      selectionAnchor: tableSelectionDragState.anchor,
    }));
  }

  function handleTableRowHeaderMouseDown(
    event,
    rowId,
    paneId,
    paneSelectionRanges = selectedTableRanges,
    paneSelectionAnchor = tableSelectionAnchor,
    paneVisibleRowIndexById = visibleRowIndexById,
    paneSortedRows = sortedRows,
    paneColumns = columns,
  ) {
    if (event.button !== 0) return;

    event.preventDefault();
    blurActiveElement();
    if (editingTableCell) finishTableCellEdit();
    if (paneId) setActiveTablePaneId(paneId);

    const rowKeys = paneColumns.map((column) => getCellKey(rowId, column.key));
    const paneSelectedCells = getCellKeysInSelectionRanges(paneSelectionRanges, paneVisibleRowIndexById, paneSortedRows, paneColumns);
    const selectedSet = new Set(paneSelectedCells);

    if (event.shiftKey) {
      const anchor = paneSelectionAnchor ?? { rowId, columnKey: paneColumns[0].key };
      const anchorRowIndex = paneVisibleRowIndexById.get(anchor.rowId);
      const rowIndex = paneVisibleRowIndexById.get(rowId);

      if (anchorRowIndex !== undefined && rowIndex !== undefined) {
        const firstRowIndex = Math.min(anchorRowIndex, rowIndex);
        const lastRowIndex = Math.max(anchorRowIndex, rowIndex);
        const firstSelectedRow = paneSortedRows[firstRowIndex];
        const lastSelectedRow = paneSortedRows[lastRowIndex];

        updateTablePaneState(paneId, (state) => ({
          ...state,
          selectedCells: [],
          selectionRanges:
            firstSelectedRow && lastSelectedRow
              ? [
                  createSelectionRange(
                    { rowId: firstSelectedRow.id, columnKey: paneColumns[0]?.key },
                    { rowId: lastSelectedRow.id, columnKey: paneColumns[paneColumns.length - 1]?.key },
                  ),
                ]
              : [],
          selectionAnchor: { rowId: anchor.rowId, columnKey: paneColumns[0].key },
        }));
      }
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const shouldRemove = rowKeys.every((cellKey) => selectedSet.has(cellKey));
      updateTablePaneState(paneId, (state) => ({
        ...state,
        selectedCells: [],
        selectionRanges: getSelectionRangesFromCellKeys(
          shouldRemove
            ? paneSelectedCells.filter((cellKey) => !rowKeys.includes(cellKey))
            : [...new Set([...paneSelectedCells, ...rowKeys])],
        ),
        selectionAnchor: { rowId, columnKey: paneColumns[0].key },
      }));
      return;
    }

    updateTablePaneState(paneId, (state) => ({
      ...state,
      selectedCells: [],
      selectionRanges: [
        createSelectionRange(
          { rowId, columnKey: paneColumns[0]?.key },
          { rowId, columnKey: paneColumns[paneColumns.length - 1]?.key },
        ),
      ],
      selectionAnchor: { rowId, columnKey: paneColumns[0].key },
    }));
  }

  function handleTableColumnHeaderMouseDown(
    event,
    columnKey,
    paneId,
    rows,
    paneSelectionRanges = selectedTableRanges,
    paneSelectionAnchor = tableSelectionAnchor,
    paneColumns = columns,
  ) {
    if (event.type === "mousedown" && event.button !== 0) return;

    event.preventDefault();
    blurActiveElement();
    if (editingTableCell) finishTableCellEdit();
    if (paneId) setActiveTablePaneId(paneId);

    const firstRow = rows[0];
    const rowIndexById = new Map(rows.map((row, index) => [row.id, index]));
    const columnKeys = rows.map((row) => getCellKey(row.id, columnKey));
    const paneSelectedCells = getCellKeysInSelectionRanges(paneSelectionRanges, rowIndexById, rows, paneColumns);
    const selectedSet = new Set(paneSelectedCells);

    if (event.shiftKey) {
      const anchorColumnKey = paneSelectionAnchor?.columnKey ?? columnKey;
      const paneColumnIndexByKey = new Map(paneColumns.map((column, index) => [column.key, index]));
      const anchorColumnIndex = paneColumnIndexByKey.get(anchorColumnKey);
      const columnIndex = paneColumnIndexByKey.get(columnKey);

      if (anchorColumnIndex !== undefined && columnIndex !== undefined) {
        const firstColumnIndex = Math.min(anchorColumnIndex, columnIndex);
        const lastColumnIndex = Math.max(anchorColumnIndex, columnIndex);

        updateTablePaneState(paneId, (state) => ({
          ...state,
          selectedCells: [],
          selectionRanges: firstRow
            ? [
                createSelectionRange(
                  { rowId: firstRow.id, columnKey: paneColumns[firstColumnIndex]?.key },
                  { rowId: rows[rows.length - 1]?.id, columnKey: paneColumns[lastColumnIndex]?.key },
                ),
              ]
            : [],
          selectionAnchor: firstRow ? { rowId: firstRow.id, columnKey: anchorColumnKey } : null,
        }));
      }
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const shouldRemove = columnKeys.every((cellKey) => selectedSet.has(cellKey));
      updateTablePaneState(paneId, (state) => ({
        ...state,
        selectedCells: [],
        selectionRanges: getSelectionRangesFromCellKeys(
          shouldRemove
            ? paneSelectedCells.filter((cellKey) => !columnKeys.includes(cellKey))
            : [...new Set([...paneSelectedCells, ...columnKeys])],
        ),
        selectionAnchor: firstRow ? { rowId: firstRow.id, columnKey } : null,
      }));
      return;
    }

    updateTablePaneState(paneId, (state) => ({
      ...state,
      selectedCells: [],
      selectionRanges: firstRow
        ? [
            createSelectionRange(
              { rowId: firstRow.id, columnKey },
              { rowId: rows[rows.length - 1]?.id, columnKey },
            ),
          ]
        : [],
      selectionAnchor: firstRow ? { rowId: firstRow.id, columnKey } : null,
    }));
  }

  function getCellKeysInRange(startCell, endCell, rowIndexById = visibleRowIndexById, rows = sortedRows, tableColumns = columns) {
    const startRowIndex = rowIndexById.get(startCell.rowId);
    const endRowIndex = rowIndexById.get(endCell.rowId);
    const tableColumnIndexByKey = new Map(tableColumns.map((column, index) => [column.key, index]));
    const startColumnIndex = tableColumnIndexByKey.get(startCell.columnKey);
    const endColumnIndex = tableColumnIndexByKey.get(endCell.columnKey);

    if (
      startRowIndex === undefined ||
      endRowIndex === undefined ||
      startColumnIndex === undefined ||
      endColumnIndex === undefined
    ) {
      return [getCellKey(endCell.rowId, endCell.columnKey)];
    }

    const firstRowIndex = Math.min(startRowIndex, endRowIndex);
    const lastRowIndex = Math.max(startRowIndex, endRowIndex);
    const firstColumnIndex = Math.min(startColumnIndex, endColumnIndex);
    const lastColumnIndex = Math.max(startColumnIndex, endColumnIndex);
    const keys = [];

    for (let rowIndex = firstRowIndex; rowIndex <= lastRowIndex; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row) continue;

      for (let columnIndex = firstColumnIndex; columnIndex <= lastColumnIndex; columnIndex += 1) {
        const column = tableColumns[columnIndex];
        if (column) keys.push(getCellKey(row.id, column.key));
      }
    }

    return keys;
  }

  function createSelectionRange(startCell, endCell = startCell) {
    if (!startCell?.rowId || !startCell?.columnKey || !endCell?.rowId || !endCell?.columnKey) return null;

    return {
      start: { rowId: startCell.rowId, columnKey: startCell.columnKey },
      end: { rowId: endCell.rowId, columnKey: endCell.columnKey },
    };
  }

  function getSelectionRangesFromState(state) {
    const storedRanges = Array.isArray(state?.selectionRanges)
      ? state.selectionRanges.map((range) => createSelectionRange(range?.start, range?.end)).filter(Boolean)
      : [];
    if (storedRanges.length > 0) return storedRanges;

    return getSelectionRangesFromCellKeys(state?.selectedCells ?? []);
  }

  function getSelectionRangesFromCellKeys(cellKeys) {
    return [...new Set(cellKeys)]
      .map(parseCellKey)
      .filter(Boolean)
      .map((cell) => createSelectionRange(cell))
      .filter(Boolean);
  }

  function getNormalizedSelectionRanges(selectionRanges, rowIndexById, columnIndexByKey) {
    return selectionRanges
      .map((range) => {
        const startRowIndex = rowIndexById.get(range.start.rowId);
        const endRowIndex = rowIndexById.get(range.end.rowId);
        const startColumnIndex = columnIndexByKey.get(range.start.columnKey);
        const endColumnIndex = columnIndexByKey.get(range.end.columnKey);
        if (
          startRowIndex === undefined ||
          endRowIndex === undefined ||
          startColumnIndex === undefined ||
          endColumnIndex === undefined
        ) {
          return null;
        }

        return {
          firstRowIndex: Math.min(startRowIndex, endRowIndex),
          lastRowIndex: Math.max(startRowIndex, endRowIndex),
          firstColumnIndex: Math.min(startColumnIndex, endColumnIndex),
          lastColumnIndex: Math.max(startColumnIndex, endColumnIndex),
        };
      })
      .filter(Boolean);
  }

  function getCellKeysInSelectionRanges(selectionRanges, rowIndexById, rows, tableColumns) {
    const columnIndexByKey = new Map(tableColumns.map((column, index) => [column.key, index]));
    const normalizedRanges = getNormalizedSelectionRanges(selectionRanges, rowIndexById, columnIndexByKey);
    const selectedKeys = new Set();

    for (const range of normalizedRanges) {
      for (let rowIndex = range.firstRowIndex; rowIndex <= range.lastRowIndex; rowIndex += 1) {
        const row = rows[rowIndex];
        if (!row) continue;

        for (let columnIndex = range.firstColumnIndex; columnIndex <= range.lastColumnIndex; columnIndex += 1) {
          const column = tableColumns[columnIndex];
          if (column) selectedKeys.add(getCellKey(row.id, column.key));
        }
      }
    }

    return [...selectedKeys];
  }

  function isCellPositionSelected(rowIndex, columnIndex, normalizedSelectionRanges) {
    return normalizedSelectionRanges.some(
      (range) =>
        rowIndex >= range.firstRowIndex &&
        rowIndex <= range.lastRowIndex &&
        columnIndex >= range.firstColumnIndex &&
        columnIndex <= range.lastColumnIndex,
    );
  }

  function getSelectionCellCount(normalizedSelectionRanges) {
    return normalizedSelectionRanges.reduce(
      (sum, range) =>
        sum + (range.lastRowIndex - range.firstRowIndex + 1) * (range.lastColumnIndex - range.firstColumnIndex + 1),
      0,
    );
  }

  function getSelectedRowIdsFromRanges(normalizedSelectionRanges, rows) {
    const rowIds = new Set();
    for (const range of normalizedSelectionRanges) {
      for (let rowIndex = range.firstRowIndex; rowIndex <= range.lastRowIndex; rowIndex += 1) {
        const row = rows[rowIndex];
        if (row) rowIds.add(row.id);
      }
    }
    return rowIds;
  }

  function getSelectedColumnKeysFromRanges(normalizedSelectionRanges, tableColumns) {
    const columnKeys = new Set();
    for (const range of normalizedSelectionRanges) {
      for (let columnIndex = range.firstColumnIndex; columnIndex <= range.lastColumnIndex; columnIndex += 1) {
        const column = tableColumns[columnIndex];
        if (column) columnKeys.add(column.key);
      }
    }
    return columnKeys;
  }

  function getStackingConflictCellPositionSet(documentId, rows, tableColumns) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const rowIndexById = new Map(rows.map((row, index) => [row.id, index]));
    const columnIndexByKey = new Map(tableColumns.map((column, index) => [column.key, index]));
    const positions = new Set();

    for (const conflict of stackingConflicts) {
      if (
        conflict.documentId !== normalizedDocumentId ||
        (conflict.status !== "pending" && conflict.status !== "ignored")
      ) continue;
      const columnIndex = columnIndexByKey.get(conflict.columnKey);
      if (columnIndex === undefined) continue;

      for (const rowId of conflict.rowIds) {
        const rowIndex = rowIndexById.get(rowId);
        if (rowIndex !== undefined) positions.add(getTableCellPositionKey(rowIndex, columnIndex));
      }
    }

    return positions;
  }

  function getTableCellPositionKey(rowIndex, columnIndex) {
    return `${rowIndex}:${columnIndex}`;
  }

  function isTableCellPositionInSet(rowIndex, columnIndex, positionSet) {
    return positionSet.has(getTableCellPositionKey(rowIndex, columnIndex));
  }

  function getStackingConflictEdgeClassName(rowIndex, columnIndex, positionSet) {
    if (!isTableCellPositionInSet(rowIndex, columnIndex, positionSet)) return "";

    const classes = [];
    if (!isTableCellPositionInSet(rowIndex - 1, columnIndex, positionSet)) classes.push("conflict-edge-top");
    if (!isTableCellPositionInSet(rowIndex, columnIndex + 1, positionSet)) classes.push("conflict-edge-right");
    if (!isTableCellPositionInSet(rowIndex + 1, columnIndex, positionSet)) classes.push("conflict-edge-bottom");
    if (!isTableCellPositionInSet(rowIndex, columnIndex - 1, positionSet)) classes.push("conflict-edge-left");
    return classes.join(" ");
  }

  function getFirstSelectionCell(selectionRanges) {
    return selectionRanges[0]?.start ?? null;
  }

  function getTableCellClassName(
    rowId,
    columnKey,
    rowIndex,
    columnIndex,
    normalizedSelectionRanges,
    selectionCellCount,
    paneCellStyles = cellStyles,
  ) {
    const cellKey = getCellKey(rowId, columnKey);
    const classes = [];
    const style = paneCellStyles[cellKey];

    if (isCellPositionSelected(rowIndex, columnIndex, normalizedSelectionRanges)) {
      classes.push("is-cell-selected");
      if (selectionCellCount > 1) classes.push("is-cell-multi-selected");

      if (!isCellPositionSelected(rowIndex - 1, columnIndex, normalizedSelectionRanges)) classes.push("cell-edge-top");
      if (!isCellPositionSelected(rowIndex, columnIndex + 1, normalizedSelectionRanges)) classes.push("cell-edge-right");
      if (!isCellPositionSelected(rowIndex + 1, columnIndex, normalizedSelectionRanges)) classes.push("cell-edge-bottom");
      if (!isCellPositionSelected(rowIndex, columnIndex - 1, normalizedSelectionRanges)) classes.push("cell-edge-left");
    }

    if (style?.bold) classes.push("is-cell-bold");
    if (style?.italic) classes.push("is-cell-italic");
    if (style?.underline) classes.push("is-cell-underline");

    return classes.join(" ");
  }

  function getVirtualTableRows(rows, viewportMetrics) {
    if (rows.length === 0) {
      return {
        rows: [],
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const bodyScrollTop = Math.max(0, (viewportMetrics?.scrollTop ?? 0) - getRenderedTableHeaderHeight());
    const viewportHeight = viewportMetrics?.clientHeight ?? 720;
    const rowHeights = rows.map((row) => getRenderedTableRowHeight(row.id));
    const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0);
    const visibleTop = Math.max(0, bodyScrollTop - TABLE_VIRTUAL_OVERSCAN_ROWS * getRenderedTableRowHeight(undefined));
    const visibleBottom = Math.min(
      totalHeight,
      bodyScrollTop + viewportHeight + TABLE_VIRTUAL_OVERSCAN_ROWS * getRenderedTableRowHeight(undefined),
    );

    let accumulatedHeight = 0;
    let startIndex = 0;
    while (startIndex < rowHeights.length && accumulatedHeight + rowHeights[startIndex] < visibleTop) {
      accumulatedHeight += rowHeights[startIndex];
      startIndex += 1;
    }

    let endIndex = startIndex;
    let visibleHeight = accumulatedHeight;
    while (endIndex < rowHeights.length && visibleHeight <= visibleBottom) {
      visibleHeight += rowHeights[endIndex];
      endIndex += 1;
    }

    return {
      rows: rows.slice(startIndex, endIndex).map((row, offset) => ({ row, rowIndex: startIndex + offset })),
      topSpacerHeight: accumulatedHeight,
      bottomSpacerHeight: Math.max(0, totalHeight - visibleHeight),
    };
  }

  function applyTableCellFormat(formatKey) {
    const cellsToFormat = getActiveTableSelectedCells();
    if (cellsToFormat.length === 0) return;
    const documentId = getActiveTableDocumentId();
    const currentCellStyles = getTableDocument(documentId).cellStyles;

    const shouldEnable = cellsToFormat.some((cellKey) => !currentCellStyles[cellKey]?.[formatKey]);
    const nextStyles = { ...currentCellStyles };

    for (const cellKey of cellsToFormat) {
      const nextStyle = { ...(nextStyles[cellKey] ?? {}) };
      if (shouldEnable) {
        nextStyle[formatKey] = true;
      } else {
        delete nextStyle[formatKey];
      }

      if (hasCellStyle(nextStyle)) {
        nextStyles[cellKey] = nextStyle;
      } else {
        delete nextStyles[cellKey];
      }
    }

    if (serializeCellStyles(nextStyles) === serializeCellStyles(currentCellStyles)) return;
    pushTableHistorySnapshot();
    updateTableDocument(documentId, (tableDocument) => ({
      ...tableDocument,
      cellStyles: nextStyles,
    }));
  }

  function handleSort(columnKey, paneId) {
    if (paneId) setActiveTablePaneId(paneId);
    if (!paneId) {
      setAdvancedSortConfig(null);
      setSortConfig((current) => {
        if (current?.key !== columnKey) {
          return { key: columnKey, direction: "asc" };
        }

        return {
          key: columnKey,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      });
      return;
    }

    updateTablePaneState(paneId, (state) => {
      const current = state.sortConfig;
      if (current?.key !== columnKey) {
        return {
          ...state,
          advancedSortConfig: null,
          sortConfig: { key: columnKey, direction: "asc" },
        };
      }

      return {
        ...state,
        advancedSortConfig: null,
        sortConfig: {
          key: columnKey,
          direction: current.direction === "asc" ? "desc" : "asc",
        },
      };
    });
  }

  function openColumnMenu(event, columnKey, paneId) {
    event.preventDefault();
    if (paneId) setActiveTablePaneId(paneId);
    setColumnMenu({
      columnKey,
      paneId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 180)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 44)),
    });
  }

  function openAdvancedSortDialog() {
    const paneId = columnMenu?.paneId;
    const tableState = paneId ? getTablePaneStateById(paneId) : { advancedSortConfig };
    const rules = tableState.advancedSortConfig?.rules ?? createDefaultAdvancedSortRules();
    setAdvancedSortPaneId(paneId ?? null);
    setAdvancedDraftRules(rules.map((rule) => ({ ...rule })));
    setSelectedRuleKeys([]);
    setLastSelectedRuleKey(null);
    setDraggingRuleKey(null);
    setIsAdvancedCancelConfirmOpen(false);
    setColumnMenu(null);
    setIsAdvancedSortOpen(true);
  }

  function closeAdvancedSortDialog() {
    setIsAdvancedSortOpen(false);
    setIsAdvancedCancelConfirmOpen(false);
    setAdvancedSortPaneId(null);
    setSelectedRuleKeys([]);
    setLastSelectedRuleKey(null);
    setDraggingRuleKey(null);
  }

  function requestAdvancedSortClose() {
    if (hasAdvancedSortEdits) {
      setIsAdvancedCancelConfirmOpen(true);
      return;
    }

    closeAdvancedSortDialog();
  }

  function saveAdvancedSort() {
    const nextAdvancedSortConfig = { rules: advancedDraftRules.map((rule) => ({ ...rule })) };
    if (advancedSortPaneId) {
      updateTablePaneState(advancedSortPaneId, (state) => ({
        ...state,
        advancedSortConfig: nextAdvancedSortConfig,
        sortConfig: null,
      }));
    } else {
      setAdvancedSortConfig(nextAdvancedSortConfig);
      setSortConfig(null);
    }
    closeAdvancedSortDialog();
  }

  function selectAdvancedRule(event, ruleKey) {
    const currentIndex = advancedDraftRules.findIndex((rule) => rule.key === ruleKey);
    if (currentIndex === -1) return;

    if (event.shiftKey && lastSelectedRuleKey) {
      const lastIndex = advancedDraftRules.findIndex((rule) => rule.key === lastSelectedRuleKey);
      if (lastIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        setSelectedRuleKeys(advancedDraftRules.slice(start, end + 1).map((rule) => rule.key));
        return;
      }
    }

    if (event.ctrlKey || event.metaKey) {
      setSelectedRuleKeys((keys) => {
        if (keys.includes(ruleKey)) {
          return keys.filter((key) => key !== ruleKey);
        }
        return [...keys, ruleKey];
      });
      setLastSelectedRuleKey(ruleKey);
      return;
    }

    setSelectedRuleKeys([ruleKey]);
    setLastSelectedRuleKey(ruleKey);
  }

  function applyAdvancedRuleEnabled(enabled) {
    if (selectedRuleKeys.length === 0) return;
    const selectedKeys = new Set(selectedRuleKeys);
    setAdvancedDraftRules((rules) =>
      rules.map((rule) => (selectedKeys.has(rule.key) ? { ...rule, enabled } : rule)),
    );
  }

  function handleRuleDragStart(event, ruleKey) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ruleKey);
    setDraggingRuleKey(ruleKey);
  }

  function handleRuleDragOver(event, targetRuleKey) {
    event.preventDefault();
    if (!draggingRuleKey || draggingRuleKey === targetRuleKey) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setAdvancedDraftRules((rules) => reorderRules(rules, draggingRuleKey, targetRuleKey, placement));
  }

  function handleRuleDrop(event) {
    event.preventDefault();
    setDraggingRuleKey(null);
  }

  function requestTableClose(paneId) {
    const documentId = paneId ? getTablePaneDocumentId(paneId) : DEFAULT_TABLE_DOCUMENT_ID;
    if (hasTableDocumentUnsavedEdits(documentId)) {
      setPendingTableClosePaneId(paneId ?? null);
      setIsExitConfirmOpen(true);
      return;
    }

    closeTable(paneId);
  }

  function closeTable(paneId = pendingTableClosePaneId) {
    const nextSlots = paneId
      ? workspaceSlots.filter((slot, index) => getWorkspacePaneId(slot, index) !== paneId)
      : workspaceSlots.filter((slot) => getWorkspacePaneType(slot) !== "table");
    const nextWidths = paneId ? getPaneWidthsWithoutPane(paneId) : createEqualPaneWidths(nextSlots.length);
    if (!paneId && programData) {
      setTableDocumentFromData(DEFAULT_TABLE_DOCUMENT_ID, programData);
    }
    setErrorMessage("");
    setStatusMessage("");
    setIsExitConfirmOpen(false);
    setPendingTableClosePaneId(null);
    setSideToolMenu(null);
    if (paneId) {
      clearActiveWorkspacePane(paneId);
    } else {
      setActiveWorkspacePane((currentPane) => (currentPane?.type === "table" ? null : currentPane));
    }
    if (!paneId || spreadsheetSettingsPaneId === paneId) setSpreadsheetSettingsPaneId(null);
    if (paneId) {
      if (openSpreadsheetTitlePaneId === paneId) setOpenSpreadsheetTitlePaneId(null);
      if (activeTablePaneId === paneId) setActiveTablePaneId(null);
      if (advancedSortPaneId === paneId) closeAdvancedSortDialog();
    } else {
      clearTableSelection();
    }
    setWorkspaceSlots(nextSlots);
    setWorkspacePaneWidths(nextWidths);
    syncWorkspaceToolFlags(nextSlots);
  }

  async function handleSave(paneId) {
    const documentId = paneId ? getTablePaneDocumentId(paneId) : DEFAULT_TABLE_DOCUMENT_ID;
    const tableDocument = getTableDocument(documentId);
    if (!tableDocument?.programData) return;

    setIsSaving(true);
    setSavingTablePaneId(paneId ?? null);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const nextData = mergeRowsIntoProgramData(
        tableDocument.programData,
        tableDocument.draftRows,
        tableDocument.cellStyles,
        tableDocument.draftProjectName,
        {
          distributeIdenticalRooms: spreadsheetSettings.distributeIdenticalRooms,
        },
      );
      const savedData = await putProgramData(nextData);
      setTableDocumentFromData(documentId, savedData, { rebuildStackingConflicts: true });
      setStatusMessage("Saved.");
      setIsExitConfirmOpen(false);
      await refreshAvailableProgramDataFiles();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSaving(false);
      setSavingTablePaneId(null);
    }
  }

  function openSpreadsheetSettings(paneId) {
    setOpenSpreadsheetTitlePaneId(null);
    setDraftSpreadsheetSettings(spreadsheetSettings);
    setSpreadsheetSettingsPaneId(paneId);
  }

  function closeSpreadsheetSettings() {
    setDraftSpreadsheetSettings(spreadsheetSettings);
    setSpreadsheetSettingsPaneId(null);
  }

  function transformOpenTableDocumentsForIdenticalRooms(transformDocument, statusMessage) {
    const documentIds = new Set(Object.keys(tableDocuments));
    if (programData) documentIds.add(DEFAULT_TABLE_DOCUMENT_ID);

    const tableSlots = workspaceSlots.length > 0 ? workspaceSlots : (isTableOpen ? ["table"] : []);
    for (const [index, slot] of tableSlots.entries()) {
      if (getWorkspacePaneType(slot) !== "table") continue;
      const slotDocumentId = typeof slot === "string"
        ? DEFAULT_TABLE_DOCUMENT_ID
        : slot.tableState?.documentId ?? getTablePaneDocumentId(getWorkspacePaneId(slot, index));
      documentIds.add(slotDocumentId || DEFAULT_TABLE_DOCUMENT_ID);
    }

    const nextDocuments = { ...tableDocuments };
    const changedDocumentIds = new Set();
    let nextDefaultDocument = null;

    for (const documentId of documentIds) {
      const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
      const currentDocument = nextDocuments[normalizedDocumentId] ?? getTableDocument(normalizedDocumentId);
      const transformedDocument = transformDocument(currentDocument);
      if (transformedDocument === currentDocument) continue;

      nextDocuments[normalizedDocumentId] = transformedDocument;
      changedDocumentIds.add(normalizedDocumentId);
      if (normalizedDocumentId === DEFAULT_TABLE_DOCUMENT_ID) {
        nextDefaultDocument = transformedDocument;
      }
    }

    if (changedDocumentIds.size === 0) return false;

    setTableDocuments(nextDocuments);
    if (nextDefaultDocument) {
      setDraftProjectName(nextDefaultDocument.draftProjectName);
      setDraftRows(nextDefaultDocument.draftRows);
      setCellStyles(nextDefaultDocument.cellStyles);
    }
    setStackingConflicts((conflicts) =>
      conflicts.filter((conflict) => !changedDocumentIds.has(conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID)),
    );
    setActiveConflictCellKey(null);
    setConflictMenu(null);
    setFooterConflictMenuPaneId(null);
    setStatusMessage(statusMessage);
    return true;
  }

  function saveSpreadsheetSettings() {
    captureCurrentTableViewportMetrics();

    const nextSpreadsheetSettings = normalizeSpreadsheetSettings(draftSpreadsheetSettings);
    const isChangingSpreadsheetView = nextSpreadsheetSettings.view !== spreadsheetSettings.view;
    const shouldDistributeIdenticalRooms =
      !spreadsheetSettings.distributeIdenticalRooms && nextSpreadsheetSettings.distributeIdenticalRooms;
    const shouldConsolidateIdenticalRooms =
      spreadsheetSettings.distributeIdenticalRooms && !nextSpreadsheetSettings.distributeIdenticalRooms;
    const isChangingIdenticalRoomDistribution =
      nextSpreadsheetSettings.distributeIdenticalRooms !== spreadsheetSettings.distributeIdenticalRooms;

    if (isChangingSpreadsheetView || isChangingIdenticalRoomDistribution) {
      finishTableCellEdit();
    }
    if (isChangingIdenticalRoomDistribution) {
      clearActiveTableSelection();
    }
    if (shouldDistributeIdenticalRooms) {
      transformOpenTableDocumentsForIdenticalRooms(
        distributeTableDocumentForIdenticalRooms,
        "Identical rooms distributed. Save to persist.",
      );
    } else if (shouldConsolidateIdenticalRooms) {
      transformOpenTableDocumentsForIdenticalRooms(
        consolidateTableDocumentForIdenticalRooms,
        "Identical rooms consolidated. Save to persist.",
      );
    }
    setSpreadsheetSettings(nextSpreadsheetSettings);
    setSpreadsheetSettingsPaneId(null);
  }

  function toggleSpreadsheetView() {
    const nextView = spreadsheetSettings.view === TABLE_VIEW_HIERARCHICAL
      ? TABLE_VIEW_SPREADSHEET
      : TABLE_VIEW_HIERARCHICAL;
    const nextSpreadsheetSettings = normalizeSpreadsheetSettings({
      ...spreadsheetSettings,
      view: nextView,
    });

    captureCurrentTableViewportMetrics();
    finishTableCellEdit();
    setSpreadsheetSettings(nextSpreadsheetSettings);
    setDraftSpreadsheetSettings((settings) => normalizeSpreadsheetSettings({
      ...settings,
      view: nextView,
    }));
  }

  const activeWorkspaceSlots = workspaceSlots.length > 0
    ? workspaceSlots
    : [
        ...(isTableOpen ? ["table"] : []),
        ...(isDiagramsOpen ? ["diagrams"] : []),
      ];
  const isWorkspaceActive = activeWorkspaceSlots.length > 0;
  const activeWorkspacePaneWidths = getPaneWidthsForCount(activeWorkspaceSlots.length);
  const workspaceGridColumns = activeWorkspacePaneWidths.length > 0
    ? activeWorkspacePaneWidths.map((width) => `${Math.max(0.01, width)}fr`).join(" 7px ")
    : "minmax(0, 1fr)";

  function startPaneResize(event, leftIndex) {
    event.preventDefault();
    const bounds = workspaceDisplayRef.current?.getBoundingClientRect();
    if (!bounds) return;

    setPaneResizeState({
      leftIndex,
      startX: event.clientX,
      containerWidth: bounds.width,
      widths: activeWorkspacePaneWidths,
    });
  }

  function isPaneAffectedByResize(paneIndex) {
    return Boolean(
      paneResizeState &&
        (paneIndex === paneResizeState.leftIndex || paneIndex === paneResizeState.leftIndex + 1),
    );
  }

  function renderPlusIcon() {
    return (
      <svg className="plus-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path d="M8 3h2v5h5v2h-5v5H8v-5H3V8h5z" />
      </svg>
    );
  }

  function renderSettingsIcon() {
    return (
      <svg className="settings-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path
          d="M8.2 2.3h1.6l.4 1.9c.5.1.9.3 1.3.5L13.2 3.6l1.1 1.1-1.1 1.7c.2.4.4.8.5 1.3l1.9.4v1.6l-1.9.4c-.1.5-.3.9-.5 1.3l1.1 1.7-1.1 1.1-1.7-1.1c-.4.2-.8.4-1.3.5l-.4 1.9H8.2l-.4-1.9c-.5-.1-.9-.3-1.3-.5l-1.7 1.1-1.1-1.1 1.1-1.7c-.2-.4-.4-.8-.5-1.3l-1.9-.4V8.1l1.9-.4c.1-.5.3-.9.5-1.3L3.7 4.7l1.1-1.1 1.7 1.1c.4-.2.8-.4 1.3-.5l.4-1.9Zm.8 4A2.7 2.7 0 1 0 9 11.7 2.7 2.7 0 0 0 9 6.3Z"
          fillRule="evenodd"
        />
      </svg>
    );
  }

  function renderMatrixIcon() {
    return (
      <svg className="matrix-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        {[1, 7, 13].flatMap((x) =>
          [1, 7, 13].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="0.8" />),
        )}
      </svg>
    );
  }

  function renderRowsIcon() {
    return (
      <svg className="rows-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <rect x="2" y="3" width="14" height="3" rx="0.8" />
        <rect x="2" y="7.5" width="14" height="3" rx="0.8" />
        <rect x="2" y="12" width="14" height="3" rx="0.8" />
      </svg>
    );
  }

  function renderDiagramsIcon() {
    return (
      <svg className="diagrams-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <rect x="3" y="9.5" width="2.8" height="5.5" rx="0.7" />
        <rect x="7.6" y="4.6" width="2.8" height="10.4" rx="0.7" />
        <rect x="12.2" y="7.2" width="2.8" height="7.8" rx="0.7" />
      </svg>
    );
  }

  function renderBlockingToolIcon(tool) {
    switch (tool) {
      case BLOCKING_TOOL_RECTANGLE:
        return (
          <svg className="blocking-tool-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="M3 4h12v10H3V4Zm2 2v6h8V6H5Z" fillRule="evenodd" />
          </svg>
        );
      case BLOCKING_TOOL_POLYLINE:
        return (
          <svg className="blocking-tool-icon is-stroked" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="M3.5 13.5 7 5l4 4 3.5-5.5" />
            <circle cx="3.5" cy="13.5" r="1.2" />
            <circle cx="7" cy="5" r="1.2" />
            <circle cx="11" cy="9" r="1.2" />
            <circle cx="14.5" cy="3.5" r="1.2" />
          </svg>
        );
      case BLOCKING_TOOL_PAN:
        return (
          <svg className="blocking-tool-icon is-stroked" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="M5.1 8.6V5.1a1.2 1.2 0 0 1 2.4 0v3.1" />
            <path d="M7.5 8V3.8a1.2 1.2 0 0 1 2.4 0v4" />
            <path d="M9.9 8.2V4.8a1.15 1.15 0 0 1 2.3 0v4.1" />
            <path d="M12.2 8.9V6.4a1.1 1.1 0 0 1 2.2 0v4.2c0 3.1-1.9 5-5 5H8.1c-1.5 0-2.7-.6-3.6-1.7L2.3 11a1.12 1.12 0 0 1 1.6-1.5l1.2 1.1" />
          </svg>
        );
      case BLOCKING_TOOL_SELECT:
      default:
        return (
          <svg className="blocking-tool-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
            <path d="m4 2 9.5 8.2-4.4.7 2.4 4.2-1.8 1-2.4-4.2-2.8 3.4L4 2Z" />
          </svg>
        );
    }
  }

  function renderProjectMenuButton(className = "") {
    return (
      <button
        className={`project-menu-button${className ? ` ${className}` : ""}`}
        type="button"
        onClick={toggleProjectMenu}
        aria-label="Project menu"
        aria-expanded={isProjectMenuOpen}
      >
        <svg className="dots-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
    );
  }

  function renderProjectActionsMenu(className = "") {
    return (
      <div className={`project-actions-menu${className ? ` ${className}` : ""}`} role="menu" onClick={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={openProjectImportPicker} disabled={isImporting}>
          Import Project
        </button>
        <button type="button" role="menuitem" onClick={exportProjectFile} disabled={isProjectSaving || isImporting}>
          Export Project
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setIsProjectMenuOpen(false);
            saveProjectToBackend();
          }}
          disabled={isProjectSaving || isImporting}
        >
          Save Project
        </button>
      </div>
    );
  }

  function renderSideToolMenu(side) {
    if (sideToolMenu !== side) return null;

    const tableAngle = "-90deg";
    const diagramsAngle = "90deg";
    const tableCounterAngle = "90deg";
    const diagramsCounterAngle = "-90deg";

    return (
      <div className={`workspace-side-tool-menu is-${side}`} aria-label={`${side} workspace tools`}>
        <button
          className="table-launcher workspace-tool-option"
          type="button"
          onClick={() => openWorkspaceTool("table", side)}
          aria-label="Open program table"
          style={{ "--tool-angle": tableAngle, "--tool-counter-angle": tableCounterAngle }}
        >
          {renderMatrixIcon()}
        </button>
        <button
          className="diagrams-launcher workspace-tool-option"
          type="button"
          onClick={() => openWorkspaceTool("diagrams", side)}
          aria-label="Open diagrams"
          style={{ "--tool-angle": diagramsAngle, "--tool-counter-angle": diagramsCounterAngle }}
        >
          {renderDiagramsIcon()}
        </button>
      </div>
    );
  }

  function renderSideStrip(side) {
    return (
      <aside className={`workspace-side-strip is-${side}${sideToolMenu === side ? " is-menu-open" : ""}`} aria-label={`${side} workspace actions`}>
        {renderSideToolMenu(side)}
        <button
          className="workspace-add-button workspace-side-add-button"
          type="button"
          onClick={() => toggleSideToolMenu(side)}
          aria-label="Add interface"
          aria-expanded={sideToolMenu === side}
        >
          {renderPlusIcon()}
        </button>
        {side === "right" && (
          <>
            {renderProjectMenuButton("workspace-project-menu-button")}
            {isProjectMenuOpen && renderProjectActionsMenu("is-workspace-menu")}
          </>
        )}
      </aside>
    );
  }

  function renderDiagramsPane(slot, paneIndex) {
    const paneId = getWorkspacePaneId(slot, paneIndex);
    const diagramState = typeof slot === "string"
      ? { ...createDefaultDiagramState(), activeView: normalizeDiagramView(activeDiagramView), stackingSettings }
      : slot.diagramState ?? createDefaultDiagramState();
    const paneActiveDiagramView = normalizeDiagramView(diagramState.activeView);
    const paneStackingSettings = {
      ...createDefaultStackingSettings(),
      ...(diagramState.stackingSettings ?? {}),
    };
    const paneBlockingSettings = normalizeBlockingSettings(diagramState.blockingSettings);
    const paneStackingDiagram = diagramState.stackingDiagram ?? null;
    const paneSourceDocumentId = diagramState.sourceDocumentId ?? "";
    const diagramSourceOptions = getAvailableTableDocumentOptions(paneSourceDocumentId);
    const selectedSourceDocumentId = diagramSourceOptions.some((file) => file.id === paneSourceDocumentId) ? paneSourceDocumentId : "";
    const selectedSourceProgramData = selectedSourceDocumentId ? tableDocuments[selectedSourceDocumentId]?.programData : null;
    const effectivePaneStackingSettings = selectedSourceProgramData
      ? getEffectiveStackingSettingsForProgramData(selectedSourceProgramData, paneStackingSettings)
      : paneStackingSettings;
    const blockingFloorTabs = getBlockingFloorTabs(selectedSourceProgramData, paneBlockingSettings);
    const activeBlockingFloorKey = getActiveBlockingFloorKey(paneBlockingSettings, blockingFloorTabs);
    const activeBlockingFloor = blockingFloorTabs.find((floor) => floor.key === activeBlockingFloorKey) ?? blockingFloorTabs[0];
    const activeBlockingFloorSettings = getBlockingFloorSettings(paneBlockingSettings, activeBlockingFloorKey);
    const blockingFloorBelow = getBlockingFloorBelow(blockingFloorTabs, activeBlockingFloorKey);
    const blockingFloorBelowSettings = blockingFloorBelow
      ? getBlockingFloorSettings(paneBlockingSettings, blockingFloorBelow.key)
      : null;
    const blockingFloorBelowOutline = createBlockingFloorBelowOutline(
      selectedSourceProgramData,
      blockingFloorBelowSettings?.shapes ?? [],
      blockingFloorBelow,
    );
    const activeBlockingLevelOfDetail = paneBlockingSettings.levelOfDetail;
    const blockingProgrammingOptions = getBlockingProgrammingOptions(
      selectedSourceProgramData,
      activeBlockingLevelOfDetail,
      activeBlockingFloor,
    ).map((option) => ({
      ...option,
      placedArea: getBlockingPlacedAreaForProgrammingAttribute(activeBlockingFloorSettings.shapes, option),
    }));
    const blockingGeometryConflicts = getBlockingGeometryConflictsForFloor(
      selectedSourceProgramData,
      activeBlockingFloorSettings.shapes,
      activeBlockingFloor,
    );
    const selectedBlockingProgrammingKey = blockingProgrammingOptions.some(
      (option) => option.key === activeBlockingFloorSettings.selectedProgrammingKey,
    )
      ? activeBlockingFloorSettings.selectedProgrammingKey
      : "";
    const selectedBlockingProgrammingAttribute =
      blockingProgrammingOptions.find((option) => option.key === selectedBlockingProgrammingKey) ?? null;
    const activeBlockingLevelLabel =
      LEVEL_OF_DETAIL_OPTIONS.find((option) => option.value === activeBlockingLevelOfDetail)?.label ?? "Program";
    const titleId = `diagrams-title-${paneIndex}`;

    const updateDiagramState = (updater) => {
      updateWorkspacePane(paneId, (pane) => ({
        ...pane,
        diagramState: updater(pane.diagramState ?? createDefaultDiagramState()),
      }));
    };

    const updateStackingSettings = (updater) => {
      updateDiagramState((currentState) => {
        const currentSettings = {
          ...createDefaultStackingSettings(),
          ...(currentState.stackingSettings ?? {}),
        };
        const currentSourceId = currentState.sourceDocumentId || selectedSourceDocumentId;
        const sourceProgramData = currentSourceId ? tableDocuments[currentSourceId]?.programData : null;
        const currentEffectiveSettings = sourceProgramData
          ? getEffectiveStackingSettingsForProgramData(sourceProgramData, currentSettings)
          : currentSettings;
        const nextSettings = updater(currentEffectiveSettings);
        const nextDiagram = sourceProgramData
          ? buildStackingDiagramForSource(sourceProgramData, nextSettings)
          : currentState.stackingDiagram;

        return {
          ...currentState,
          stackingSettings: nextSettings,
          stackingDiagram: nextDiagram,
        };
      });
    };

    const updateBlockingSettings = (updater) => {
      updateDiagramState((currentState) => {
        const nextSettings = updater(normalizeBlockingSettings(currentState.blockingSettings));
        return {
          ...currentState,
          blockingSettings: normalizeBlockingSettings(nextSettings),
        };
      });
    };

    const updateBlockingFloorSettings = (floorKey, updater, options = {}) => {
      if (!floorKey) return;
      if (options.pushHistory) pushTableHistorySnapshot(createDiagramHistorySnapshot());

      updateBlockingSettings((settings) => {
        const currentFloorSettings = getBlockingFloorSettings(settings, floorKey);
        return {
          ...settings,
          floorSettings: {
            ...settings.floorSettings,
            [floorKey]: normalizeBlockingFloorSettings(updater(currentFloorSettings)),
          },
        };
      });
    };

    const handleBlockingToolChange = (tool) => {
      if (!BLOCKING_TOOL_VALUES.includes(tool)) return;
      updateBlockingSettings((settings) => {
        const currentFloorSettings = getBlockingFloorSettings(settings, activeBlockingFloorKey);

        return {
          ...settings,
          activeTool: tool,
          floorSettings: {
            ...settings.floorSettings,
            [activeBlockingFloorKey]: normalizeBlockingFloorSettings({
              ...currentFloorSettings,
              selectedProgrammingKey: "",
            }),
          },
        };
      });
    };

    const handleBlockingProgrammingButtonClick = (option) => {
      updateBlockingSettings((settings) => {
        const currentFloorSettings = getBlockingFloorSettings(settings, activeBlockingFloorKey);
        const isDeselecting = currentFloorSettings.selectedProgrammingKey === option.key;

        return {
          ...settings,
          activeTool: isDeselecting ? BLOCKING_TOOL_SELECT : BLOCKING_TOOL_NONE,
          floorSettings: {
            ...settings.floorSettings,
            [activeBlockingFloorKey]: normalizeBlockingFloorSettings({
              ...currentFloorSettings,
              selectedProgrammingKey: isDeselecting ? "" : option.key,
            }),
          },
        };
      });
    };

    const handleBlockingFloorChange = (floorKey) => {
      updateBlockingSettings((settings) => ({
        ...settings,
        activeFloorKey: floorKey,
      }));
    };

    const handleAddBlockingFloor = () => {
      const nextFloor = createNextBlockingCustomFloor(blockingFloorTabs);
      updateBlockingSettings((settings) => ({
        ...settings,
        activeFloorKey: nextFloor.key,
        customFloors: [...normalizeBlockingCustomFloors(settings.customFloors), nextFloor],
        floorSettings: {
          ...settings.floorSettings,
          [nextFloor.key]: createDefaultBlockingFloorSettings(),
        },
      }));
    };

    const applySharedStackingHeightSettings = (heightSettings) => {
      if (!selectedSourceDocumentId || !selectedSourceProgramData) {
        updateStackingSettings((settings) => ({
          ...settings,
          ...heightSettings,
        }));
        return;
      }

      const result = setProgramDataStackingHeightSettings(selectedSourceProgramData, heightSettings);
      const sourceProgramData = result.data;
      if (result.changed) {
        updateTableDocumentProgramData(selectedSourceDocumentId, sourceProgramData, { markDirty: true });
      }

      setWorkspaceSlots((slots) =>
        slots.map((currentSlot, index) => {
          if (typeof currentSlot === "string" || getWorkspacePaneType(currentSlot) !== "diagrams") return currentSlot;

          const currentPaneId = getWorkspacePaneId(currentSlot, index);
          const currentState = currentSlot.diagramState ?? createDefaultDiagramState();
          const currentSettings = {
            ...createDefaultStackingSettings(),
            ...(currentState.stackingSettings ?? {}),
            ...heightSettings,
          };

          if (currentState.sourceDocumentId !== selectedSourceDocumentId) {
            return currentPaneId === paneId
              ? {
                  ...currentSlot,
                  diagramState: {
                    ...currentState,
                    stackingSettings: currentSettings,
                  },
                }
              : currentSlot;
          }

          return {
            ...currentSlot,
            diagramState: {
              ...currentState,
              stackingSettings: currentSettings,
              stackingDiagram: buildStackingDiagramForSource(sourceProgramData, currentSettings),
            },
          };
        }),
      );
    };

    const updateSharedStackingHeightSettings = (updater) => {
      const nextSettings = updater(effectivePaneStackingSettings);
      applySharedStackingHeightSettings(getStackingHeightSettings(nextSettings));
    };

    const applySharedStackingSourceDimension = (nextDiagram, updateSourceProgramData) => {
      if (!selectedSourceDocumentId || !selectedSourceProgramData) {
        updateDiagramState((currentState) => ({
          ...currentState,
          stackingDiagram: nextDiagram,
        }));
        return;
      }

      const result = updateSourceProgramData(selectedSourceProgramData);
      const sourceProgramData = result.data;
      if (result.changed) {
        updateTableDocumentProgramData(selectedSourceDocumentId, sourceProgramData, { markDirty: true });
      }

      setWorkspaceSlots((slots) =>
        slots.map((currentSlot, index) => {
          if (typeof currentSlot === "string" || getWorkspacePaneType(currentSlot) !== "diagrams") return currentSlot;

          const currentPaneId = getWorkspacePaneId(currentSlot, index);
          const currentState = currentSlot.diagramState ?? createDefaultDiagramState();
          if (currentState.sourceDocumentId !== selectedSourceDocumentId) {
            return currentPaneId === paneId
              ? {
                  ...currentSlot,
                  diagramState: {
                    ...currentState,
                    stackingDiagram: nextDiagram,
                  },
                }
              : currentSlot;
          }

          return {
            ...currentSlot,
            diagramState: {
              ...currentState,
              stackingDiagram: buildStackingDiagramForSource(
                sourceProgramData,
                currentState.stackingSettings ?? createDefaultStackingSettings(),
              ),
            },
          };
        }),
      );
    };

    const applySharedStackingFloorHeight = (nextDiagram, dimension, value) => {
      applySharedStackingSourceDimension(nextDiagram, (sourceProgramData) =>
        setProgramDataStackingFloorHeight(sourceProgramData, dimension.floorKey, value),
      );
    };

    const applySharedStackingFloorBounds = (nextDiagram, floorKey, bounds) => {
      applySharedStackingSourceDimension(nextDiagram, (sourceProgramData) =>
        setProgramDataStackingFloorBounds(sourceProgramData, floorKey, bounds),
      );
    };

    const applySharedStackingSlabHeight = (nextDiagram, dimension, value) => {
      const slabKey = dimension.slabKey ?? getStackingSlabs(nextDiagram)[dimension.slabIndex]?.key;
      applySharedStackingSourceDimension(nextDiagram, (sourceProgramData) =>
        setProgramDataStackingSlabHeight(sourceProgramData, slabKey, value),
      );
    };

    const handleDiagramSourceChange = async (event) => {
      const sourceDocumentId = event.target.value;
      if (!sourceDocumentId || sourceDocumentId === selectedSourceDocumentId) return;

      try {
        setErrorMessage("");
        const loadedProgramData = await loadProgramDataFileDocument(sourceDocumentId);
        const currentProgramData =
          loadedProgramData ??
          tableDocuments[sourceDocumentId]?.programData ??
          getTableDocument(sourceDocumentId)?.programData;
        const sourceState = ensureProgramDataDiagramSourceState(currentProgramData, paneStackingSettings);
        const sourceProgramData = sourceState.data;
        const hasExistingDocument = Boolean(tableDocuments[sourceDocumentId]);

        if (hasExistingDocument) {
          updateTableDocumentProgramData(sourceDocumentId, sourceProgramData, {
            markDirty: sourceState.changed,
            rebuildStackingConflicts: true,
          });
        } else {
          setTableDocumentFromData(sourceDocumentId, sourceProgramData, {
            markDirty: sourceState.changed,
            rebuildStackingConflicts: true,
          });
        }

        const nextSettings = getEffectiveStackingSettingsForProgramData(sourceProgramData, paneStackingSettings);
        const stackingDiagram = buildStackingDiagramForSource(sourceProgramData, nextSettings);

        updateDiagramState((currentState) => {
          const blockingValidation = validateBlockingSettingsForProgramData(sourceProgramData, currentState.blockingSettings);

          return {
            ...currentState,
            sourceDocumentId,
            stackingSettings: nextSettings,
            blockingSettings: blockingValidation.settings,
            stackingDiagram,
          };
        });
      } catch (error) {
        setErrorMessage(error.message);
      }
    };

    const handleStackingDiagramChange = (nextDiagram, change) => {
      const dimension = change?.dimension;
      if (change?.kind === "segment-drag" || change?.kind === "floor-resize") {
        pushTableHistorySnapshot(createDiagramHistorySnapshot());
      }

      if (change?.kind === "floor-resize") {
        applySharedStackingFloorBounds(nextDiagram, change.floorKey, change.bounds);
        return;
      }

      if (dimension?.kind === "floor") {
        applySharedStackingFloorHeight(nextDiagram, dimension, change.value);
        return;
      }

      if (dimension?.kind === "slab") {
        applySharedStackingSlabHeight(nextDiagram, dimension, change.value);
        return;
      }

      updateDiagramState((currentState) => ({
        ...currentState,
        stackingSettings: dimension?.kind === "width"
          ? {
              ...(currentState.stackingSettings ?? createDefaultStackingSettings()),
              defaultWidth: String(nextDiagram.defaultWidth ?? effectivePaneStackingSettings.defaultWidth),
            }
          : currentState.stackingSettings,
        stackingDiagram: nextDiagram,
      }));
    };

    return (
      <section className="diagrams-panel diagrams-app" id={`diagrams-panel-${paneIndex}`} aria-labelledby={titleId}>
        <header className="diagrams-panel-header">
          <h2 id={titleId}>Diagrams</h2>
        </header>
        <div
          className="diagrams-panel-body"
          role="tabpanel"
          aria-label={paneActiveDiagramView === DIAGRAM_VIEW_STACKING ? "Stacking" : "Blocking"}
        >
          <aside className="diagrams-settings-sidebar">
            <div className="diagrams-panel-tabs" role="tablist" aria-label="Diagram views">
              <button
                className={`diagrams-tab${paneActiveDiagramView === DIAGRAM_VIEW_STACKING ? " is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={paneActiveDiagramView === DIAGRAM_VIEW_STACKING}
                onClick={() => updateDiagramState((currentState) => ({ ...currentState, activeView: DIAGRAM_VIEW_STACKING }))}
              >
                Stacking
              </button>
              <button
                className={`diagrams-tab${paneActiveDiagramView === DIAGRAM_VIEW_BLOCKING ? " is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={paneActiveDiagramView === DIAGRAM_VIEW_BLOCKING}
                onClick={() => updateDiagramState((currentState) => ({ ...currentState, activeView: DIAGRAM_VIEW_BLOCKING }))}
              >
                Blocking
              </button>
            </div>
            <div
              className={`diagrams-settings${paneActiveDiagramView === DIAGRAM_VIEW_BLOCKING ? " is-blocking-settings" : ""}`}
              aria-label={`${paneActiveDiagramView === DIAGRAM_VIEW_STACKING ? "Stacking" : "Blocking"} diagram settings`}
            >
              {paneActiveDiagramView === DIAGRAM_VIEW_STACKING && (
                <>
                <label className="diagrams-field">
                  <span>Default Floor-to-Floor Height:</span>
                  <span className="diagrams-height-inputs">
                    <input
                      className="diagrams-number-input"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={effectivePaneStackingSettings.defaultFloorToFloorFeet}
                      aria-label="Default floor-to-floor height feet"
                      onChange={(event) =>
                        updateSharedStackingHeightSettings((settings) => ({
                          ...settings,
                          defaultFloorToFloorFeet: event.target.value,
                        }))
                      }
                    />
                    <span aria-hidden="true">'</span>
                    <input
                      className="diagrams-number-input"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="11"
                      step="1"
                      value={effectivePaneStackingSettings.defaultFloorToFloorInches}
                      aria-label="Default floor-to-floor height inches"
                      onChange={(event) =>
                        updateSharedStackingHeightSettings((settings) => ({
                          ...settings,
                          defaultFloorToFloorInches: event.target.value,
                        }))
                      }
                    />
                    <span aria-hidden="true">"</span>
                  </span>
                </label>

                <label className="diagrams-field">
                  <span>Default Width:</span>
                  <span className="diagrams-measure-inputs">
                    <input
                      className="diagrams-number-input diagrams-width-input"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="1"
                      value={effectivePaneStackingSettings.defaultWidth}
                      aria-label="Default diagram width in feet"
                      onChange={(event) =>
                        updateStackingSettings((settings) => ({
                          ...settings,
                          defaultWidth: event.target.value,
                        }))
                      }
                    />
                    <span aria-hidden="true">ft</span>
                  </span>
                </label>

                <label className="diagrams-field">
                  <span>Level of Detail:</span>
                  <select
                    className="diagrams-detail-select"
                    value={effectivePaneStackingSettings.levelOfDetail}
                    onChange={(event) =>
                      updateStackingSettings((settings) => ({
                        ...settings,
                        levelOfDetail: event.target.value,
                      }))
                    }
                  >
                    {LEVEL_OF_DETAIL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="diagrams-field">
                  <span>Text Size:</span>
                  <input
                    className="diagrams-number-input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    value={effectivePaneStackingSettings.textSize}
                    onChange={(event) =>
                      updateStackingSettings((settings) => ({
                        ...settings,
                        textSize: event.target.value,
                      }))
                    }
                  />
                </label>

                <button
                  className={`diagrams-toggle-button${effectivePaneStackingSettings.grossSquareFootage ? " is-on" : ""}`}
                  type="button"
                  aria-pressed={effectivePaneStackingSettings.grossSquareFootage}
                  onClick={() =>
                    updateStackingSettings((settings) => ({
                      ...settings,
                      grossSquareFootage: !settings.grossSquareFootage,
                    }))
                  }
                >
                  <span>Gross Square Footage</span>
                </button>

                <button
                  className={`diagrams-toggle-button${effectivePaneStackingSettings.netSquareFootage ? " is-on" : ""}`}
                  type="button"
                  aria-pressed={effectivePaneStackingSettings.netSquareFootage}
                  onClick={() =>
                    updateStackingSettings((settings) => ({
                      ...settings,
                      netSquareFootage: !settings.netSquareFootage,
                    }))
                  }
                >
                  <span>Net Square Footage</span>
                </button>
                </>
              )}

              {paneActiveDiagramView === DIAGRAM_VIEW_BLOCKING && (
                <>
                  <div className="blocking-floor-tabs" role="tablist" aria-label="Blocking floors">
                    {blockingFloorTabs.map((floor) => (
                      <button
                        className={`blocking-floor-tab${floor.key === activeBlockingFloorKey ? " is-active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={floor.key === activeBlockingFloorKey}
                        key={floor.key}
                        onClick={() => handleBlockingFloorChange(floor.key)}
                      >
                        {floor.label}
                      </button>
                    ))}
                    <button
                      className="blocking-floor-add-button"
                      type="button"
                      aria-label="Add floor"
                      title="Add floor"
                      onClick={handleAddBlockingFloor}
                    >
                      {renderPlusIcon()}
                    </button>
                  </div>

                  <label className="diagrams-field">
                    <span>Grid Spacing:</span>
                    <span className="diagrams-height-inputs">
                      <input
                        className="diagrams-number-input"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={paneBlockingSettings.gridSpacingFeet}
                        aria-label="Blocking grid spacing feet"
                        onChange={(event) =>
                          updateBlockingSettings((settings) => ({
                            ...settings,
                            gridSpacingFeet: event.target.value,
                          }))
                        }
                      />
                      <span aria-hidden="true">'</span>
                      <input
                        className="diagrams-number-input"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="11"
                        step="1"
                        value={paneBlockingSettings.gridSpacingInches}
                        aria-label="Blocking grid spacing inches"
                        onChange={(event) =>
                          updateBlockingSettings((settings) => ({
                            ...settings,
                            gridSpacingInches: event.target.value,
                          }))
                        }
                      />
                      <span aria-hidden="true">"</span>
                    </span>
                  </label>

                  <label className="diagrams-field">
                    <span>Structural Grid:</span>
                    <span className="diagrams-height-inputs">
                      <input
                        className="diagrams-number-input"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={paneBlockingSettings.structuralGridFeet}
                        aria-label="Structural grid feet"
                        onChange={(event) =>
                          updateBlockingSettings((settings) => ({
                            ...settings,
                            structuralGridFeet: event.target.value,
                          }))
                        }
                      />
                      <span aria-hidden="true">'</span>
                      <input
                        className="diagrams-number-input"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="11"
                        step="1"
                        value={paneBlockingSettings.structuralGridInches}
                        aria-label="Structural grid inches"
                        onChange={(event) =>
                          updateBlockingSettings((settings) => ({
                            ...settings,
                            structuralGridInches: event.target.value,
                          }))
                        }
                      />
                      <span aria-hidden="true">"</span>
                    </span>
                  </label>

                  <label className="diagrams-field">
                    <span>Level of Detail:</span>
                    <select
                      className="diagrams-detail-select"
                      value={activeBlockingLevelOfDetail}
                      onChange={(event) =>
                        updateBlockingSettings((settings) => ({
                          ...settings,
                          levelOfDetail: event.target.value,
                          floorSettings: Object.fromEntries(
                            Object.entries(settings.floorSettings ?? {}).map(([floorKey, floorSettings]) => [
                              floorKey,
                              normalizeBlockingFloorSettings({
                                ...floorSettings,
                                selectedProgrammingKey: "",
                              }),
                            ]),
                          ),
                        }))
                      }
                    >
                      {LEVEL_OF_DETAIL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="diagrams-field">
                    <span>Text Size:</span>
                    <input
                      className="diagrams-number-input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.1"
                      value={activeBlockingFloorSettings.textSize}
                      onChange={(event) =>
                        updateBlockingFloorSettings(activeBlockingFloorKey, (settings) => ({
                          ...settings,
                          textSize: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <hr className="diagrams-settings-divider" />

                  <div className="blocking-tool-row" role="toolbar" aria-label="Blocking tools">
                    {[
                      { value: BLOCKING_TOOL_SELECT, label: "Select", title: "Select" },
                      { value: BLOCKING_TOOL_RECTANGLE, label: "Rectangle", title: "Rectangle (R)" },
                      { value: BLOCKING_TOOL_POLYLINE, label: "Polyline", title: "Polyline (T)" },
                      { value: BLOCKING_TOOL_PAN, label: "Pan", title: "Pan (Space)" },
                    ].map((tool) => (
                      <button
                        className={`blocking-tool-button${paneBlockingSettings.activeTool === tool.value ? " is-active" : ""}`}
                        type="button"
                        aria-label={tool.label}
                        aria-pressed={paneBlockingSettings.activeTool === tool.value}
                        title={tool.title}
                        key={tool.value}
                        onClick={() => handleBlockingToolChange(tool.value)}
                      >
                        {renderBlockingToolIcon(tool.value)}
                      </button>
                    ))}
                  </div>

                  <hr className="diagrams-settings-divider" />

                  <section className="blocking-programming-section" aria-labelledby={`${titleId}-programming`}>
                    <h3 className="blocking-programming-title" id={`${titleId}-programming`}>
                      Programming
                    </h3>
                    <div className="blocking-programming-list" aria-label={`${activeBlockingLevelLabel} programming options`}>
                      {blockingProgrammingOptions.length > 0 ? (
                        blockingProgrammingOptions.map((option) => {
                          const isSelected = option.key === selectedBlockingProgrammingKey;
                          const isCirculation = isBlockingCirculationProgrammingAttribute(option);

                          return (
                            <div className="blocking-programming-row" key={option.key}>
                              <button
                                className={`blocking-programming-button${isSelected ? " is-active" : ""}`}
                                type="button"
                                aria-pressed={isSelected}
                                style={{
                                  "--programming-color": option.color,
                                  "--programming-hover-fill": option.hoverFillColor,
                                  "--programming-active-fill": option.activeFillColor,
                                }}
                                onClick={() => handleBlockingProgrammingButtonClick(option)}
                              >
                                <span className="blocking-programming-swatch" aria-hidden="true" />
                                <span className="blocking-programming-label">{option.label}</span>
                              </button>
                              <span className="blocking-programming-metric">
                                <span>{formatBlockingProgrammingProgress(option)}</span>
                                {option.level === "room" && !isCirculation && (
                                  <span className="blocking-programming-count">{formatBlockingProgrammingRoomCount(option.roomCount)}</span>
                                )}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <p className="blocking-programming-empty">No {activeBlockingLevelLabel.toLowerCase()} data</p>
                      )}
                    </div>
                  </section>
                </>
              )}

              <label className="diagrams-field diagrams-source-field">
                <span>Source:</span>
                <select
                  className="diagrams-source-select"
                  value={selectedSourceDocumentId}
                  onChange={handleDiagramSourceChange}
                  disabled={diagramSourceOptions.length === 0 || Boolean(loadingProgramDataFileId)}
                >
                  {diagramSourceOptions.length === 0 ? (
                    <option value="">No parsed JSON files</option>
                  ) : (
                    <>
                      <option value="" disabled>
                        Select source
                      </option>
                      {diagramSourceOptions.map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.label}
                        </option>
                      ))}
                    </>
                  )}
                  </select>
              </label>
            </div>
          </aside>
          {paneActiveDiagramView === DIAGRAM_VIEW_STACKING ? (
            <StackingDiagramCanvas
              diagram={paneStackingDiagram}
              sourceDocumentId={selectedSourceDocumentId}
              onDiagramChange={handleStackingDiagramChange}
              onSegmentFloorChange={(change) => handleStackingSegmentFloorChange(selectedSourceDocumentId, change, paneId)}
            />
          ) : (
            <BlockingDiagramCanvas
              activeFloor={activeBlockingFloor}
              activeTool={paneBlockingSettings.activeTool}
              blockingSettings={paneBlockingSettings}
              floorBelowOutline={blockingFloorBelowOutline}
              floorSettings={activeBlockingFloorSettings}
              geometryConflicts={blockingGeometryConflicts}
              isKeyboardActive={
                activeWorkspacePane?.type === "diagrams"
                  ? activeWorkspacePane.id === paneId
                  : !activeWorkspacePane && isDiagramsOpen && !isTableOpen
              }
              levelOfDetail={activeBlockingLevelOfDetail}
              onActiveToolChange={handleBlockingToolChange}
              onFloorSettingsChange={(updater, options) =>
                updateBlockingFloorSettings(activeBlockingFloorKey, updater, options)
              }
              onSelectionChange={(selectedShapes) =>
                focusBlockingSelectionInHierarchy(selectedSourceDocumentId, selectedShapes, activeBlockingLevelOfDetail)
              }
              programmingAttribute={selectedBlockingProgrammingAttribute}
            />
          )}
        </div>
      </section>
    );
  }

  function renderHierarchicalSpreadsheetView(documentId, tableDocument, rows, paneId) {
    const hierarchy = buildSpreadsheetHierarchy(tableDocument.programData, rows);

    if (hierarchy.rowCount === 0) {
      return <div className="empty-state">No program rows</div>;
    }

    return (
      <div className="hierarchical-spreadsheet" aria-label="Hierarchical spreadsheet view">
        {hierarchy.children.length > 0 ? (
          hierarchy.children.map((node) => renderHierarchyNode(node, documentId, paneId, 0))
        ) : (
          renderHierarchyRowsTable(hierarchy, documentId, paneId)
        )}
      </div>
    );
  }

  function renderHierarchyNode(node, documentId, paneId, depth) {
    const isOpen = isHierarchyNodeOpen(paneId, documentId, node.key, depth);
    const showNodeConflictButton = shouldShowHierarchyNodeConflictButton(documentId, node, isOpen);
    const isBlockingFocusedNode =
      blockingHierarchyFocus?.paneId === paneId &&
      blockingHierarchyFocus?.documentId === (documentId || DEFAULT_TABLE_DOCUMENT_ID) &&
      blockingHierarchyFocus?.nodeKey === node.key;

    return (
      <details
        className="hierarchy-node"
        key={node.key}
        open={isOpen}
        onToggle={(event) => updateHierarchyNodeOpenState(paneId, documentId, node.key, event.currentTarget.open)}
      >
        <summary
          className={`hierarchy-node-summary${isBlockingFocusedNode ? " is-blocking-focus" : ""}`}
          data-hierarchy-node-key={node.key}
          style={{
            "--hierarchy-node-color": node.color || undefined,
            "--hierarchy-node-fill": node.fillColor || undefined,
            "--hierarchy-node-hover-fill": node.hoverFillColor || node.fillColor || undefined,
          }}
        >
          <span className="hierarchy-node-heading">
            <span className="hierarchy-node-level">{node.levelLabel}</span>
            <span className="hierarchy-node-name">{node.label}</span>
          </span>
          <span className="hierarchy-node-meta">
            {node.rowCount === 1 ? "1 room" : `${node.rowCount} rooms`} / {formatArea(node.totalNsf)} NSF
          </span>
          {showNodeConflictButton && (
            <button
              className="stacking-conflict-button hierarchy-conflict-button"
              type="button"
              aria-label={`Show information conflicts for ${node.label}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                focusHierarchyNodeConflict(documentId, paneId, node);
              }}
            >
              <span aria-hidden="true">!</span>
            </button>
          )}
        </summary>
        <div className="hierarchy-node-content">
          {node.children.map((child) => renderHierarchyNode(child, documentId, paneId, depth + 1))}
          {node.rows.length > 0 && renderHierarchyRowsTable(node, documentId, paneId)}
        </div>
      </details>
    );
  }

  function getHierarchyOpenStateKey(paneId, documentId) {
    return `${paneId || "default"}::${documentId || DEFAULT_TABLE_DOCUMENT_ID}`;
  }

  function isHierarchyNodeOpen(paneId, documentId, nodeKey, depth) {
    const stateKey = getHierarchyOpenStateKey(paneId, documentId);
    const storedValue = hierarchyNodeOpenStates[stateKey]?.[nodeKey];
    return typeof storedValue === "boolean" ? storedValue : depth === 0;
  }

  function updateHierarchyNodeOpenState(paneId, documentId, nodeKey, isOpen) {
    const stateKey = getHierarchyOpenStateKey(paneId, documentId);

    setHierarchyNodeOpenStates((states) => {
      const currentState = states[stateKey] ?? {};
      if (currentState[nodeKey] === isOpen) return states;

      return {
        ...states,
        [stateKey]: {
          ...currentState,
          [nodeKey]: isOpen,
        },
      };
    });
  }

  function renderHierarchyRowsTable(node, documentId, paneId) {
    const rows = node.rows;
    const hierarchyColumns = getHierarchicalSpreadsheetColumns(spreadsheetSettings);
    const tableWidth = getHierarchicalTableMinWidth(hierarchyColumns);
    const tableDocument = getTableDocument(documentId);
    const tableState = getTablePaneStateById(paneId);
    const rowIndexById = new Map(rows.map((row, index) => [row.id, index]));
    const columnIndexByKey = new Map(hierarchyColumns.map((column, index) => [column.key, index]));
    const selectionRanges = getSelectionRangesFromState(tableState);
    const normalizedSelectionRanges = getNormalizedSelectionRanges(
      selectionRanges,
      rowIndexById,
      columnIndexByKey,
    );
    const selectionCellCount = getSelectionCellCount(normalizedSelectionRanges);
    const conflictCellPositions = getStackingConflictCellPositionSet(documentId, rows, hierarchyColumns);
    const visibleConflictAnchorCellKeys = getVisibleStackingConflictAnchorCellKeys(
      documentId,
      rows.map((row) => ({ row })),
    );

    return (
      <div className="hierarchy-leaf-table-wrap">
        <table className="program-table hierarchy-leaf-table" style={{ width: tableWidth, minWidth: tableWidth }} aria-label={`${node.label} rooms and programs`}>
          <thead>
            <tr>
              {hierarchyColumns.map((column) => (
                <th className={column.className} key={column.key} scope="col" style={getHierarchyTableHeaderStyle(node, column.key)}>
                  <span className="column-label">{getTableColumnDisplayLabel(column)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const totalNsf = computeTotalNsf(row.quantity, row.nsfPerUnit);

              return (
                <tr key={row.id}>
                  {hierarchyColumns.map((column, columnIndex) => {
                    const documentCellKey = getDocumentCellKey(documentId, row.id, column.key);
                    const stackingConflict = getStackingConflictForCell(documentId, row.id, column.key);
                    const shouldShowConflictButton =
                      Boolean(stackingConflict) &&
                      visibleConflictAnchorCellKeys.has(documentCellKey);
                    const cellClassName = [
                      column.className,
                      stackingConflict ? "is-stacking-conflict" : "",
                      stackingConflict?.status === "pending" ? "is-stacking-conflict-pending" : "",
                      stackingConflict?.status === "ignored" ? "is-stacking-conflict-ignored" : "",
                      shouldShowConflictButton ? "has-stacking-conflict-control" : "",
                      getStackingConflictEdgeClassName(rowIndex, columnIndex, conflictCellPositions),
                      getTableCellClassName(
                        row.id,
                        column.key,
                        rowIndex,
                        columnIndex,
                        normalizedSelectionRanges,
                        selectionCellCount,
                        tableDocument.cellStyles,
                      ),
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <td
                        className={cellClassName}
                        key={column.key}
                        data-cell-key={getCellKey(row.id, column.key)}
                        data-column-index={columnIndex}
                        data-row-index={rowIndex}
                        style={getTableColumnStyle(column.key)}
                      >
                        {shouldShowConflictButton && renderStackingConflictControl(stackingConflict, documentCellKey)}
                        {column.key === "totalNsf" ? (
                          <output aria-label={getCellAriaLabel(row, column)}>{formatArea(totalNsf)}</output>
                        ) : (
                          <input
                            value={row[column.key] ?? ""}
                            inputMode={getCellInputMode(column.key)}
                            onChange={(event) => updateRow(row.id, column.key, event.target.value, documentId)}
                            onFocus={() => setActiveTablePaneId(paneId)}
                            aria-label={getCellAriaLabel(row, column)}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderTablePane(slot, paneIndex) {
    const paneId = getWorkspacePaneId(slot, paneIndex);
    const tableState = typeof slot === "string"
      ? {
          documentId: DEFAULT_TABLE_DOCUMENT_ID,
          sortConfig,
          advancedSortConfig,
          selectedCells: selectedTableCells,
          selectionRanges: selectedTableRanges,
          selectionAnchor: tableSelectionAnchor,
        }
      : slot.tableState ?? createDefaultTablePaneState();
    const documentId = tableState.documentId ?? DEFAULT_TABLE_DOCUMENT_ID;
    const tableDocument = getTableDocument(documentId);
    const paneSortConfig = tableState.sortConfig ?? null;
    const paneAdvancedSortConfig = tableState.advancedSortConfig ?? null;
    const isBlankSpreadsheet = tableDocument.draftRows.length === 0;
    const isHierarchicalViewSelected = spreadsheetSettings.view === TABLE_VIEW_HIERARCHICAL;
    const isHierarchicalSpreadsheetView = isHierarchicalViewSelected && !isBlankSpreadsheet;
    const paneViewKey = isHierarchicalSpreadsheetView ? TABLE_VIEW_HIERARCHICAL : TABLE_VIEW_SPREADSHEET;
    const paneColumns = getTableColumnsForDocument(tableDocument, spreadsheetSettings);
    const paneSortedRows = getTableRowsForDisplay(documentId, tableDocument, paneSortConfig, paneAdvancedSortConfig);
    const paneVisibleRowIndexById = new Map(paneSortedRows.map((row, index) => [row.id, index]));
    const paneColumnIndexByKey = new Map(paneColumns.map((column, index) => [column.key, index]));
    const paneSelectionRanges = getSelectionRangesFromState(tableState);
    const paneNormalizedSelectionRanges = getNormalizedSelectionRanges(
      paneSelectionRanges,
      paneVisibleRowIndexById,
      paneColumnIndexByKey,
    );
    const paneSelectionCellCount = getSelectionCellCount(paneNormalizedSelectionRanges);
    const paneSelectedRowIds = getSelectedRowIdsFromRanges(paneNormalizedSelectionRanges, paneSortedRows);
    const paneSelectedColumnKeys = getSelectedColumnKeysFromRanges(paneNormalizedSelectionRanges, paneColumns);
    const panePendingConflictCellPositions = getStackingConflictCellPositionSet(documentId, paneSortedRows, paneColumns);
    const paneActiveCell = tableState.selectionAnchor ?? getFirstSelectionCell(paneSelectionRanges);
    const paneTableWidth = getPaneTableMinWidth(paneColumns);
    const virtualRows = getVirtualTableRows(paneSortedRows, getTableViewportMetricsForPane(paneId, paneViewKey));
    const visibleConflictAnchorCellKeys = getVisibleStackingConflictAnchorCellKeys(documentId, virtualRows.rows);
    const titleId = `program-table-title-${paneIndex}`;
    const isPaneSaving = savingTablePaneId === paneId;
    const isPaneImporting = activeSpreadsheetImportPaneId === paneId && isImporting;
    const shouldShowLoading = isLoading && (!isImporting || !activeSpreadsheetImportPaneId || isPaneImporting);
    const spreadsheetTitleValue = tableDocument.draftProjectName ?? "";
    const spreadsheetTitle = spreadsheetTitleValue || "Untitled Project";
    const isTitleMenuOpen = openSpreadsheetTitlePaneId === paneId;
    const documentOptions = getAvailableTableDocumentOptions(documentId);
    const selectableDocumentOptions = documentOptions.filter((option) => option.id !== documentId);
    const paneConflicts = getUnresolvedStackingConflictsForDocument(documentId);
    const paneConflictCount = paneConflicts.length;
    const paneConflictLabel = paneConflictCount === 1 ? "1 conflict" : `${paneConflictCount} conflicts`;
    const paneConflictIds = paneConflicts.map((conflict) => conflict.id);
    const hasPendingPaneConflicts = paneConflicts.some((conflict) => conflict.status === "pending");
    const hasIgnoredOnlyPaneConflicts = paneConflictCount > 0 && !hasPendingPaneConflicts;
    const isFooterConflictMenuOpen = footerConflictMenuPaneId === paneId && paneConflictCount > 0;
    const spreadsheetViewToggleLabel = isHierarchicalViewSelected
      ? "Hierarchical view. Switch to spreadsheet view"
      : "Spreadsheet view. Switch to hierarchical view";
    const spreadsheetViewToggleTitle = isHierarchicalViewSelected
      ? "Switch to spreadsheet view"
      : "Switch to hierarchical view";

    return (
      <section className="table-modal table-app" role="region" aria-labelledby={titleId} data-pane-id={paneId}>
        <header className="table-modal-header">
          <div
            className={`program-title-dropdown${isTitleMenuOpen ? " is-open" : ""}`}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="program-title-editor-wrap" data-value={spreadsheetTitle}>
              <input
                id={titleId}
                className="program-title-input program-title-editor"
                type="text"
                value={spreadsheetTitleValue}
                placeholder="Untitled Project"
                aria-label="Spreadsheet title"
                onChange={(event) => updateSpreadsheetTitle(documentId, event.target.value)}
                onFocus={() => setActiveTablePaneId(paneId)}
              />
            </span>
            <button
              className="program-title-arrow-button"
              type="button"
              aria-label="Spreadsheet options"
              aria-haspopup="menu"
              aria-expanded={isTitleMenuOpen}
              onClick={() => toggleSpreadsheetTitleMenu(paneId)}
            >
              <span className="program-title-arrow" aria-hidden="true" />
            </button>
            {isTitleMenuOpen && (
              <div className="program-title-menu" role="menu" aria-label="Spreadsheet options">
                {selectableDocumentOptions.map((option) => (
                  <button
                    className="program-title-menu-item"
                    type="button"
                    role="menuitem"
                    key={option.id}
                    title={option.path || option.label}
                    disabled={loadingProgramDataFileId === option.id}
                    onClick={() => selectTableDocumentForPane(paneId, option.id)}
                  >
                    {loadingProgramDataFileId === option.id ? "Loading" : option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        <div
          className={`table-shell${isHierarchicalSpreadsheetView ? " hierarchical-table-shell" : ""}`}
          data-table-pane-id={paneId}
          data-table-view={paneViewKey}
          ref={(element) => registerTableShell(paneId, element)}
          onScroll={(event) => updateTableViewportMetrics(paneId, event.currentTarget, paneViewKey)}
        >
          {shouldShowLoading ? (
            <div className="empty-state">{isPaneImporting ? "Importing" : "Loading"}</div>
          ) : errorMessage && tableDocument.draftRows.length === 0 ? (
            <div className="empty-state">{errorMessage}</div>
          ) : isHierarchicalSpreadsheetView ? (
            renderHierarchicalSpreadsheetView(documentId, tableDocument, paneSortedRows, paneId)
          ) : (
            <>
              <table className="program-table" style={{ width: paneTableWidth, minWidth: paneTableWidth }}>
                <thead>
                  <tr>
                    <th
                      className="col-row-number"
                      scope="col"
                      aria-label="Row number"
                      style={{ width: `${TABLE_ROW_NUMBER_COLUMN_WIDTH}px`, minWidth: `${TABLE_ROW_NUMBER_COLUMN_WIDTH}px` }}
                    />
                    {paneColumns.map((column, columnIndex) => (
                      <th
                        className={[
                          column.className,
                          paneSelectedColumnKeys.has(column.key) ? "is-header-selected" : "",
                        ].filter(Boolean).join(" ")}
                        key={column.key}
                        scope="col"
                        aria-sort={getAriaSort(column.key, paneSortConfig)}
                        style={getTableColumnStyle(column.key)}
                        onContextMenu={(event) => openColumnMenu(event, column.key, paneId)}
                      >
                        <button
                          className="column-select-button"
                          type="button"
                          onMouseDown={(event) =>
                            handleTableColumnHeaderMouseDown(
                              event,
                              column.key,
                              paneId,
                              paneSortedRows,
                              paneSelectionRanges,
                              tableState.selectionAnchor,
                              paneColumns,
                            )
                          }
                          onClick={(event) => event.preventDefault()}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            handleTableColumnHeaderMouseDown(
                              event,
                              column.key,
                              paneId,
                              paneSortedRows,
                              paneSelectionRanges,
                              tableState.selectionAnchor,
                              paneColumns,
                            );
                          }}
                        >
                          <span className="column-label">
                            {getTableColumnHeaderLabel(column, columnIndex, isBlankSpreadsheet)}
                          </span>
                        </button>
                        <button
                          className="column-sort-toggle"
                          type="button"
                          aria-label={`Sort ${getTableColumnDisplayLabel(column)}`}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSort(column.key, paneId);
                          }}
                        >
                          <span className={`sort-icon ${getSortIconClass(column.key, paneSortConfig)}`} aria-hidden="true">
                            <span className="sort-triangle sort-triangle-up" />
                            <span className="sort-triangle sort-triangle-down" />
                          </span>
                        </button>
                        <span
                          className="table-column-resize-handle"
                          role="separator"
                          aria-orientation="vertical"
                          onMouseDown={(event) => startTableColumnResize(event, column.key)}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {virtualRows.topSpacerHeight > 0 && (
                    <tr className="table-virtual-spacer" aria-hidden="true">
                      <td
                        colSpan={paneColumns.length + 1}
                        style={{ height: `${virtualRows.topSpacerHeight}px`, minHeight: `${virtualRows.topSpacerHeight}px` }}
                      />
                    </tr>
                  )}
                  {virtualRows.rows.map(({ row, rowIndex }) => {
                    const totalNsf = computeTotalNsf(row.quantity, row.nsfPerUnit);
                    const rowHeight = getTableRowHeight(row.id);

                    return (
                      <tr key={row.id} style={{ "--table-row-height": `${rowHeight}px` }}>
                        <th
                          className={[
                            "col-row-number",
                            "row-number-cell",
                            paneSelectedRowIds.has(row.id) ? "is-header-selected" : "",
                          ].filter(Boolean).join(" ")}
                          scope="row"
                          style={{ width: `${TABLE_ROW_NUMBER_COLUMN_WIDTH}px`, minWidth: `${TABLE_ROW_NUMBER_COLUMN_WIDTH}px` }}
                          onMouseDown={(event) =>
                            handleTableRowHeaderMouseDown(
                              event,
                              row.id,
                              paneId,
                              paneSelectionRanges,
                              tableState.selectionAnchor,
                              paneVisibleRowIndexById,
                              paneSortedRows,
                              paneColumns,
                            )
                          }
                        >
                          {rowIndex + 1}
                          <span
                            className="table-row-resize-handle"
                            role="separator"
                            aria-orientation="horizontal"
                            onMouseDown={(event) => startTableRowResize(event, row.id)}
                          />
                        </th>
                        {paneColumns.map((column, columnIndex) => {
                          const isEditing = isTableCellEditing(paneId, row.id, column.key);
                          const cellKey = getCellKey(row.id, column.key);
                          const documentCellKey = getDocumentCellKey(documentId, row.id, column.key);
                          const stackingConflict = getStackingConflictForCell(documentId, row.id, column.key);
                          const isConflictMenuOpen =
                            Boolean(stackingConflict) &&
                            conflictMenu?.conflictId === stackingConflict.id &&
                            conflictMenu?.cellKey === documentCellKey;
                          const shouldShowConflictButton =
                            Boolean(stackingConflict) &&
                            visibleConflictAnchorCellKeys.has(documentCellKey);
                          const isActiveCell = paneActiveCell?.rowId === row.id && paneActiveCell?.columnKey === column.key;
                          const cellClassName = [
                            column.className,
                            isEditing ? "is-cell-editing" : "",
                            isActiveCell ? "is-cell-active" : "",
                            stackingConflict ? "is-stacking-conflict" : "",
                            stackingConflict?.status === "pending" ? "is-stacking-conflict-pending" : "",
                            stackingConflict?.status === "ignored" ? "is-stacking-conflict-ignored" : "",
                            shouldShowConflictButton ? "has-stacking-conflict-control" : "",
                            getStackingConflictEdgeClassName(rowIndex, columnIndex, panePendingConflictCellPositions),
                            getTableCellClassName(
                              row.id,
                              column.key,
                              rowIndex,
                              columnIndex,
                              paneNormalizedSelectionRanges,
                              paneSelectionCellCount,
                              tableDocument.cellStyles,
                            ),
                          ]
                            .filter(Boolean)
                            .join(" ");

                          return (
                            <td
                              className={cellClassName}
                              key={column.key}
                              data-cell-key={cellKey}
                              data-column-index={columnIndex}
                              data-row-index={rowIndex}
                              style={getTableColumnStyle(column.key)}
                              onMouseDown={(event) =>
                                handleTableCellMouseDown(
                                  event,
                                  row.id,
                                  column.key,
                                  paneId,
                                  paneSelectionRanges,
                                  tableState.selectionAnchor,
                                  paneVisibleRowIndexById,
                                  paneSortedRows,
                                  paneColumns,
                                )
                              }
                              onMouseEnter={() =>
                                handleTableCellMouseEnter(row.id, column.key, paneId, paneVisibleRowIndexById, paneSortedRows, paneColumns)
                              }
                              onDoubleClick={(event) => handleTableCellDoubleClick(event, row.id, column.key, paneId)}
                            >
                              {shouldShowConflictButton && (
                                <div
                                  className="stacking-conflict-control"
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <button
                                    className={[
                                      "stacking-conflict-button",
                                      stackingConflict.status === "ignored" ? "is-ignored" : "",
                                    ].filter(Boolean).join(" ")}
                                    type="button"
                                    aria-label="Show information conflict"
                                    aria-expanded={isConflictMenuOpen}
                                    onClick={() => {
                                      setFooterConflictMenuPaneId(null);
                                      setConflictMenu((currentMenu) =>
                                        currentMenu?.conflictId === stackingConflict.id && currentMenu?.cellKey === documentCellKey
                                          ? null
                                          : {
                                              cellKey: documentCellKey,
                                              conflictId: stackingConflict.id,
                                            },
                                      );
                                    }}
                                  >
                                    <span aria-hidden="true">!</span>
                                  </button>
                                  {isConflictMenuOpen && (
                                    <div className="stacking-conflict-menu" role="dialog" aria-label="Information conflict">
                                      <p>
                                        <strong>Information conflict:</strong>{" "}
                                        {getStackingConflictExplanation(stackingConflict)}
                                      </p>
                                      <div className="stacking-conflict-menu-actions">
                                        <button type="button" onClick={() => resolveStackingConflict(stackingConflict.id)}>
                                          Update to match diagram
                                        </button>
                                        <button type="button" onClick={() => updateStackingConflictDiagramToMatch(stackingConflict.id)}>
                                          Update diagram to match
                                        </button>
                                        <button
                                          className={stackingConflict.status === "ignored" ? "is-toggle-on" : ""}
                                          type="button"
                                          aria-pressed={stackingConflict.status === "ignored"}
                                          onClick={() => ignoreStackingConflict(stackingConflict.id)}
                                        >
                                          Temporarily ignore
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                              {column.key === "totalNsf" && !isBlankSpreadsheet ? (
                                <output aria-label={getCellAriaLabel(row, column)}>{formatArea(totalNsf)}</output>
                              ) : isEditing ? (
                                <input
                                  ref={isEditing ? editingCellInputRef : null}
                                  value={row[column.key] ?? ""}
                                  inputMode={getCellInputMode(column.key)}
                                  readOnly={!isEditing}
                                  tabIndex={isEditing ? 0 : -1}
                                  onChange={(event) => updateRow(row.id, column.key, event.target.value, documentId)}
                                  onBlur={() => handleTableCellInputBlur(row.id, column.key, paneId)}
                                  aria-label={getCellAriaLabel(row, column)}
                                />
                              ) : (
                                <span className="table-cell-display" aria-label={getCellAriaLabel(row, column)}>
                                  {row[column.key] ?? ""}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {virtualRows.bottomSpacerHeight > 0 && (
                    <tr className="table-virtual-spacer" aria-hidden="true">
                      <td
                        colSpan={paneColumns.length + 1}
                        style={{ height: `${virtualRows.bottomSpacerHeight}px`, minHeight: `${virtualRows.bottomSpacerHeight}px` }}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>

        <footer className="table-modal-footer">
          <div className="footer-left-actions">
            <button
              className="spreadsheet-view-toggle-button table-footer-icon-button"
              type="button"
              onClick={toggleSpreadsheetView}
              aria-label={spreadsheetViewToggleLabel}
              aria-pressed={isHierarchicalViewSelected}
              title={spreadsheetViewToggleTitle}
              disabled={isPaneSaving || isPaneImporting}
            >
              {isHierarchicalViewSelected ? renderRowsIcon() : renderMatrixIcon()}
            </button>
            <button
              className="secondary-button table-footer-icon-button"
              type="button"
              onClick={() => openSpreadsheetSettings(paneId)}
              aria-label="Spreadsheet settings"
              title="Spreadsheet settings"
              disabled={isPaneSaving || isPaneImporting}
            >
              {renderSettingsIcon()}
            </button>
            <button className="secondary-button table-footer-button" type="button" onClick={() => openSpreadsheetImportPicker(paneId)} disabled={isPaneSaving || isPaneImporting}>
              {isPaneImporting ? "Importing" : "Import"}
            </button>
          </div>
          <div className="footer-actions">
            <div
              className="table-footer-warning-control"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className={[
                  "stacking-conflict-button",
                  "table-footer-warning-button",
                  paneConflictCount > 0 ? "has-conflicts" : "is-clear",
                  hasIgnoredOnlyPaneConflicts ? "is-ignored" : "",
                ].join(" ")}
                type="button"
                onClick={() => {
                  if (paneConflictCount === 0) return;
                  setConflictMenu(null);
                  setFooterConflictMenuPaneId((currentPaneId) => (currentPaneId === paneId ? null : paneId));
                }}
                aria-label={paneConflictCount > 0 ? `Show spreadsheet ${paneConflictLabel}` : "No spreadsheet conflicts"}
                aria-haspopup={paneConflictCount > 0 ? "menu" : undefined}
                aria-expanded={paneConflictCount > 0 ? isFooterConflictMenuOpen : undefined}
                title={paneConflictCount > 0 ? paneConflictLabel : "No conflicts"}
                disabled={shouldShowLoading || isPaneSaving || isPaneImporting}
              >
                {paneConflictCount > 0 ? (
                  <span aria-hidden="true">!</span>
                ) : (
                  <span className="table-footer-warning-check" aria-hidden="true" />
                )}
              </button>
              {isFooterConflictMenuOpen && (
                <div className="footer-conflict-menu" role="menu" aria-label="Spreadsheet conflicts">
                  <div className="footer-conflict-menu-list">
                    {paneConflicts.map((conflict) => (
                      <button
                        className={[
                          "footer-conflict-menu-item",
                          conflict.status === "ignored" ? "is-ignored" : "",
                        ].filter(Boolean).join(" ")}
                        type="button"
                        role="menuitem"
                        key={conflict.id}
                        onClick={() => focusStackingConflict(conflict.id, paneId)}
                      >
                        <span className="footer-conflict-menu-title">{getStackingConflictCausalityTitle(conflict)}</span>
                        <span className="footer-conflict-menu-meta">{getStackingConflictCausalityMeta(conflict)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="footer-conflict-menu-actions">
                    <button type="button" role="menuitem" onClick={() => resolveStackingConflicts(paneConflictIds)}>
                      Update all to resolve
                    </button>
                    <button
                      className={hasIgnoredOnlyPaneConflicts ? "is-toggle-on" : ""}
                      type="button"
                      role="menuitem"
                      aria-pressed={hasIgnoredOnlyPaneConflicts}
                      onClick={() => ignoreStackingConflicts(paneConflictIds)}
                    >
                      Temporarily ignore all
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button className="primary-button table-footer-button" type="button" onClick={() => handleSave(paneId)} disabled={shouldShowLoading || isPaneSaving || isPaneImporting}>
              {isPaneSaving ? "Saving" : "Save"}
            </button>
          </div>
        </footer>
      </section>
    );
  }

  function renderWorkspacePane(slot, paneIndex) {
    const paneId = getWorkspacePaneId(slot, paneIndex);
    const paneType = getWorkspacePaneType(slot);
    const showResizePreview = isPaneAffectedByResize(paneIndex);
    const isTablePaneBusy = paneType === "table" && (savingTablePaneId === paneId || (activeSpreadsheetImportPaneId === paneId && isImporting));

    return (
      <div
        className={`workspace-pane-shell${showResizePreview ? " is-resizing" : ""}`}
        onFocusCapture={() => activateWorkspacePane(paneId, paneType)}
        onPointerDownCapture={() => activateWorkspacePane(paneId, paneType)}
        onPointerEnter={() => activateWorkspacePane(paneId, paneType)}
      >
        {showResizePreview ? (
          <div className="workspace-pane-resize-preview" aria-hidden="true">
            <span className="workspace-pane-resize-preview-icon">
              {paneType === "table" ? renderMatrixIcon() : renderDiagramsIcon()}
            </span>
          </div>
        ) : (
          <>
            <button
              className="workspace-pane-close-button"
              type="button"
              onClick={() => (paneType === "table" ? requestTableClose(paneId) : closeWorkspacePane(paneId))}
              disabled={isTablePaneBusy}
              aria-label={`Close ${paneType === "table" ? "table" : "diagrams"} pane`}
            >
              <span aria-hidden="true">x</span>
            </button>
            {paneType === "table" ? renderTablePane(slot, paneIndex) : renderDiagramsPane(slot, paneIndex)}
          </>
        )}
      </div>
    );
  }

  function renderTableOverlays() {
    return (
      <>
        {spreadsheetSettingsPaneId && (
          <div className="spreadsheet-settings-layer" role="presentation">
            <section
              className="spreadsheet-settings-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="spreadsheet-settings-title"
            >
              <header className="spreadsheet-settings-header">
                <h3 id="spreadsheet-settings-title">Spreadsheet Settings</h3>
              </header>
              <div className="spreadsheet-settings-body">
                <label className="spreadsheet-settings-field" htmlFor="spreadsheet-calculate-subtotals">
                  <span>Calculate subtotals</span>
                  <select
                    id="spreadsheet-calculate-subtotals"
                    value={draftSpreadsheetSettings.calculateSubtotals}
                    onChange={(event) =>
                      setDraftSpreadsheetSettings((settings) => ({
                        ...settings,
                        calculateSubtotals: event.target.value,
                      }))
                    }
                  >
                    {LEVEL_OF_DETAIL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  className={`spreadsheet-toggle-button${draftSpreadsheetSettings.distributeIdenticalRooms ? " is-on" : ""}`}
                  type="button"
                  aria-pressed={draftSpreadsheetSettings.distributeIdenticalRooms}
                  onClick={() =>
                    setDraftSpreadsheetSettings((settings) => ({
                      ...settings,
                      distributeIdenticalRooms: !settings.distributeIdenticalRooms,
                    }))
                  }
                >
                  <span>Distribute Identical Rooms</span>
                </button>
              </div>
              <footer className="spreadsheet-settings-footer">
                <button className="secondary-button table-footer-button" type="button" onClick={closeSpreadsheetSettings}>
                  Cancel
                </button>
                <button className="primary-button table-footer-button" type="button" onClick={saveSpreadsheetSettings}>
                  Save
                </button>
              </footer>
            </section>
          </div>
        )}

        {isAdvancedSortOpen && (
          <div className="advanced-sort-layer" role="presentation">
            <section
              className="advanced-sort-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="advanced-sort-title"
            >
              <header className="advanced-sort-header">
                <h3 id="advanced-sort-title">Advanced Sorting</h3>
              </header>

              <div className="advanced-sort-body">
                <div className="advanced-sort-list" role="listbox" aria-label="Advanced sorting priority">
                  {advancedDraftRules.map((rule, index) => {
                    const isSelected = selectedRuleKeySet.has(rule.key);

                    return (
                      <div
                        className={`advanced-sort-row${rule.enabled ? "" : " is-disabled"}${isSelected ? " is-selected" : ""}${draggingRuleKey === rule.key ? " is-dragging" : ""}`}
                        key={rule.key}
                        role="option"
                        aria-selected={isSelected}
                        onClick={(event) => selectAdvancedRule(event, rule.key)}
                        onDragOver={(event) => handleRuleDragOver(event, rule.key)}
                        onDrop={handleRuleDrop}
                      >
                        <span className="advanced-sort-rank">{index + 1}</span>
                        <span className="advanced-sort-name">{rule.label}</span>
                        <button
                          className="advanced-drag-handle"
                          type="button"
                          draggable
                          aria-label={`Reorder ${rule.label}`}
                          onClick={(event) => event.stopPropagation()}
                          onDragStart={(event) => handleRuleDragStart(event, rule.key)}
                          onDragEnd={() => setDraggingRuleKey(null)}
                        >
                          <span />
                          <span />
                          <span />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="advanced-sort-side-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => applyAdvancedRuleEnabled(true)}
                    disabled={selectedRuleKeys.length === 0}
                  >
                    Enable (E)
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => applyAdvancedRuleEnabled(false)}
                    disabled={selectedRuleKeys.length === 0}
                  >
                    Disable (D)
                  </button>
                </div>
              </div>

              <footer className="advanced-sort-footer">
                <button className="secondary-button" type="button" onClick={requestAdvancedSortClose}>
                  Cancel
                </button>
                <button className="primary-button" type="button" onClick={saveAdvancedSort}>
                  Save
                </button>
              </footer>

              {isAdvancedCancelConfirmOpen && (
                <div className="confirm-layer advanced-confirm-layer" role="presentation">
                  <section
                    className="confirm-dialog"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="advanced-cancel-title"
                    aria-describedby="advanced-cancel-description"
                  >
                    <h3 id="advanced-cancel-title">Cancel edits?</h3>
                    <p id="advanced-cancel-description">Your advanced sorting changes will not be saved.</p>
                    <div className="confirm-actions">
                      <button className="danger-button" type="button" onClick={closeAdvancedSortDialog}>
                        Cancel Edits
                      </button>
                      <button className="secondary-button" type="button" onClick={() => setIsAdvancedCancelConfirmOpen(false)}>
                        Keep Editing
                      </button>
                    </div>
                  </section>
                </div>
              )}
            </section>
          </div>
        )}

        {isExitConfirmOpen && (
          <div className="confirm-layer" role="presentation">
            <section
              className="confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="exit-confirm-title"
              aria-describedby="exit-confirm-description"
            >
              <h3 id="exit-confirm-title">Cancel edits?</h3>
              <p id="exit-confirm-description">Your changes will not be saved.</p>
              <div className="confirm-actions">
                <button className="danger-button" type="button" onClick={closeTable}>
                  Cancel Edits
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setIsToolMenuOpen(false);
                    setSideToolMenu(null);
                    setPendingTableClosePaneId(null);
                    setIsExitConfirmOpen(false);
                  }}
                >
                  Keep Editing
                </button>
              </div>
            </section>
          </div>
        )}
      </>
    );
  }

  return (
    <main className="app-shell">
      <input
        ref={spreadsheetImportInputRef}
        className="file-input"
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
        onChange={handleSpreadsheetImportChange}
      />
      <input
        ref={projectImportInputRef}
        className="file-input"
        type="file"
        accept=".signal,application/vnd.signal.project+zip,application/zip,application/octet-stream"
        onChange={handleProjectImportChange}
      />

      {saveBannerKey > 0 && (
        <div key={saveBannerKey} className="save-banner" role="status" aria-live="polite">
          Saved
        </div>
      )}

      <div className={`app-content${isStartDialogOpen ? " is-blurred" : ""}`} aria-hidden={isStartDialogOpen ? "true" : undefined}>
        {!isWorkspaceActive && (
          <div className="workspace-home">
            <div className="workspace-radial">
              {isToolMenuOpen && (
                <div className="workspace-tool-menu" aria-label="Workspace tools">
                  <button
                    className="table-launcher workspace-tool-option"
                    type="button"
                    onClick={openTable}
                    aria-label="Open program table"
                    style={{ "--tool-angle": "-90deg", "--tool-counter-angle": "90deg" }}
                  >
                    <svg className="matrix-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                      {[1, 7, 13].flatMap((x) =>
                        [1, 7, 13].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="0.8" />),
                      )}
                    </svg>
                  </button>
                  <button
                    className="diagrams-launcher workspace-tool-option"
                    type="button"
                    onClick={openDiagrams}
                    aria-label="Open diagrams"
                    style={{ "--tool-angle": "90deg", "--tool-counter-angle": "-90deg" }}
                  >
                    {renderDiagramsIcon()}
                  </button>
                </div>
              )}
              <button
                className="workspace-add-button"
                type="button"
                onClick={toggleToolMenu}
                aria-label="Add interface"
                aria-expanded={isToolMenuOpen}
              >
                <svg className="plus-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                  <path d="M8 3h2v5h5v2h-5v5H8v-5H3V8h5z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {isWorkspaceActive && (
          <div className={`workspace-app-shell${sideToolMenu ? " is-side-menu-open" : ""}`}>
            {renderSideStrip("left")}
            <div
              ref={workspaceDisplayRef}
              className="workspace-display-space"
              style={{ "--workspace-grid-columns": workspaceGridColumns }}
            >
              {activeWorkspaceSlots.map((slot, index) => (
                <React.Fragment key={getWorkspacePaneId(slot, index)}>
                  {index > 0 && (
                    <div
                      className="workspace-pane-divider"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize panels"
                      onMouseDown={(event) => startPaneResize(event, index - 1)}
                    />
                  )}
                  <div className="workspace-display-pane">
                    {renderWorkspacePane(slot, index)}
                  </div>
                </React.Fragment>
              ))}
            </div>
            {renderSideStrip("right")}
            {isTableOpen && renderTableOverlays()}
          </div>
        )}

        {!isWorkspaceActive && renderProjectMenuButton()}

        {!isWorkspaceActive && isProjectMenuOpen && renderProjectActionsMenu()}

        {columnMenu && (
          <div
            className="column-context-menu"
            style={{ left: columnMenu.x, top: columnMenu.y }}
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={openAdvancedSortDialog}>
              Advanced Sorting
            </button>
          </div>
        )}

      </div>

      {isStartDialogOpen && (
        <div className="startup-layer" role="presentation">
          <section className="startup-dialog" role="dialog" aria-modal="true" aria-labelledby="startup-title">
            <h1 id="startup-title">SIGNAL</h1>
            <div className="startup-actions">
              <button className="primary-button" type="button" onClick={handleCreateNewProject} disabled={isLoading || isImporting}>
                Create New Project
              </button>
              <button className="secondary-button" type="button" onClick={handleLoadLastProject} disabled={isLoading || isImporting}>
                Load Last Project
              </button>
              <button className="secondary-button" type="button" onClick={openProjectImportPicker} disabled={isLoading || isImporting}>
                Import Project
              </button>
            </div>
            {(errorMessage || statusMessage) && <div className="startup-status" role="status">{errorMessage || statusMessage}</div>}
          </section>
        </div>
      )}
    </main>
  );
}

const PROGRAM_HIERARCHY_FILL_ALPHA = 0.4;
const PROGRAM_HIERARCHY_HOVER_FILL_ALPHA = 0.5;
const PROGRAM_HIERARCHY_ROW_FILL_ALPHA = 0.4;
const PROGRAM_HIERARCHY_BASE_COLORS = [
  { h: 14, s: 88, l: 62 },
  { h: 142, s: 61, l: 54 },
  { h: 207, s: 86, l: 60 },
  { h: 43, s: 92, l: 58 },
  { h: 257, s: 82, l: 73 },
  { h: 177, s: 66, l: 50 },
  { h: 343, s: 88, l: 69 },
  { h: 91, s: 69, l: 58 },
  { h: 29, s: 91, l: 61 },
  { h: 158, s: 66, l: 61 },
  { h: 333, s: 83, l: 66 },
  { h: 203, s: 88, l: 70 },
];

const STACKING_MIN_DIMENSION_FEET = 0.25;
const STACKING_MIN_ZOOM = 0.35;
const STACKING_MAX_ZOOM = 4;
const STACKING_ZOOM_FACTOR = 1.18;
const STACKING_FLOOR_EDGE_HIT_RADIUS = 8;
const STACKING_FLOOR_EDGE_SNAP_RADIUS = 9;
const STACKING_DIMENSION_EXTENSION_GAP = 7;
const STACKING_DIMENSION_EXTENSION_OVERHANG = 7;
const STACKING_DIMENSION_LABEL_WIDTH = 78;
const STACKING_DIMENSION_LABEL_HEIGHT = 22;
const STACKING_DIMENSION_LABEL_TEXT_PADDING = 5;
const STACKING_DIMENSION_LABEL_LINE_GAP = 4;
const STACKING_DIMENSION_LABEL_FONT = "700 10px Arial, sans-serif";
const BLOCKING_BASE_PIXELS_PER_FOOT = 12;
const BLOCKING_MIN_ZOOM = 0.25;
const BLOCKING_MAX_ZOOM = 5;
const BLOCKING_ZOOM_FACTOR = 1.16;
const BLOCKING_START_OFFSET = { x: 80, y: 60 };
const BLOCKING_MIN_SHAPE_FEET = 0.1;
const BLOCKING_CLOSE_POINT_RADIUS = 10;
const BLOCKING_SNAP_RADIUS = 10;
const BLOCKING_EDGE_HIT_RADIUS = 7;
const BLOCKING_VERTEX_EPSILON = 0.01;

function StackingDiagramCanvas({ diagram, onDiagramChange, onSegmentFloorChange }) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const lastCanvasPointRef = useRef(null);
  const isCanvasPointerInsideRef = useRef(false);
  const skipDimensionBlurCommitRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState({ zoom: 1, offset: { x: 0, y: 0 } });
  const [dimensionDrafts, setDimensionDrafts] = useState({});
  const [editingDimensionKey, setEditingDimensionKey] = useState(null);
  const [isPanToolActive, setIsPanToolActive] = useState(false);
  const [panDrag, setPanDrag] = useState(null);
  const [segmentDrag, setSegmentDrag] = useState(null);
  const [floorResize, setFloorResize] = useState(null);
  const [hoveredSegment, setHoveredSegment] = useState(null);
  const [hoveredFloorEdge, setHoveredFloorEdge] = useState(null);
  const hasDiagram = Boolean(diagram?.floors?.length);
  const layout = useMemo(
    () => getStackingDiagramLayout(diagram, canvasSize, view.zoom, view.offset),
    [diagram, canvasSize, view.zoom, view.offset],
  );
  const floorEdgeHitRegions = useMemo(
    () => getStackingFloorEdgeHitRegions(diagram, layout),
    [diagram, layout],
  );
  const segmentHitRegions = useMemo(
    () => getStackingSegmentHitRegions(diagram, layout),
    [diagram, layout],
  );
  const floorResizePreview = useMemo(
    () => getStackingFloorResizePreview(diagram, floorResize),
    [diagram, floorResize],
  );
  const dragPreview = useMemo(
    () => getStackingDragPreview(diagram, layout, segmentDrag),
    [diagram, layout, segmentDrag],
  );
  const displayedDiagram = floorResizePreview?.diagram ?? dragPreview?.diagram ?? diagram;
  const displayedLayout = useMemo(
    () => (floorResizePreview || dragPreview ? getStackingDiagramLayout(displayedDiagram, canvasSize, view.zoom, view.offset) : layout),
    [canvasSize, displayedDiagram, dragPreview, floorResizePreview, layout, view.offset, view.zoom],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;

    const updateSize = () => {
      const rect = frame.getBoundingClientRect();
      setCanvasSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    drawStackingDiagram(canvasRef.current, displayedDiagram, canvasSize, displayedLayout, { dragPreview, floorResizePreview });
  }, [displayedDiagram, canvasSize, displayedLayout, dragPreview, floorResizePreview]);

  useEffect(() => {
    setDimensionDrafts({});
    setEditingDimensionKey(null);
    setPanDrag(null);
    setSegmentDrag(null);
    setFloorResize(null);
    setHoveredSegment(null);
    setHoveredFloorEdge(null);
    setView({ zoom: 1, offset: { x: 0, y: 0 } });
  }, [diagram?.projectName, diagram?.floors?.length]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!hasDiagram || !isSpaceKey(event) || isEditableEventTarget(event.target)) return;
      if (!isCanvasPointerInsideRef.current && !frameRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      setIsPanToolActive(true);
    };

    const handleKeyUp = (event) => {
      if (!isSpaceKey(event)) return;
      if (isPanToolActive) event.preventDefault();
      setIsPanToolActive(false);
      setPanDrag(null);
    };

    const handleWindowBlur = () => {
      setIsPanToolActive(false);
      setPanDrag(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [hasDiagram, isPanToolActive]);

  const getCanvasPoint = (event) => {
    const frame = frameRef.current;
    if (!frame) return { x: canvasSize.width / 2, y: canvasSize.height / 2 };
    const rect = frame.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const getZoomAnchorPoint = (point) => point ?? lastCanvasPointRef.current ?? {
    x: canvasSize.width / 2,
    y: canvasSize.height / 2,
  };

  const updateZoom = (updater, anchorPoint) => {
    if (!hasDiagram) return;

    setView((currentView) => {
      const nextZoom = clamp(updater(currentView.zoom), STACKING_MIN_ZOOM, STACKING_MAX_ZOOM);
      if (nextZoom === currentView.zoom) return currentView;

      return {
        zoom: nextZoom,
        offset: getStackingZoomedViewOffset(
          diagram,
          canvasSize,
          currentView.zoom,
          nextZoom,
          currentView.offset,
          getZoomAnchorPoint(anchorPoint),
        ),
      };
    });
  };

  const handleWheel = (event) => {
    if (!hasDiagram || segmentDrag || floorResize) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
    lastCanvasPointRef.current = point;
    updateZoom((currentZoom) => currentZoom * (event.deltaY < 0 ? STACKING_ZOOM_FACTOR : 1 / STACKING_ZOOM_FACTOR), point);
  };

  const handlePointerEnter = (event) => {
    isCanvasPointerInsideRef.current = true;
    if (shouldTrackCanvasPoint(event.target)) lastCanvasPointRef.current = getCanvasPoint(event);
  };

  const handlePointerLeave = () => {
    setHoveredSegment(null);
    setHoveredFloorEdge(null);
    if (!panDrag && !segmentDrag && !floorResize) isCanvasPointerInsideRef.current = false;
  };

  const updatePointerInsideFromEvent = (event) => {
    const frame = frameRef.current;
    if (!frame) return;

    const rect = frame.getBoundingClientRect();
    isCanvasPointerInsideRef.current =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
  };

  const handlePointerMove = (event) => {
    updatePointerInsideFromEvent(event);
    const canTrackCanvasPoint = shouldTrackCanvasPoint(event.target);
    const trackedPoint = canTrackCanvasPoint ? getCanvasPoint(event) : null;
    if (trackedPoint) lastCanvasPointRef.current = trackedPoint;

    if (floorResize) {
      if (event.pointerId !== floorResize.pointerId) return;
      event.preventDefault();
      const point = getCanvasPoint(event);
      setFloorResize((currentResize) =>
        currentResize && currentResize.pointerId === event.pointerId
          ? {
              ...currentResize,
              currentPoint: point,
            }
          : currentResize,
      );
      return;
    }

    if (segmentDrag) {
      if (event.pointerId !== segmentDrag.pointerId) return;
      event.preventDefault();
      const point = getCanvasPoint(event);
      setSegmentDrag((currentDrag) =>
        currentDrag && currentDrag.pointerId === event.pointerId
          ? {
              ...currentDrag,
              currentPoint: point,
            }
          : currentDrag,
      );
      return;
    }

    if (panDrag) {
      if (event.pointerId !== panDrag.pointerId) return;
      event.preventDefault();

      const deltaX = event.clientX - panDrag.startClientX;
      const deltaY = event.clientY - panDrag.startClientY;
      setView((currentView) => ({
        ...currentView,
        offset: {
          x: panDrag.startOffset.x + deltaX,
          y: panDrag.startOffset.y + deltaY,
        },
      }));
      return;
    }

    if (!canTrackCanvasPoint || isPanToolActive) {
      setHoveredSegment(null);
      setHoveredFloorEdge(null);
      return;
    }

    const floorEdgeRegion = findStackingFloorEdgeHitRegion(floorEdgeHitRegions, trackedPoint);
    setHoveredFloorEdge(floorEdgeRegion ? { floorKey: floorEdgeRegion.floorKey, edge: floorEdgeRegion.edge } : null);
    if (floorEdgeRegion) {
      setHoveredSegment(null);
      return;
    }

    const hitRegion = findStackingSegmentHitRegion(segmentHitRegions, trackedPoint);
    setHoveredSegment(hitRegion ? { floorKey: hitRegion.floorKey, segmentIndex: hitRegion.segmentIndex } : null);
  };

  const handlePointerDown = (event) => {
    if (!hasDiagram || event.button !== 0 || !shouldTrackCanvasPoint(event.target)) return;

    const point = getCanvasPoint(event);
    lastCanvasPointRef.current = point;

    if (!isPanToolActive) {
      const floorEdgeRegion = findStackingFloorEdgeHitRegion(floorEdgeHitRegions, point);
      if (floorEdgeRegion) {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setHoveredFloorEdge(null);
        setHoveredSegment(null);
        setFloorResize(createStackingFloorResize(event.pointerId, floorEdgeRegion, point, layout, diagram));
        return;
      }

      const hitRegion = findStackingSegmentHitRegion(segmentHitRegions, point);
      if (!hitRegion) {
        setHoveredSegment(null);
        setHoveredFloorEdge(null);
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setHoveredFloorEdge(null);
      setHoveredSegment(null);
      setSegmentDrag(createStackingSegmentDrag(event.pointerId, hitRegion, point));
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanDrag({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffset: view.offset,
    });
  };

  const endFloorResize = (event) => {
    if (!floorResize || event.pointerId !== floorResize.pointerId) return false;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    updatePointerInsideFromEvent(event);

    const completedResize = {
      ...floorResize,
      currentPoint: getCanvasPoint(event),
    };
    const completedPreview = getStackingFloorResizePreview(diagram, completedResize);

    if (isStackingFloorResizeCommitChange(completedPreview, completedResize)) {
      onDiagramChange?.(completedPreview.diagram, {
        kind: "floor-resize",
        floorKey: completedResize.floorKey,
        edge: completedResize.edge,
        bounds: {
          left: completedPreview.left,
          width: completedPreview.width,
        },
        value: completedPreview.width,
      });
    }

    setFloorResize(null);
    setHoveredFloorEdge(null);
    setHoveredSegment(null);
    return true;
  };

  const endSegmentDrag = (event) => {
    if (!segmentDrag || event.pointerId !== segmentDrag.pointerId) return false;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    updatePointerInsideFromEvent(event);

    const completedDrag = {
      ...segmentDrag,
      currentPoint: getCanvasPoint(event),
    };
    const completedPreview = getStackingDragPreview(diagram, layout, completedDrag);

    if (isStackingDragCommitChange(completedPreview, completedDrag)) {
      onDiagramChange?.(completedPreview.diagram, {
        kind: "segment-drag",
        sourceFloorKey: completedDrag.sourceFloorKey,
        sourceSegmentIndex: completedDrag.sourceSegmentIndex,
        targetFloorKey: completedPreview.targetFloorKey,
        targetSegmentIndex: completedPreview.targetSegmentIndex,
      });
      if (completedPreview.targetFloorKey !== completedDrag.sourceFloorKey) {
        onSegmentFloorChange?.({
          segment: completedPreview.draggedSegment,
          sourceFloor: getStackingFloorByKey(diagram, completedDrag.sourceFloorKey),
          sourceFloorKey: completedDrag.sourceFloorKey,
          targetFloor: getStackingFloorByKey(diagram, completedPreview.targetFloorKey),
          targetFloorKey: completedPreview.targetFloorKey,
        });
      }
    }

    setSegmentDrag(null);
    setHoveredSegment(null);
    return true;
  };

  const endPanDrag = (event) => {
    if (!panDrag || event.pointerId !== panDrag.pointerId) return false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    updatePointerInsideFromEvent(event);
    setPanDrag(null);
    return true;
  };

  const endPointerDrag = (event) => {
    if (endFloorResize(event)) return;
    if (endSegmentDrag(event)) return;
    endPanDrag(event);
  };

  const cancelPointerDrag = (event) => {
    if (floorResize && event.pointerId === floorResize.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setFloorResize(null);
      setHoveredFloorEdge(null);
      setHoveredSegment(null);
      return;
    }

    if (segmentDrag && event.pointerId === segmentDrag.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setSegmentDrag(null);
      setHoveredSegment(null);
      setHoveredFloorEdge(null);
      return;
    }

    endPanDrag(event);
  };

  const handleLostPointerCapture = () => {
    setPanDrag(null);
    setSegmentDrag(null);
    setFloorResize(null);
    setHoveredSegment(null);
    setHoveredFloorEdge(null);
  };

  const clearDimensionDraft = (dimensionKey) => {
    setDimensionDrafts((drafts) => {
      if (!(dimensionKey in drafts)) return drafts;
      const { [dimensionKey]: _draft, ...remainingDrafts } = drafts;
      return remainingDrafts;
    });
  };

  const finishDimensionEdit = (dimensionKey) => {
    clearDimensionDraft(dimensionKey);
    setEditingDimensionKey((currentKey) => (currentKey === dimensionKey ? null : currentKey));
  };

  const commitDimensionEdit = (dimension, value) => {
    const parsedValue = parseDimensionInputValue(value);
    if (parsedValue != null && diagram) {
      onDiagramChange?.(updateStackingDiagramDimension(diagram, dimension, parsedValue), {
        dimension,
        value: parsedValue,
      });
    }
    finishDimensionEdit(dimension.key);
  };

  const handleDimensionChange = (dimension, value) => {
    setDimensionDrafts((drafts) => ({
      ...drafts,
      [dimension.key]: value,
    }));
  };

  const handleDimensionBlur = (event, dimension) => {
    if (skipDimensionBlurCommitRef.current === dimension.key) {
      skipDimensionBlurCommitRef.current = null;
      finishDimensionEdit(dimension.key);
      return;
    }

    commitDimensionEdit(dimension, event.currentTarget.value);
  };

  const beginDimensionEdit = (dimension) => {
    setEditingDimensionKey(dimension.key);
    setDimensionDrafts((drafts) => ({
      ...drafts,
      [dimension.key]: drafts[dimension.key] ?? formatDimensionInputValue(dimension.value),
    }));
  };

  const handleDimensionKeyDown = (event, dimension) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      skipDimensionBlurCommitRef.current = dimension.key;
      event.currentTarget.blur();
      finishDimensionEdit(dimension.key);
    }
  };

  return (
    <div
      ref={frameRef}
      className={`diagrams-canvas${isPanToolActive ? " is-pan-tool-active" : ""}${panDrag ? " is-panning" : ""}${hoveredFloorEdge ? " is-floor-edge-hovered" : ""}${floorResize ? " is-resizing-floor" : ""}${hoveredSegment ? " is-segment-hovered" : ""}${segmentDrag ? " is-dragging-segment" : ""}`}
      aria-label="Diagram canvas"
      onWheel={handleWheel}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={endPointerDrag}
      onPointerCancel={cancelPointerDrag}
      onLostPointerCapture={handleLostPointerCapture}
    >
      <canvas ref={canvasRef} className="diagrams-canvas-surface" />
      {hasDiagram && (
        <div className="diagrams-canvas-toolbar" aria-label="Canvas zoom controls">
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => updateZoom((currentZoom) => currentZoom / STACKING_ZOOM_FACTOR)}>
            -
          </button>
          <output aria-label="Canvas zoom">{Math.round(view.zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => updateZoom((currentZoom) => currentZoom * STACKING_ZOOM_FACTOR)}>
            +
          </button>
          <button type="button" aria-label="Fit diagram" title="Fit diagram" onClick={() => setView({ zoom: 1, offset: { x: 0, y: 0 } })}>
            Fit
          </button>
        </div>
      )}
      {hasDiagram && (
        <div className="diagrams-canvas-overlay" aria-label="Editable diagram dimensions">
          {displayedLayout.dimensionInputs.map((dimension) => {
            const formattedValue = formatDimensionInputValue(dimension.value);
            const isEditing = editingDimensionKey === dimension.key;
            const displayValue = dimensionDrafts[dimension.key] ?? formattedValue;

            return (
              <div
                key={dimension.key}
                className={`stacking-dimension-field is-${dimension.orientation} is-${dimension.kind}${isEditing ? " is-editing" : ""}`}
                style={{
                  left: `${dimension.left}px`,
                  top: `${dimension.top}px`,
                  "--dimension-field-width": isEditing ? getDimensionEditorWidth(displayValue) : `${STACKING_DIMENSION_LABEL_WIDTH}px`,
                }}
              >
                {isEditing ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={displayValue}
                    aria-label={dimension.ariaLabel}
                    onChange={(event) => handleDimensionChange(dimension, event.target.value)}
                    onBlur={(event) => handleDimensionBlur(event, dimension)}
                    onFocus={(event) => event.target.select()}
                    onKeyDown={(event) => handleDimensionKeyDown(event, dimension)}
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
                    className="stacking-dimension-value"
                    aria-label={`${dimension.ariaLabel}: ${formattedValue}`}
                    onClick={() => beginDimensionEdit(dimension)}
                  >
                    {formattedValue}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BlockingDiagramCanvas({
  activeFloor,
  activeTool,
  blockingSettings,
  floorBelowOutline = null,
  floorSettings,
  geometryConflicts = [],
  isKeyboardActive = true,
  levelOfDetail,
  onActiveToolChange,
  onFloorSettingsChange,
  onSelectionChange,
  programmingAttribute,
}) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const lastCanvasPointRef = useRef(null);
  const isCanvasPointerInsideRef = useRef(false);
  const skipDimensionBlurCommitRef = useRef(null);
  const lastSelectionSignatureRef = useRef("");
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState({ zoom: 1, offset: BLOCKING_START_OFFSET });
  const [isSpacePanActive, setIsSpacePanActive] = useState(false);
  const [panDrag, setPanDrag] = useState(null);
  const [rectangleDraft, setRectangleDraft] = useState(null);
  const [polylineDraft, setPolylineDraft] = useState(null);
  const [selectionDrag, setSelectionDrag] = useState(null);
  const [selectedShapeIds, setSelectedShapeIds] = useState([]);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [shapeMove, setShapeMove] = useState(null);
  const [shapeResize, setShapeResize] = useState(null);
  const [dimensionDrafts, setDimensionDrafts] = useState({});
  const [editingDimensionKey, setEditingDimensionKey] = useState(null);
  const [geometryConflictMenuId, setGeometryConflictMenuId] = useState(null);
  const [ignoredGeometryConflictIds, setIgnoredGeometryConflictIds] = useState(new Set());
  const normalizedBlockingSettings = normalizeBlockingSettings(blockingSettings);
  const normalizedFloorSettings = normalizeBlockingFloorSettings(floorSettings);
  const activeProgrammingAttribute = normalizeBlockingProgrammingAttribute(programmingAttribute);
  const hasActiveProgrammingAttribute = Boolean(activeProgrammingAttribute);
  const shapes = floorSettings?.shapes ?? [];
  const editableShapes = getBlockingShapesForLevel(shapes, levelOfDetail);
  const previewShapes = getBlockingParentPreviewShapesForLevel(shapes, levelOfDetail);
  const snapShapes = [...previewShapes, ...editableShapes];
  const displayedShapes = getBlockingDisplayedShapes(editableShapes, shapeMove, shapeResize);
  const selectedShapeIdSet = new Set(selectedShapeIds);
  const selectedShapes = displayedShapes.filter((shape) => selectedShapeIdSet.has(shape.id));
  const selectionFrame = getBlockingSelectionFrame(selectedShapes);
  const selectionDimensionFields = getBlockingSelectionDimensionFields(selectionFrame, view);
  const geometryConflictAnchors = getBlockingGeometryConflictAnchors(
    geometryConflicts,
    shapes,
    levelOfDetail,
    view,
    canvasSize,
  );
  const edgeCursor = hoveredEdge ? getBlockingEdgeCursor(hoveredEdge) : "";
  const isPanMode = activeTool === BLOCKING_TOOL_PAN || isSpacePanActive;

  const toggleGeometryConflictIgnored = (conflictId) => {
    setIgnoredGeometryConflictIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(conflictId)) {
        nextIds.delete(conflictId);
      } else {
        nextIds.add(conflictId);
      }
      return nextIds;
    });
  };

  const applyGeometryConflictResolution = (conflict, mode) => {
    if (!conflict?.shapeId) return;

    const parentShape = shapes.find((shape) => shape.id === conflict.shapeId);
    if (!parentShape) return;

    const childShapeIds = mode === "recalculate"
      ? conflict.allChildShapeIds ?? []
      : (conflict.childConflicts ?? []).map((childConflict) => childConflict.childShapeId);
    const childShapeIdSet = new Set(childShapeIds);
    const childShapes = shapes.filter((shape) => childShapeIdSet.has(shape.id));
    const fitShapes = mode === "recalculate" ? childShapes : [parentShape, ...childShapes];
    const nextShape = createBlockingMergedPolylineShape(parentShape, fitShapes);
    if (!nextShape || areBlockingShapesEqual(nextShape, parentShape)) {
      setGeometryConflictMenuId(null);
      return;
    }

    onFloorSettingsChange?.((settings) => ({
      ...settings,
      shapes: (settings.shapes ?? []).map((shape) =>
        shape.id === parentShape.id ? nextShape : shape,
      ),
    }), { pushHistory: true });
    setIgnoredGeometryConflictIds((currentIds) => {
      if (!currentIds.has(conflict.id)) return currentIds;
      const nextIds = new Set(currentIds);
      nextIds.delete(conflict.id);
      return nextIds;
    });
    setGeometryConflictMenuId(null);
  };

  const getSelectionSignature = (selectedShapesForReport) => [
    activeFloor?.key ?? "",
    levelOfDetail ?? "",
    ...selectedShapesForReport.map((shape) => {
      const shapeProgrammingAttribute = normalizeBlockingProgrammingAttribute(shape.programmingAttribute);
      return [
        shape.id,
        getBlockingShapeLevelOfDetail(shape),
        shapeProgrammingAttribute?.key ?? "",
        shapeProgrammingAttribute?.level ?? "",
      ].join(":");
    }),
  ].join("|");

  const getSelectedShapesForReport = (shapeIds, sourceShapes = editableShapes) => {
    const selectedShapeIdSetForReport = new Set(shapeIds);
    return sourceShapes.filter((shape) => selectedShapeIdSetForReport.has(shape.id));
  };

  const reportSelectionForIds = (shapeIds, sourceShapes = editableShapes) => {
    const selectedShapesForReport = getSelectedShapesForReport(shapeIds, sourceShapes);
    lastSelectionSignatureRef.current = getSelectionSignature(selectedShapesForReport);
    onSelectionChange?.(selectedShapesForReport);
  };

  useEffect(() => {
    const selectedShapesForReport = getSelectedShapesForReport(selectedShapeIds);
    const selectionSignature = getSelectionSignature(selectedShapesForReport);

    if (selectionSignature === lastSelectionSignatureRef.current) return;
    lastSelectionSignatureRef.current = selectionSignature;
    onSelectionChange?.(selectedShapesForReport);
  }, [activeFloor?.key, levelOfDetail, onSelectionChange, selectedShapeIds, shapes]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;

    const updateSize = () => {
      const rect = frame.getBoundingClientRect();
      setCanvasSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    drawBlockingDiagram(canvasRef.current, {
      activeFloor,
      activeTool,
      blockingSettings: normalizedBlockingSettings,
      canvasSize,
      floorBelowOutline,
      floorSettings: normalizedFloorSettings,
      hoveredEdge,
      levelOfDetail,
      polylineDraft,
      rectangleDraft,
      selectionDrag,
      selectedShapeIds,
      shapeMove,
      shapeResize,
      view,
    });
  }, [
    activeFloor,
    activeTool,
    normalizedBlockingSettings,
    canvasSize,
    floorBelowOutline,
    normalizedFloorSettings,
    hoveredEdge,
    levelOfDetail,
    polylineDraft,
    rectangleDraft,
    selectionDrag,
    selectedShapeIds,
    shapeMove,
    shapeResize,
    view,
  ]);

  useEffect(() => {
    setPanDrag(null);
    setRectangleDraft(null);
    setPolylineDraft(null);
    setSelectionDrag(null);
    setSelectedShapeIds([]);
    setHoveredEdge(null);
    setShapeMove(null);
    setShapeResize(null);
    setDimensionDrafts({});
    setEditingDimensionKey(null);
    setGeometryConflictMenuId(null);
    setView({ zoom: 1, offset: BLOCKING_START_OFFSET });
  }, [activeFloor?.key, levelOfDetail]);

  useEffect(() => {
    const shapeIds = new Set(editableShapes.map((shape) => shape.id));
    setSelectedShapeIds((currentIds) => {
      const nextIds = currentIds.filter((shapeId) => shapeIds.has(shapeId));
      return nextIds.length === currentIds.length ? currentIds : nextIds;
    });
  }, [activeFloor?.key, editableShapes, levelOfDetail]);

  useEffect(() => {
    if (!geometryConflictMenuId) return;
    if (geometryConflictAnchors.some((conflict) => conflict.id === geometryConflictMenuId && !conflict.isPreview)) return;
    setGeometryConflictMenuId(null);
  }, [geometryConflictAnchors, geometryConflictMenuId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || !isKeyboardActive || isEditableEventTarget(event.target)) return;

      if (isSpaceKey(event)) {
        if (!isCanvasPointerInsideRef.current && !frameRef.current?.contains(document.activeElement)) return;
        event.preventDefault();
        setIsSpacePanActive(true);
        return;
      }

      const key = event.key.toLowerCase();

      if ((event.key === "Delete" || event.key === "Backspace") && selectedShapeIds.length > 0) {
        event.preventDefault();
        const selectedShapeIdSetForDelete = new Set(selectedShapeIds);

        if (!editableShapes.some((shape) => selectedShapeIdSetForDelete.has(shape.id))) {
          setSelectedShapeIds([]);
          setHoveredEdge(null);
          return;
        }

        onFloorSettingsChange?.((settings) => ({
          ...settings,
          shapes: (settings.shapes ?? []).filter((shape) => !selectedShapeIdSetForDelete.has(shape.id)),
        }), { pushHistory: true });
        setSelectedShapeIds([]);
        setHoveredEdge(null);
        setShapeMove(null);
        setShapeResize(null);
        return;
      }

      if (key === "r") {
        event.preventDefault();
        onActiveToolChange?.(BLOCKING_TOOL_RECTANGLE);
        return;
      }

      if (key === "t") {
        event.preventDefault();
        onActiveToolChange?.(BLOCKING_TOOL_POLYLINE);
        return;
      }

      if (event.key !== "Escape") return;
      event.preventDefault();

      if (geometryConflictMenuId) {
        setGeometryConflictMenuId(null);
        return;
      }

      if (rectangleDraft) {
        setRectangleDraft(null);
        return;
      }

      if (polylineDraft) {
        setPolylineDraft(null);
        return;
      }

      if (shapeMove) {
        setShapeMove(null);
        return;
      }

      if (shapeResize) {
        setShapeResize(null);
        return;
      }

      if (selectionDrag) {
        setSelectionDrag(null);
        return;
      }

      if (hasActiveProgrammingAttribute) {
        onActiveToolChange?.(BLOCKING_TOOL_SELECT);
        return;
      }

      if (selectedShapeIds.length > 0) {
        setSelectedShapeIds([]);
        setHoveredEdge(null);
        return;
      }

      if (activeTool !== BLOCKING_TOOL_SELECT) {
        onActiveToolChange?.(BLOCKING_TOOL_SELECT);
      }
    };

    const handleKeyUp = (event) => {
      if (!isSpaceKey(event)) return;
      if (isSpacePanActive) event.preventDefault();
      setIsSpacePanActive(false);
      setPanDrag((currentDrag) => (currentDrag?.temporary ? null : currentDrag));
    };

    const handleWindowBlur = () => {
      setIsSpacePanActive(false);
      setPanDrag(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    activeTool,
    editableShapes,
    geometryConflictMenuId,
    hasActiveProgrammingAttribute,
    isKeyboardActive,
    isSpacePanActive,
    onActiveToolChange,
    onFloorSettingsChange,
    polylineDraft,
    rectangleDraft,
    selectedShapeIds,
    selectionDrag,
    shapeMove,
    shapeResize,
    shapes,
  ]);

  const getCanvasPoint = (event) => {
    const frame = frameRef.current;
    if (!frame) return { x: canvasSize.width / 2, y: canvasSize.height / 2 };
    const rect = frame.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const getRawModelPoint = (event) => blockingScreenToModel(getCanvasPoint(event), view);
  const getSnappedModelPoint = (event, options = {}) =>
    getBlockingSnappedPoint(getRawModelPoint(event), {
      blockingSettings: normalizedBlockingSettings,
      shapes: snapShapes,
      view,
      ...options,
    });

  const updatePointerInsideFromEvent = (event) => {
    const frame = frameRef.current;
    if (!frame) return;

    const rect = frame.getBoundingClientRect();
    isCanvasPointerInsideRef.current =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
  };

  const updateZoom = (updater, anchorPoint) => {
    setView((currentView) => {
      const nextZoom = clamp(updater(currentView.zoom), BLOCKING_MIN_ZOOM, BLOCKING_MAX_ZOOM);
      if (nextZoom === currentView.zoom) return currentView;

      const anchor = anchorPoint ?? lastCanvasPointRef.current ?? {
        x: canvasSize.width / 2,
        y: canvasSize.height / 2,
      };

      return {
        zoom: nextZoom,
        offset: getBlockingZoomedViewOffset(currentView, nextZoom, anchor),
      };
    });
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const point = getCanvasPoint(event);
    lastCanvasPointRef.current = point;
    updateZoom((currentZoom) => currentZoom * (event.deltaY < 0 ? BLOCKING_ZOOM_FACTOR : 1 / BLOCKING_ZOOM_FACTOR), point);
  };

  const handlePointerEnter = (event) => {
    isCanvasPointerInsideRef.current = true;
    if (shouldTrackBlockingCanvasPoint(event.target)) lastCanvasPointRef.current = getCanvasPoint(event);
  };

  const handlePointerLeave = () => {
    if (!panDrag && !rectangleDraft && !selectionDrag && !shapeMove && !shapeResize) isCanvasPointerInsideRef.current = false;
    if (!shapeResize) setHoveredEdge(null);
  };

  const handlePointerMove = (event) => {
    updatePointerInsideFromEvent(event);
    if (shouldTrackBlockingCanvasPoint(event.target)) {
      lastCanvasPointRef.current = getCanvasPoint(event);
    }

    if (panDrag) {
      if (event.pointerId !== panDrag.pointerId) return;
      event.preventDefault();
      setView((currentView) => ({
        ...currentView,
        offset: {
          x: panDrag.startOffset.x + event.clientX - panDrag.startClientX,
          y: panDrag.startOffset.y + event.clientY - panDrag.startClientY,
        },
      }));
      return;
    }

    if (rectangleDraft) {
      if (event.pointerId !== rectangleDraft.pointerId) return;
      event.preventDefault();
      const snappedPoint = getSnappedModelPoint(event);
      setRectangleDraft((currentDraft) =>
        currentDraft && currentDraft.pointerId === event.pointerId
          ? {
              ...currentDraft,
              currentPoint: snappedPoint,
            }
          : currentDraft,
      );
      return;
    }

    if (shapeMove) {
      if (event.pointerId !== shapeMove.pointerId) return;
      event.preventDefault();
      const rawPoint = getRawModelPoint(event);
      const rawDelta = {
        x: rawPoint.x - shapeMove.startPoint.x,
        y: rawPoint.y - shapeMove.startPoint.y,
      };
      const currentDelta = getBlockingSnappedMoveDelta(shapeMove.startShapes, rawDelta, {
        blockingSettings: normalizedBlockingSettings,
        excludeShapeIds: new Set(shapeMove.shapeIds),
        shapes: snapShapes,
        view,
      });
      setShapeMove((currentMove) =>
        currentMove && currentMove.pointerId === event.pointerId
          ? {
              ...currentMove,
              currentDelta,
            }
          : currentMove,
      );
      return;
    }

    if (selectionDrag) {
      if (event.pointerId !== selectionDrag.pointerId) return;
      event.preventDefault();
      const currentPoint = getRawModelPoint(event);
      setSelectionDrag((currentDrag) =>
        currentDrag && currentDrag.pointerId === event.pointerId
          ? {
              ...currentDrag,
              currentPoint,
            }
          : currentDrag,
      );
      return;
    }

    if (shapeResize) {
      if (event.pointerId !== shapeResize.pointerId) return;
      event.preventDefault();
      const currentShape = getBlockingResizePreview(shapeResize, getRawModelPoint(event), {
        blockingSettings: normalizedBlockingSettings,
        shapes: snapShapes,
        view,
      });
      setShapeResize((currentResize) =>
        currentResize && currentResize.pointerId === event.pointerId
          ? {
              ...currentResize,
              currentShape,
            }
          : currentResize,
      );
      return;
    }

    if (polylineDraft && activeTool === BLOCKING_TOOL_POLYLINE && shouldTrackBlockingCanvasPoint(event.target)) {
      const snappedPoint = getSnappedModelPoint(event);
      setPolylineDraft((currentDraft) => currentDraft
        ? {
            ...currentDraft,
            previewPoint: snappedPoint,
          }
        : currentDraft);
      return;
    }

    if (activeTool === BLOCKING_TOOL_SELECT && shouldTrackBlockingCanvasPoint(event.target)) {
      setHoveredEdge(findBlockingEdgeAtPoint(editableShapes, getRawModelPoint(event), view));
    } else {
      setHoveredEdge(null);
    }
  };

  const beginPanDrag = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanDrag({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffset: view.offset,
      temporary: isSpacePanActive && activeTool !== BLOCKING_TOOL_PAN,
    });
  };

  const beginRectangleDraft = (event) => {
    const point = getSnappedModelPoint(event);
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSelectedShapeIds([]);
    setHoveredEdge(null);
    setRectangleDraft({
      currentPoint: point,
      pointerId: event.pointerId,
      startPoint: point,
    });
  };

  const handlePolylineClick = (event) => {
    const rawPoint = getRawModelPoint(event);
    const modelPoint = getSnappedModelPoint(event);
    event.preventDefault();

    if (!polylineDraft) {
      setSelectedShapeIds([]);
      setHoveredEdge(null);
      setPolylineDraft({
        points: [modelPoint],
        previewPoint: modelPoint,
      });
      return;
    }

    const startPoint = polylineDraft.points[0];
    const isStartClick = startPoint
      ? areBlockingPointsNearScreen(startPoint, rawPoint, view, BLOCKING_CLOSE_POINT_RADIUS)
      : false;

    if (isStartClick) {
      const uniqueVertexCount = getUniqueBlockingPointCount(polylineDraft.points);
      if (uniqueVertexCount >= 3) {
        const shape = createBlockingPolylineShape(polylineDraft.points, levelOfDetail);
        if (shape) {
          onFloorSettingsChange?.((settings) => ({
            ...settings,
            shapes: [...(settings.shapes ?? []), shape],
          }), { pushHistory: true });
          setSelectedShapeIds([shape.id]);
        }
        setPolylineDraft(null);
        return;
      }

      if (polylineDraft.points.length <= 1) {
        setPolylineDraft(null);
      }
      return;
    }

    const lastPoint = polylineDraft.points[polylineDraft.points.length - 1];
    if (lastPoint && areBlockingPointsNearScreen(lastPoint, modelPoint, view, 4)) return;

    setPolylineDraft((currentDraft) =>
      currentDraft
        ? {
            ...currentDraft,
            points: [...currentDraft.points, modelPoint],
            previewPoint: modelPoint,
          }
        : currentDraft,
    );
  };

  const beginSelectAction = (event) => {
    const modelPoint = getRawModelPoint(event);
    const edgeHit = findBlockingEdgeAtPoint(editableShapes, modelPoint, view);
    const hitShape = edgeHit
      ? editableShapes.find((shape) => shape.id === edgeHit.shapeId)
      : findBlockingShapeAtPoint(editableShapes, modelPoint, view);

    if (!hitShape) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setHoveredEdge(null);
      setSelectionDrag({
        currentPoint: modelPoint,
        isAdditive: event.shiftKey,
        isSubtractive: event.ctrlKey || event.metaKey,
        pointerId: event.pointerId,
        startPoint: modelPoint,
      });
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const nextSelectedShapeIds = selectedShapeIds.filter((shapeId) => shapeId !== hitShape.id);
      setSelectedShapeIds(nextSelectedShapeIds);
      reportSelectionForIds(nextSelectedShapeIds);
      setHoveredEdge(null);
      return;
    }

    if (event.shiftKey) {
      event.preventDefault();
      const nextSelectedShapeIds = selectedShapeIds.includes(hitShape.id)
        ? selectedShapeIds
        : [...selectedShapeIds, hitShape.id];
      setSelectedShapeIds(nextSelectedShapeIds);
      reportSelectionForIds(nextSelectedShapeIds);
      setHoveredEdge(null);
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (edgeHit) {
      setSelectedShapeIds([hitShape.id]);
      reportSelectionForIds([hitShape.id]);
      setHoveredEdge(edgeHit);
      setShapeResize({
        currentShape: hitShape,
        edge: edgeHit,
        originalShape: hitShape,
        pointerId: event.pointerId,
        shapeId: hitShape.id,
        startPoint: modelPoint,
      });
      return;
    }

    const nextSelectedShapeIds = selectedShapeIds.includes(hitShape.id)
      ? selectedShapeIds
      : [hitShape.id];
    const nextSelectedShapeIdSet = new Set(nextSelectedShapeIds);
    const startShapes = editableShapes.filter((shape) => nextSelectedShapeIdSet.has(shape.id));
    setSelectedShapeIds(nextSelectedShapeIds);
    reportSelectionForIds(nextSelectedShapeIds);
    setHoveredEdge(null);
    setShapeMove({
      currentDelta: { x: 0, y: 0 },
      pointerId: event.pointerId,
      shapeIds: nextSelectedShapeIds,
      startShapes,
      startPoint: modelPoint,
    });
  };

  const beginProgrammingAssignment = (event) => {
    if (!activeProgrammingAttribute) return false;

    const modelPoint = getRawModelPoint(event);
    const hitShape = findBlockingShapeAtPoint(editableShapes, modelPoint, view);
    if (!hitShape) return false;

    event.preventDefault();
    setSelectedShapeIds([hitShape.id]);
    setHoveredEdge(null);

    if (areBlockingProgrammingAttributesEqual(hitShape.programmingAttribute, activeProgrammingAttribute)) {
      reportSelectionForIds([hitShape.id]);
      return true;
    }

    onFloorSettingsChange?.((settings) => ({
      ...settings,
      shapes: (settings.shapes ?? []).map((shape) =>
        shape.id === hitShape.id
          ? {
              ...shape,
              levelOfDetail: activeProgrammingAttribute.level,
              programmingAttribute: activeProgrammingAttribute,
            }
          : shape,
      ),
    }), { pushHistory: true });
    reportSelectionForIds(
      [hitShape.id],
      shapes.map((shape) =>
        shape.id === hitShape.id
          ? {
              ...shape,
              levelOfDetail: activeProgrammingAttribute.level,
              programmingAttribute: activeProgrammingAttribute,
            }
          : shape,
      ),
    );

    return true;
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0 || !shouldTrackBlockingCanvasPoint(event.target)) return;
    frameRef.current?.focus();
    lastCanvasPointRef.current = getCanvasPoint(event);
    setGeometryConflictMenuId(null);

    if (isPanMode) {
      beginPanDrag(event);
      return;
    }

    if (beginProgrammingAssignment(event)) {
      return;
    }

    if (activeTool === BLOCKING_TOOL_RECTANGLE) {
      beginRectangleDraft(event);
      return;
    }

    if (activeTool === BLOCKING_TOOL_POLYLINE) {
      handlePolylineClick(event);
      return;
    }

    beginSelectAction(event);
  };

  const endPanDrag = (event) => {
    if (!panDrag || event.pointerId !== panDrag.pointerId) return false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    updatePointerInsideFromEvent(event);
    setPanDrag(null);
    return true;
  };

  const endRectangleDraft = (event) => {
    if (!rectangleDraft || event.pointerId !== rectangleDraft.pointerId) return false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    updatePointerInsideFromEvent(event);

    const rect = normalizeBlockingRectangleFromPoints(rectangleDraft.startPoint, getSnappedModelPoint(event));
    if (rect.width >= BLOCKING_MIN_SHAPE_FEET && rect.height >= BLOCKING_MIN_SHAPE_FEET) {
      const shape = {
        id: createBlockingShapeId("rectangle"),
        type: "rectangle",
        levelOfDetail: getBlockingLevelOfDetailValue(levelOfDetail),
        ...rect,
      };
      onFloorSettingsChange?.((settings) => ({
        ...settings,
        shapes: [...(settings.shapes ?? []), shape],
      }), { pushHistory: true });
      setSelectedShapeIds([shape.id]);
    }

    setRectangleDraft(null);
    return true;
  };

  const endShapeMove = (event) => {
    if (!shapeMove || event.pointerId !== shapeMove.pointerId) return false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    updatePointerInsideFromEvent(event);

    const rawPoint = getRawModelPoint(event);
    const rawDelta = {
      x: rawPoint.x - shapeMove.startPoint.x,
      y: rawPoint.y - shapeMove.startPoint.y,
    };
    const delta = getBlockingSnappedMoveDelta(shapeMove.startShapes, rawDelta, {
      blockingSettings: normalizedBlockingSettings,
      excludeShapeIds: new Set(shapeMove.shapeIds),
      shapes: snapShapes,
      view,
    });

    if (Math.abs(delta.x) > BLOCKING_VERTEX_EPSILON || Math.abs(delta.y) > BLOCKING_VERTEX_EPSILON) {
      onFloorSettingsChange?.((settings) => ({
        ...settings,
        shapes: (settings.shapes ?? []).map((shape) =>
          shapeMove.shapeIds.includes(shape.id) ? moveBlockingShape(shape, delta) : shape,
        ),
      }), { pushHistory: true });
    }

    setShapeMove(null);
    return true;
  };

  const endShapeResize = (event) => {
    if (!shapeResize || event.pointerId !== shapeResize.pointerId) return false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    updatePointerInsideFromEvent(event);

    const currentShape = getBlockingResizePreview(shapeResize, getRawModelPoint(event), {
      blockingSettings: normalizedBlockingSettings,
      shapes: snapShapes,
      view,
    });
    if (currentShape && !areBlockingShapesEqual(currentShape, shapeResize.originalShape)) {
      onFloorSettingsChange?.((settings) => ({
        ...settings,
        shapes: (settings.shapes ?? []).map((shape) =>
          shape.id === shapeResize.shapeId ? currentShape : shape,
        ),
      }), { pushHistory: true });
    }

    setShapeResize(null);
    return true;
  };

  const endSelectionDrag = (event) => {
    if (!selectionDrag || event.pointerId !== selectionDrag.pointerId) return false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    updatePointerInsideFromEvent(event);

    const completedDrag = {
      ...selectionDrag,
      currentPoint: getRawModelPoint(event),
    };

    const distance = Math.hypot(
      completedDrag.currentPoint.x - completedDrag.startPoint.x,
      completedDrag.currentPoint.y - completedDrag.startPoint.y,
    );

    if (distance < 3 / getBlockingScale(view)) {
      if (!completedDrag.isAdditive && !completedDrag.isSubtractive) setSelectedShapeIds([]);
      setSelectionDrag(null);
      return true;
    }

    const selectionIds = getBlockingShapeIdsInSelection(editableShapes, completedDrag);
    setSelectedShapeIds((currentIds) => {
      if (completedDrag.isSubtractive) {
        const selectionIdSet = new Set(selectionIds);
        return currentIds.filter((shapeId) => !selectionIdSet.has(shapeId));
      }

      if (completedDrag.isAdditive) {
        return [...new Set([...currentIds, ...selectionIds])];
      }

      return selectionIds;
    });
    setSelectionDrag(null);
    return true;
  };

  const handlePointerUp = (event) => {
    if (endPanDrag(event)) return;
    if (endRectangleDraft(event)) return;
    if (endSelectionDrag(event)) return;
    if (endShapeResize(event)) return;
    endShapeMove(event);
  };

  const handlePointerCancel = (event) => {
    if (panDrag && event.pointerId === panDrag.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setPanDrag(null);
    }

    if (rectangleDraft && event.pointerId === rectangleDraft.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setRectangleDraft(null);
    }

    if (selectionDrag && event.pointerId === selectionDrag.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setSelectionDrag(null);
    }

    if (shapeMove && event.pointerId === shapeMove.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setShapeMove(null);
    }

    if (shapeResize && event.pointerId === shapeResize.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setShapeResize(null);
    }
  };

  const handleLostPointerCapture = () => {
    setPanDrag(null);
    setRectangleDraft(null);
    setSelectionDrag(null);
    setShapeMove(null);
    setShapeResize(null);
  };

  const clearDimensionDraft = (dimensionKey) => {
    setDimensionDrafts((drafts) => {
      if (!(dimensionKey in drafts)) return drafts;
      const { [dimensionKey]: _draft, ...remainingDrafts } = drafts;
      return remainingDrafts;
    });
  };

  const finishDimensionEdit = (dimensionKey) => {
    clearDimensionDraft(dimensionKey);
    setEditingDimensionKey((currentKey) => (currentKey === dimensionKey ? null : currentKey));
  };

  const beginDimensionEdit = (dimension) => {
    setEditingDimensionKey(dimension.key);
    setDimensionDrafts((drafts) => ({
      ...drafts,
      [dimension.key]: drafts[dimension.key] ?? formatDimensionInputValue(dimension.value),
    }));
  };

  const handleDimensionChange = (dimension, value) => {
    setDimensionDrafts((drafts) => ({
      ...drafts,
      [dimension.key]: value,
    }));
  };

  const commitDimensionEdit = (dimension, value) => {
    const parsedValue = parseDimensionInputValue(value);
    if (parsedValue != null && parsedValue >= BLOCKING_MIN_SHAPE_FEET && selectionFrame) {
      onFloorSettingsChange?.((settings) => ({
        ...settings,
        shapes: resizeBlockingShapesToSelectionDimension(
          settings.shapes ?? [],
          new Set(selectedShapeIds),
          selectionFrame,
          dimension.kind,
          parsedValue,
        ),
      }), { pushHistory: true });
    }
    finishDimensionEdit(dimension.key);
  };

  const handleDimensionBlur = (event, dimension) => {
    if (skipDimensionBlurCommitRef.current === dimension.key) {
      skipDimensionBlurCommitRef.current = null;
      finishDimensionEdit(dimension.key);
      return;
    }

    commitDimensionEdit(dimension, event.currentTarget.value);
  };

  const handleDimensionKeyDown = (event, dimension) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      skipDimensionBlurCommitRef.current = dimension.key;
      event.currentTarget.blur();
      finishDimensionEdit(dimension.key);
    }
  };

  return (
    <div
      ref={frameRef}
      className={[
        "diagrams-canvas",
        "blocking-canvas",
        `is-blocking-tool-${activeTool}`,
        isPanMode ? "is-pan-tool-active" : "",
        panDrag ? "is-panning" : "",
        rectangleDraft ? "is-drawing-rectangle" : "",
        polylineDraft ? "is-drawing-polyline" : "",
        shapeMove ? "is-moving-shape" : "",
        shapeResize ? "is-resizing-shape" : "",
      ].filter(Boolean).join(" ")}
      style={edgeCursor ? { cursor: edgeCursor } : undefined}
      tabIndex={0}
      aria-label={`${activeFloor?.label ?? "Floor"} blocking canvas`}
      onWheel={handleWheel}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    >
      <canvas ref={canvasRef} className="diagrams-canvas-surface" />
      {geometryConflictAnchors.length > 0 && (
        <div className="blocking-geometry-conflict-overlay">
          {geometryConflictAnchors.map((conflict) => {
            const isConflictMenuOpen = geometryConflictMenuId === conflict.id && !conflict.isPreview;
            const isIgnored = ignoredGeometryConflictIds.has(conflict.id);
            const explanation = getBlockingGeometryConflictExplanation(conflict);

            return (
              <div
                className={[
                  "blocking-geometry-conflict-control",
                  conflict.isPreview ? "is-preview" : "",
                  isIgnored ? "is-ignored" : "",
                  conflict.menuPlacementX === "left" ? "is-menu-left" : "is-menu-right",
                  conflict.menuPlacementY === "up" ? "is-menu-up" : "is-menu-down",
                ].filter(Boolean).join(" ")}
                key={conflict.id}
                style={{
                  left: `${conflict.left}px`,
                  top: `${conflict.top}px`,
                  "--blocking-conflict-menu-max-height": `${conflict.menuMaxHeight}px`,
                  "--blocking-conflict-menu-width": `${conflict.menuWidth}px`,
                }}
                title={conflict.isPreview ? explanation : undefined}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  className={[
                    "stacking-conflict-button",
                    "blocking-geometry-conflict-button",
                    isIgnored ? "is-ignored" : "",
                  ].filter(Boolean).join(" ")}
                  type="button"
                  aria-label={conflict.isPreview ? "Geometry conflict preview" : "Show geometry conflict"}
                  aria-expanded={conflict.isPreview ? undefined : isConflictMenuOpen}
                  disabled={conflict.isPreview}
                  onClick={() =>
                    setGeometryConflictMenuId((currentConflictId) =>
                      currentConflictId === conflict.id ? null : conflict.id,
                    )
                  }
                >
                  <span aria-hidden="true">!</span>
                </button>
                {isConflictMenuOpen && (
                  <div className="stacking-conflict-menu blocking-geometry-conflict-menu" role="dialog" aria-label="Geometry conflict">
                    <p>
                      <strong>Information conflict:</strong>{" "}
                      {explanation}
                    </p>
                    <div className="stacking-conflict-menu-actions">
                      <button type="button" onClick={() => applyGeometryConflictResolution(conflict, "include")}>
                        Update area to include {conflict.primaryChildLabel}
                      </button>
                      <button type="button" onClick={() => applyGeometryConflictResolution(conflict, "recalculate")}>
                        {getBlockingGeometryConflictRecalculateLabel(conflict)}
                      </button>
                      <button
                        className={isIgnored ? "is-toggle-on" : ""}
                        type="button"
                        aria-pressed={isIgnored}
                        onClick={() => toggleGeometryConflictIgnored(conflict.id)}
                      >
                        Ignore temporarily
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {selectionDimensionFields.length > 0 && (
        <div className="blocking-dimension-overlay" aria-label="Selected object dimensions">
          {selectionDimensionFields.map((dimension) => {
            const formattedValue = formatDimensionInputValue(dimension.value);
            const isEditing = editingDimensionKey === dimension.key;
            const displayValue = dimensionDrafts[dimension.key] ?? formattedValue;

            return (
              <div
                className={`stacking-dimension-field blocking-dimension-field is-${dimension.orientation} is-${dimension.kind}${isEditing ? " is-editing" : ""}`}
                key={dimension.key}
                style={{
                  left: `${dimension.left}px`,
                  top: `${dimension.top}px`,
                  "--dimension-field-width": isEditing ? getDimensionEditorWidth(displayValue) : `${STACKING_DIMENSION_LABEL_WIDTH}px`,
                }}
              >
                {isEditing ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={displayValue}
                    aria-label={dimension.ariaLabel}
                    onChange={(event) => handleDimensionChange(dimension, event.target.value)}
                    onBlur={(event) => handleDimensionBlur(event, dimension)}
                    onFocus={(event) => event.target.select()}
                    onKeyDown={(event) => handleDimensionKeyDown(event, dimension)}
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
                    className="stacking-dimension-value"
                    aria-label={`${dimension.ariaLabel}: ${formattedValue}`}
                    onClick={() => beginDimensionEdit(dimension)}
                  >
                    {formattedValue}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isSpaceKey(event) {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

function isEditableEventTarget(target) {
  return typeof Element !== "undefined" && target instanceof Element && Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}

function shouldTrackCanvasPoint(target) {
  return typeof Element !== "undefined" && target instanceof Element && !target.closest(".diagrams-canvas-toolbar, .stacking-dimension-field");
}

function shouldTrackBlockingCanvasPoint(target) {
  return typeof Element !== "undefined" && target instanceof Element && !target.closest("button, input, textarea, select, [contenteditable='true']");
}

function normalizeDiagramView(value) {
  return value === DIAGRAM_VIEW_BLOCKING || value === "areas" ? DIAGRAM_VIEW_BLOCKING : DIAGRAM_VIEW_STACKING;
}

function normalizeBlockingSettings(settings) {
  const defaults = createDefaultBlockingSettings();
  const sourceFloorSettings = isPlainObject(settings?.floorSettings) ? settings.floorSettings : {};
  const firstLegacyFloorLevelOfDetail = Object.values(sourceFloorSettings)
    .map((floorSetting) => floorSetting?.levelOfDetail)
    .find((value) => LEVEL_OF_DETAIL_OPTIONS.some((option) => option.value === value));
  const levelOfDetail = getBlockingLevelOfDetailValue(
    settings?.levelOfDetail,
    firstLegacyFloorLevelOfDetail ?? defaults.levelOfDetail,
  );
  const floorSettings = {
    ...defaults.floorSettings,
    "floor-1": createDefaultBlockingFloorSettings(),
  };

  for (const [floorKey, floorSetting] of Object.entries(sourceFloorSettings)) {
    const normalizedFloorKey = String(floorKey ?? "").trim();
    if (!normalizedFloorKey) continue;
    floorSettings[normalizedFloorKey] = normalizeBlockingFloorSettings(floorSetting);
  }

  const activeTool = BLOCKING_TOOL_VALUES.includes(settings?.activeTool)
    ? settings.activeTool
    : defaults.activeTool;

  return {
    ...defaults,
    activeFloorKey: String(settings?.activeFloorKey || defaults.activeFloorKey),
    activeTool,
    customFloors: normalizeBlockingCustomFloors(settings?.customFloors),
    gridSpacingFeet: String(getBlockingSharedSettingValue(settings, sourceFloorSettings, "gridSpacingFeet", defaults.gridSpacingFeet)),
    gridSpacingInches: String(getBlockingSharedSettingValue(settings, sourceFloorSettings, "gridSpacingInches", defaults.gridSpacingInches)),
    floorSettings,
    levelOfDetail,
    structuralGridFeet: String(settings?.structuralGridFeet ?? defaults.structuralGridFeet),
    structuralGridInches: String(settings?.structuralGridInches ?? defaults.structuralGridInches),
  };
}

function normalizeBlockingFloorSettings(settings) {
  const defaults = createDefaultBlockingFloorSettings();
  return {
    selectedProgrammingKey: String(settings?.selectedProgrammingKey ?? defaults.selectedProgrammingKey),
    textSize: String(settings?.textSize ?? defaults.textSize),
    shapes: normalizeBlockingShapes(settings?.shapes),
  };
}

function getBlockingLevelOfDetailValue(value, fallbackValue = "functionalGroup") {
  if (isBlockingLevelOfDetailValue(value)) return value;
  if (isBlockingLevelOfDetailValue(fallbackValue)) return fallbackValue;
  return "functionalGroup";
}

function isBlockingLevelOfDetailValue(value) {
  return LEVEL_OF_DETAIL_OPTIONS.some((option) => option.value === value);
}

function getBlockingLevelOfDetailIndex(level) {
  return LEVEL_OF_DETAIL_OPTIONS.findIndex((option) => option.value === level);
}

function getBlockingParentLevelOfDetail(level) {
  const levelIndex = getBlockingLevelOfDetailIndex(level);
  return levelIndex > 0 ? LEVEL_OF_DETAIL_OPTIONS[levelIndex - 1].value : "";
}

function getBlockingShapeLevelOfDetail(shape) {
  if (isBlockingLevelOfDetailValue(shape?.levelOfDetail)) return shape.levelOfDetail;

  const programmingAttribute = normalizeBlockingProgrammingAttribute(shape?.programmingAttribute);
  if (programmingAttribute) return programmingAttribute.level;

  return "functionalGroup";
}

function getBlockingShapesForLevel(shapes, level) {
  const normalizedLevel = getBlockingLevelOfDetailValue(level);
  return (shapes ?? []).filter((shape) => getBlockingShapeLevelOfDetail(shape) === normalizedLevel);
}

function getBlockingParentPreviewShapesForLevel(shapes, level) {
  const parentLevel = getBlockingParentLevelOfDetail(level);
  return parentLevel ? getBlockingShapesForLevel(shapes, parentLevel) : [];
}

function normalizeBlockingProgrammingAttribute(attribute) {
  if (!isPlainObject(attribute)) return null;

  const key = String(attribute.key ?? "").trim();
  const level = LEVEL_OF_DETAIL_OPTIONS.some((option) => option.value === attribute.level)
    ? attribute.level
    : "";
  const label = humanizeStackingLabel(attribute.label);
  if (!key || !level || !label) return null;

  const levelLabel = humanizeStackingLabel(attribute.levelLabel) ||
    LEVEL_OF_DETAIL_OPTIONS.find((option) => option.value === level)?.label ||
    "Program";
  const color = String(attribute.color || colorForStackingLabel(label)).trim();
  const hoverFillColor = String(attribute.hoverFillColor || getCssColorWithAlpha(color, 0.1)).trim();
  const activeFillColor = String(attribute.activeFillColor || getCssColorWithAlpha(color, 0.2)).trim();
  const shapeFillColor = String(attribute.shapeFillColor || getCssColorWithAlpha(color, 0.12)).trim();

  return {
    key,
    level,
    levelLabel,
    label,
    color,
    hoverFillColor,
    activeFillColor,
    shapeFillColor,
  };
}

function areBlockingProgrammingAttributesEqual(attributeA, attributeB) {
  const normalizedA = normalizeBlockingProgrammingAttribute(attributeA);
  const normalizedB = normalizeBlockingProgrammingAttribute(attributeB);
  return Boolean(
    normalizedA &&
    normalizedB &&
    normalizedA.key === normalizedB.key &&
    normalizedA.level === normalizedB.level,
  );
}

function getBlockingSharedSettingValue(settings, floorSettings, key, fallbackValue) {
  if (settings?.[key] !== undefined && settings?.[key] !== null && settings?.[key] !== "") {
    return settings[key];
  }

  for (const floorSetting of Object.values(floorSettings ?? {})) {
    if (floorSetting?.[key] !== undefined && floorSetting?.[key] !== null && floorSetting?.[key] !== "") {
      return floorSetting[key];
    }
  }

  return fallbackValue;
}

function normalizeBlockingCustomFloors(floors) {
  if (!Array.isArray(floors)) return [];

  const usedKeys = new Set();
  return floors
    .map((floor, index) => {
      const number = firstFiniteNumber(
        floor?.number,
        floorNumberFromLabel(floor?.label),
        floorNumberFromId(floor?.key),
        index + 2,
      ) ?? index + 2;
      const key = String(floor?.key || createBlockingFloorKeyForNumber(number)).trim();
      if (!key || usedKeys.has(key)) return null;
      usedKeys.add(key);

      return {
        key,
        number,
        label: `Floor ${formatEditableNumber(number)}`,
      };
    })
    .filter(Boolean);
}

function normalizeBlockingShapes(shapes) {
  if (!Array.isArray(shapes)) return [];

  return shapes
    .map((shape, index) => {
      const id = String(shape?.id || `blocking-shape-${index + 1}`);
      const programmingAttribute = normalizeBlockingProgrammingAttribute(shape?.programmingAttribute);
      const programmingFields = programmingAttribute ? { programmingAttribute } : {};
      const levelOfDetail = isBlockingLevelOfDetailValue(shape?.levelOfDetail)
        ? shape.levelOfDetail
        : programmingAttribute?.level ?? "functionalGroup";
      const ownershipFields = { levelOfDetail };

      if (shape?.type === "rectangle") {
        const x = getFiniteNumber(shape.x);
        const y = getFiniteNumber(shape.y);
        const width = getFiniteNumber(shape.width);
        const height = getFiniteNumber(shape.height);
        if (x == null || y == null || width == null || height == null) return null;

        const rect = normalizeBlockingRectangleFromPoints(
          { x, y },
          { x: x + width, y: y + height },
        );
        if (rect.width < BLOCKING_MIN_SHAPE_FEET || rect.height < BLOCKING_MIN_SHAPE_FEET) return null;

        return {
          id,
          type: "rectangle",
          ...rect,
          ...ownershipFields,
          ...programmingFields,
        };
      }

      if (shape?.type === "polyline") {
        const points = normalizeBlockingPoints(shape.points);
        if (getUniqueBlockingPointCount(points) < 3) return null;

        return {
          id,
          type: "polyline",
          closed: true,
          points,
          ...ownershipFields,
          ...programmingFields,
        };
      }

      return null;
    })
    .filter(Boolean);
}

function normalizeBlockingPoints(points) {
  if (!Array.isArray(points)) return [];

  const normalizedPoints = [];
  for (const point of points) {
    const x = getFiniteNumber(point?.x);
    const y = getFiniteNumber(point?.y);
    if (x == null || y == null) continue;

    const normalizedPoint = {
      x: roundBlockingCoordinate(x),
      y: roundBlockingCoordinate(y),
    };
    const previousPoint = normalizedPoints[normalizedPoints.length - 1];
    if (previousPoint && areBlockingPointsEqual(previousPoint, normalizedPoint)) continue;
    normalizedPoints.push(normalizedPoint);
  }

  const firstPoint = normalizedPoints[0];
  const lastPoint = normalizedPoints[normalizedPoints.length - 1];
  if (normalizedPoints.length > 1 && areBlockingPointsEqual(firstPoint, lastPoint)) {
    normalizedPoints.pop();
  }

  return normalizedPoints;
}

function getBlockingFloorTabs(programData, settings) {
  const programFloors = Array.isArray(programData?.floors) ? programData.floors : [];
  const sourceTabs = programFloors
    .map((floor, index) => {
      const number = firstFiniteNumber(
        floor?.number,
        floorNumberFromLabel(floor?.name),
        floorNumberFromId(floor?.id),
        index + 1,
      ) ?? index + 1;
      const key = String(floor?.id || `floor-${formatEditableNumber(number)}`).trim();
      if (!key) return null;

      return {
        key,
        number,
        label: `Floor ${formatEditableNumber(number)}`,
        source: "program",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number || a.label.localeCompare(b.label));

  const baseTabs = sourceTabs.length > 0
    ? sourceTabs
    : [{ key: "floor-1", number: 1, label: "Floor 1", source: "default" }];
  const usedKeys = new Set(baseTabs.map((floor) => floor.key));
  const customTabs = normalizeBlockingCustomFloors(settings?.customFloors)
    .filter((floor) => {
      if (usedKeys.has(floor.key)) return false;
      usedKeys.add(floor.key);
      return true;
    })
    .map((floor) => ({ ...floor, source: "custom" }))
    .sort((a, b) => a.number - b.number || a.label.localeCompare(b.label));

  return [...baseTabs, ...customTabs];
}

function getActiveBlockingFloorKey(settings, floorTabs) {
  const activeFloorKey = String(settings?.activeFloorKey ?? "");
  if ((floorTabs ?? []).some((floor) => floor.key === activeFloorKey)) return activeFloorKey;
  return floorTabs?.[0]?.key ?? "floor-1";
}

function getBlockingFloorBelow(floorTabs, activeFloorKey) {
  const tabs = Array.isArray(floorTabs) ? floorTabs : [];
  const activeIndex = tabs.findIndex((floor) => floor.key === activeFloorKey);
  return activeIndex > 0 ? tabs[activeIndex - 1] : null;
}

function getBlockingFloorSettings(settings, floorKey) {
  const sourceSettings = isPlainObject(settings?.floorSettings) ? settings.floorSettings : {};
  return normalizeBlockingFloorSettings(
    sourceSettings[floorKey] ?? createDefaultBlockingFloorSettings(),
  );
}

function validateBlockingSettingsForProgramData(programData, settings) {
  const normalizedSettings = normalizeBlockingSettings(settings);
  if (!isPlainObject(programData)) {
    return { settings: normalizedSettings, changed: false };
  }

  const floorTabs = getBlockingFloorTabs(programData, normalizedSettings);
  const floorTabsByKey = new Map(floorTabs.map((floor) => [floor.key, floor]));
  const optionLookupCache = new Map();
  let changed = false;
  const floorSettings = {};

  for (const [floorKey, floorSetting] of Object.entries(normalizedSettings.floorSettings)) {
    const validation = validateBlockingFloorSettingsForProgramData(
      programData,
      normalizedSettings,
      floorSetting,
      floorTabsByKey.get(floorKey) ?? null,
      optionLookupCache,
    );
    floorSettings[floorKey] = validation.settings;
    changed = changed || validation.changed;
  }

  return {
    settings: changed ? { ...normalizedSettings, floorSettings } : normalizedSettings,
    changed,
  };
}

function validateBlockingFloorSettingsForProgramData(
  programData,
  blockingSettings,
  floorSettings,
  activeFloor,
  optionLookupCache,
) {
  const normalizedFloorSettings = normalizeBlockingFloorSettings(floorSettings);
  let changed = false;
  const shapes = normalizedFloorSettings.shapes.map((shape) => {
    const programmingAttribute = normalizeBlockingProgrammingAttribute(shape.programmingAttribute);
    if (
      !programmingAttribute ||
      isBlockingProgrammingAttributeValidForFloor(programData, programmingAttribute, activeFloor, optionLookupCache)
    ) {
      return shape;
    }

    changed = true;
    return getBlockingShapeWithDefaultProgrammingAttribute(shape);
  });
  const selectedProgrammingKey = String(normalizedFloorSettings.selectedProgrammingKey ?? "").trim();
  const nextSelectedProgrammingKey =
    selectedProgrammingKey &&
    isBlockingProgrammingKeyValidForFloor(
      programData,
      selectedProgrammingKey,
      blockingSettings.levelOfDetail,
      activeFloor,
      optionLookupCache,
    )
      ? selectedProgrammingKey
      : "";

  if (nextSelectedProgrammingKey !== normalizedFloorSettings.selectedProgrammingKey) {
    changed = true;
  }

  return {
    settings: changed
      ? {
          ...normalizedFloorSettings,
          selectedProgrammingKey: nextSelectedProgrammingKey,
          shapes,
        }
      : normalizedFloorSettings,
    changed,
  };
}

function getBlockingShapeWithDefaultProgrammingAttribute(shape) {
  const nextShape = { ...shape };
  delete nextShape.programmingAttribute;
  return nextShape;
}

function isBlockingProgrammingAttributeValidForFloor(programData, programmingAttribute, activeFloor, optionLookupCache) {
  const normalizedAttribute = normalizeBlockingProgrammingAttribute(programmingAttribute);
  if (!normalizedAttribute) return false;

  return isBlockingProgrammingKeyValidForFloor(
    programData,
    normalizedAttribute.key,
    normalizedAttribute.level,
    activeFloor,
    optionLookupCache,
  );
}

function isBlockingProgrammingKeyValidForFloor(programData, programmingKey, level, activeFloor, optionLookupCache) {
  const normalizedKey = String(programmingKey ?? "").trim();
  if (!normalizedKey) return false;

  return getBlockingProgrammingOptionLookupForFloor(programData, activeFloor, level, optionLookupCache).has(normalizedKey);
}

function getBlockingProgrammingOptionLookupForFloor(programData, activeFloor, level, optionLookupCache) {
  const normalizedLevel = LEVEL_OF_DETAIL_OPTIONS.some((option) => option.value === level) ? level : "";
  if (!normalizedLevel || !activeFloor) return new Map();

  const floorKey = String(activeFloor.key ?? "");
  const cacheKey = `${floorKey}|${normalizedLevel}`;
  if (!optionLookupCache.has(cacheKey)) {
    const optionsByKey = new Map(
      getBlockingProgrammingOptions(programData, normalizedLevel, activeFloor).map((option) => [option.key, option]),
    );
    optionLookupCache.set(cacheKey, optionsByKey);
  }

  return optionLookupCache.get(cacheKey);
}

function createNextBlockingCustomFloor(floorTabs) {
  const numbers = (floorTabs ?? [])
    .map((floor) => getFiniteNumber(floor?.number) ?? floorNumberFromLabel(floor?.label))
    .filter((number) => number != null);
  const usedNumbers = new Set(numbers.map((number) => Math.round(number)));
  let nextNumber = Math.max(0, ...numbers.map((number) => Math.ceil(number))) + 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;

  const existingKeys = new Set((floorTabs ?? []).map((floor) => floor.key));
  const key = createUniqueBlockingFloorKey(createBlockingFloorKeyForNumber(nextNumber), existingKeys);

  return {
    key,
    number: nextNumber,
    label: `Floor ${formatEditableNumber(nextNumber)}`,
  };
}

function createBlockingFloorKeyForNumber(number) {
  const suffix = String(formatEditableNumber(number) || "floor").replace(/[^a-zA-Z0-9-]+/g, "-");
  return `blocking-floor-${suffix}`;
}

function createUniqueBlockingFloorKey(baseKey, existingKeys) {
  const normalizedBaseKey = String(baseKey || "blocking-floor").trim() || "blocking-floor";
  if (!existingKeys.has(normalizedBaseKey)) return normalizedBaseKey;

  let index = 2;
  while (existingKeys.has(`${normalizedBaseKey}-${index}`)) index += 1;
  return `${normalizedBaseKey}-${index}`;
}

function getBlockingDisplayedShapes(shapes, shapeMove, shapeResize) {
  return (shapes ?? []).map((shape) => {
    if (shapeResize?.shapeId === shape.id) return shapeResize.currentShape ?? shapeResize.originalShape ?? shape;
    if (shapeMove?.shapeIds?.includes(shape.id)) return moveBlockingShape(shape, shapeMove.currentDelta ?? { x: 0, y: 0 });
    return shape;
  });
}

function getBlockingShapeVertices(shape) {
  if (shape?.type === "rectangle") {
    return [
      { x: shape.x, y: shape.y },
      { x: shape.x + shape.width, y: shape.y },
      { x: shape.x + shape.width, y: shape.y + shape.height },
      { x: shape.x, y: shape.y + shape.height },
    ];
  }

  if (shape?.type === "polyline") {
    return normalizeBlockingPoints(shape.points);
  }

  return [];
}

function getBlockingShapeBounds(shape) {
  const vertices = getBlockingShapeVertices(shape);
  if (vertices.length === 0) return null;

  const xs = vertices.map((point) => point.x);
  const ys = vertices.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getBlockingSelectionFrame(shapes) {
  const bounds = (shapes ?? []).map(getBlockingShapeBounds).filter(Boolean);
  if (bounds.length === 0) return null;

  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getBlockingSelectionRect(selectionDrag) {
  if (!selectionDrag?.startPoint || !selectionDrag?.currentPoint) return null;

  const x1 = selectionDrag.startPoint.x;
  const y1 = selectionDrag.startPoint.y;
  const x2 = selectionDrag.currentPoint.x;
  const y2 = selectionDrag.currentPoint.y;

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    mode: x2 >= x1 ? "window" : "crossing",
  };
}

function getBlockingShapeIdsInSelection(shapes, selectionDrag) {
  const selectionRect = getBlockingSelectionRect(selectionDrag);
  if (!selectionRect || selectionRect.width <= 0 || selectionRect.height <= 0) return [];

  return (shapes ?? [])
    .filter((shape) => {
      const bounds = getBlockingShapeBounds(shape);
      if (!bounds) return false;
      return selectionRect.mode === "window"
        ? doesBlockingRectContainRect(selectionRect, bounds)
        : doBlockingRectsIntersect(selectionRect, bounds);
    })
    .map((shape) => shape.id);
}

function doesBlockingRectContainRect(container, rect) {
  return (
    rect.x >= container.x &&
    rect.y >= container.y &&
    rect.x + rect.width <= container.x + container.width &&
    rect.y + rect.height <= container.y + container.height
  );
}

function doBlockingRectsIntersect(rectA, rectB) {
  return (
    rectA.x <= rectB.x + rectB.width &&
    rectA.x + rectA.width >= rectB.x &&
    rectA.y <= rectB.y + rectB.height &&
    rectA.y + rectA.height >= rectB.y
  );
}

function getBlockingSelectionDimensionFields(frame, view) {
  if (!frame || frame.width <= 0 || frame.height <= 0) return [];

  const topLeft = blockingModelToScreen({ x: frame.x, y: frame.y }, view);
  const bottomRight = blockingModelToScreen({ x: frame.x + frame.width, y: frame.y + frame.height }, view);
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  const width = Math.abs(bottomRight.x - topLeft.x);
  const height = Math.abs(bottomRight.y - topLeft.y);

  return [
    {
      ariaLabel: "Selected X dimension",
      key: "blocking-selection-width",
      kind: "width",
      left: x + width / 2,
      orientation: "horizontal",
      top: y - 18,
      value: frame.width,
    },
    {
      ariaLabel: "Selected Y dimension",
      key: "blocking-selection-height",
      kind: "height",
      left: x + width + 40,
      orientation: "vertical",
      top: y + height / 2,
      value: frame.height,
    },
  ];
}

function resizeBlockingShapesToSelectionDimension(shapes, selectedShapeIdSet, frame, dimensionKind, value) {
  if (!frame || !(value > 0)) return shapes;

  const scaleX = dimensionKind === "width" && frame.width > 0 ? value / frame.width : 1;
  const scaleY = dimensionKind === "height" && frame.height > 0 ? value / frame.height : 1;

  return (shapes ?? []).map((shape) =>
    selectedShapeIdSet.has(shape.id)
      ? scaleBlockingShapeInFrame(shape, frame, scaleX, scaleY)
      : shape,
  );
}

function scaleBlockingShapeInFrame(shape, frame, scaleX, scaleY) {
  if (shape.type === "rectangle") {
    return {
      ...shape,
      x: roundBlockingCoordinate(frame.x + (shape.x - frame.x) * scaleX),
      y: roundBlockingCoordinate(frame.y + (shape.y - frame.y) * scaleY),
      width: roundBlockingCoordinate(Math.max(BLOCKING_MIN_SHAPE_FEET, shape.width * scaleX)),
      height: roundBlockingCoordinate(Math.max(BLOCKING_MIN_SHAPE_FEET, shape.height * scaleY)),
    };
  }

  if (shape.type === "polyline") {
    return {
      ...shape,
      points: (shape.points ?? []).map((point) => ({
        x: roundBlockingCoordinate(frame.x + (point.x - frame.x) * scaleX),
        y: roundBlockingCoordinate(frame.y + (point.y - frame.y) * scaleY),
      })),
    };
  }

  return shape;
}

function getBlockingSnappedPoint(point, options) {
  return getBlockingSnapCandidate(point, options)?.point ?? point;
}

function getBlockingSnapCandidate(point, options) {
  const geometryCandidate = getBlockingNearestGeometrySnapPoint(point, options);
  if (geometryCandidate) return geometryCandidate;

  const structuralSpacing = getBlockingStructuralGridSpacing(options.blockingSettings);
  const structuralCandidate = getBlockingGridSnapCandidate(point, structuralSpacing, "structural-grid", options.view);
  if (structuralCandidate && structuralCandidate.distance <= BLOCKING_SNAP_RADIUS) return structuralCandidate;

  const gridSpacing = getBlockingGridSpacing(options.blockingSettings);
  return getBlockingGridSnapCandidate(point, gridSpacing, "grid", options.view);
}

function getBlockingNearestGeometrySnapPoint(point, options) {
  const excludeShapeIds = options.excludeShapeIds ?? new Set();
  const snapPoints = [
    ...(options.extraPoints ?? []),
    ...(options.shapes ?? [])
      .filter((shape) => !excludeShapeIds.has(shape.id))
      .flatMap(getBlockingShapeVertices),
  ];
  if (snapPoints.length === 0) return null;

  const screenPoint = blockingModelToScreen(point, options.view);
  let bestCandidate = null;

  for (const snapPoint of snapPoints) {
    const snapScreenPoint = blockingModelToScreen(snapPoint, options.view);
    const distance = Math.hypot(screenPoint.x - snapScreenPoint.x, screenPoint.y - snapScreenPoint.y);
    if (distance > BLOCKING_SNAP_RADIUS) continue;
    if (!bestCandidate || distance < bestCandidate.distance) {
      bestCandidate = {
        distance,
        kind: "geometry",
        point: snapPoint,
      };
    }
  }

  return bestCandidate;
}

function getBlockingGridSnapCandidate(point, spacing, kind, view) {
  if (!(spacing > 0)) return null;

  const snapPoint = {
    x: roundBlockingCoordinate(Math.round(point.x / spacing) * spacing),
    y: roundBlockingCoordinate(Math.round(point.y / spacing) * spacing),
  };
  const pointScreen = blockingModelToScreen(point, view);
  const snapScreen = blockingModelToScreen(snapPoint, view);

  return {
    distance: Math.hypot(pointScreen.x - snapScreen.x, pointScreen.y - snapScreen.y),
    kind,
    point: snapPoint,
  };
}

function getBlockingSnappedMoveDelta(startShapes, rawDelta, options) {
  const movedVertices = (startShapes ?? [])
    .flatMap(getBlockingShapeVertices)
    .map((point) => ({
      x: roundBlockingCoordinate(point.x + rawDelta.x),
      y: roundBlockingCoordinate(point.y + rawDelta.y),
    }));

  if (movedVertices.length === 0) return rawDelta;

  const geometryCandidate = getBlockingBestSnapForVertices(movedVertices, options, "geometry");
  if (geometryCandidate) return adjustBlockingDeltaToSnap(rawDelta, geometryCandidate);

  const structuralCandidate = getBlockingBestSnapForVertices(movedVertices, options, "structural-grid");
  if (structuralCandidate) return adjustBlockingDeltaToSnap(rawDelta, structuralCandidate);

  const gridCandidate = getBlockingBestSnapForVertices(movedVertices, options, "grid");
  return gridCandidate ? adjustBlockingDeltaToSnap(rawDelta, gridCandidate) : rawDelta;
}

function getBlockingBestSnapForVertices(vertices, options, kind) {
  let bestCandidate = null;

  for (const vertex of vertices) {
    const candidate = getBlockingSnapCandidateForKind(vertex, options, kind);
    if (!candidate) continue;
    if (!bestCandidate || candidate.distance < bestCandidate.distance) {
      bestCandidate = {
        ...candidate,
        vertex,
      };
    }
  }

  return bestCandidate;
}

function getBlockingSnapCandidateForKind(point, options, kind) {
  if (kind === "geometry") return getBlockingNearestGeometrySnapPoint(point, options);

  if (kind === "structural-grid") {
    const structuralCandidate = getBlockingGridSnapCandidate(
      point,
      getBlockingStructuralGridSpacing(options.blockingSettings),
      kind,
      options.view,
    );
    return structuralCandidate?.distance <= BLOCKING_SNAP_RADIUS ? structuralCandidate : null;
  }

  return getBlockingGridSnapCandidate(point, getBlockingGridSpacing(options.blockingSettings), kind, options.view);
}

function adjustBlockingDeltaToSnap(rawDelta, candidate) {
  return {
    x: roundBlockingCoordinate(rawDelta.x + candidate.point.x - candidate.vertex.x),
    y: roundBlockingCoordinate(rawDelta.y + candidate.point.y - candidate.vertex.y),
  };
}

function findBlockingEdgeAtPoint(shapes, point, view) {
  const tolerance = BLOCKING_EDGE_HIT_RADIUS / getBlockingScale(view);

  for (let shapeIndex = (shapes ?? []).length - 1; shapeIndex >= 0; shapeIndex -= 1) {
    const shape = shapes[shapeIndex];
    const edges = getBlockingShapeEdges(shape);
    let bestEdge = null;

    for (const edge of edges) {
      const distance = getBlockingPointSegmentDistance(point, edge.startPoint, edge.endPoint);
      if (distance > tolerance) continue;
      if (!bestEdge || distance < bestEdge.distance) {
        bestEdge = {
          ...edge,
          distance,
          shapeId: shape.id,
          shapeType: shape.type,
        };
      }
    }

    if (bestEdge) return bestEdge;
  }

  return null;
}

function getBlockingShapeEdges(shape) {
  if (shape?.type === "rectangle") {
    const left = shape.x;
    const right = shape.x + shape.width;
    const top = shape.y;
    const bottom = shape.y + shape.height;

    return [
      {
        edgeKey: "top",
        endPoint: { x: right, y: top },
        normal: { x: 0, y: 1 },
        startPoint: { x: left, y: top },
      },
      {
        edgeKey: "right",
        endPoint: { x: right, y: bottom },
        normal: { x: 1, y: 0 },
        startPoint: { x: right, y: top },
      },
      {
        edgeKey: "bottom",
        endPoint: { x: left, y: bottom },
        normal: { x: 0, y: 1 },
        startPoint: { x: right, y: bottom },
      },
      {
        edgeKey: "left",
        endPoint: { x: left, y: top },
        normal: { x: 1, y: 0 },
        startPoint: { x: left, y: bottom },
      },
    ];
  }

  if (shape?.type === "polyline") {
    const points = normalizeBlockingPoints(shape.points);
    return points.map((point, index) => {
      const nextPoint = points[(index + 1) % points.length];
      return {
        edgeIndex: index,
        edgeKey: `edge-${index}`,
        endPoint: nextPoint,
        normal: getBlockingEdgeNormal(point, nextPoint),
        startPoint: point,
      };
    });
  }

  return [];
}

function getBlockingEdgeNormal(startPoint, endPoint) {
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return { x: 1, y: 0 };

  return {
    x: roundBlockingCoordinate(-dy / length),
    y: roundBlockingCoordinate(dx / length),
  };
}

function getBlockingEdgeCursor(edge) {
  if (edge?.edgeKey === "left" || edge?.edgeKey === "right") return "ew-resize";
  if (edge?.edgeKey === "top" || edge?.edgeKey === "bottom") return "ns-resize";

  const normal = edge?.normal ?? { x: 1, y: 0 };
  if (Math.abs(normal.x) > Math.abs(normal.y) * 1.4) return "ew-resize";
  if (Math.abs(normal.y) > Math.abs(normal.x) * 1.4) return "ns-resize";
  return normal.x * normal.y >= 0 ? "nwse-resize" : "nesw-resize";
}

function getBlockingResizePreview(resize, rawPoint, options) {
  if (!resize?.originalShape || !resize?.edge) return null;

  const normal = resize.edge.normal ?? { x: 1, y: 0 };
  const startMidpoint = getBlockingEdgeMidpoint(resize.edge);
  const rawDistance = getBlockingDotProduct(
    {
      x: rawPoint.x - resize.startPoint.x,
      y: rawPoint.y - resize.startPoint.y,
    },
    normal,
  );
  const rawMidpoint = {
    x: startMidpoint.x + normal.x * rawDistance,
    y: startMidpoint.y + normal.y * rawDistance,
  };
  const snappedMidpoint = getBlockingSnappedPoint(rawMidpoint, {
    ...options,
    excludeShapeIds: new Set([resize.shapeId]),
  });
  const snappedDistance = getBlockingDotProduct(
    {
      x: snappedMidpoint.x - startMidpoint.x,
      y: snappedMidpoint.y - startMidpoint.y,
    },
    normal,
  );

  return resizeBlockingShapeEdge(resize.originalShape, resize.edge, snappedDistance);
}

function resizeBlockingShapeEdge(shape, edge, distance) {
  if (shape.type === "rectangle") {
    const left = shape.x;
    const right = shape.x + shape.width;
    const top = shape.y;
    const bottom = shape.y + shape.height;

    if (edge.edgeKey === "left") {
      const nextLeft = Math.min(left + distance, right - BLOCKING_MIN_SHAPE_FEET);
      return normalizeBlockingRectangleShape({ ...shape, x: nextLeft, width: right - nextLeft });
    }

    if (edge.edgeKey === "right") {
      const nextRight = Math.max(right + distance, left + BLOCKING_MIN_SHAPE_FEET);
      return normalizeBlockingRectangleShape({ ...shape, width: nextRight - left });
    }

    if (edge.edgeKey === "top") {
      const nextTop = Math.min(top + distance, bottom - BLOCKING_MIN_SHAPE_FEET);
      return normalizeBlockingRectangleShape({ ...shape, y: nextTop, height: bottom - nextTop });
    }

    if (edge.edgeKey === "bottom") {
      const nextBottom = Math.max(bottom + distance, top + BLOCKING_MIN_SHAPE_FEET);
      return normalizeBlockingRectangleShape({ ...shape, height: nextBottom - top });
    }
  }

  if (shape.type === "polyline") {
    const points = normalizeBlockingPoints(shape.points);
    const startIndex = edge.edgeIndex;
    const endIndex = (edge.edgeIndex + 1) % points.length;
    const normal = edge.normal ?? { x: 1, y: 0 };

    return {
      ...shape,
      points: points.map((point, index) =>
        index === startIndex || index === endIndex
          ? {
              x: roundBlockingCoordinate(point.x + normal.x * distance),
              y: roundBlockingCoordinate(point.y + normal.y * distance),
            }
          : point,
      ),
    };
  }

  return shape;
}

function normalizeBlockingRectangleShape(shape) {
  const rect = normalizeBlockingRectangleFromPoints(
    { x: shape.x, y: shape.y },
    { x: shape.x + shape.width, y: shape.y + shape.height },
  );
  return {
    ...shape,
    ...rect,
  };
}

function getBlockingEdgeMidpoint(edge) {
  return {
    x: (edge.startPoint.x + edge.endPoint.x) / 2,
    y: (edge.startPoint.y + edge.endPoint.y) / 2,
  };
}

function getBlockingDotProduct(vectorA, vectorB) {
  return vectorA.x * vectorB.x + vectorA.y * vectorB.y;
}

function areBlockingShapesEqual(shapeA, shapeB) {
  return JSON.stringify(shapeA) === JSON.stringify(shapeB);
}

function drawBlockingDiagram(canvas, options) {
  if (!canvas) return;

  const {
    activeFloor,
    blockingSettings,
    canvasSize,
    floorBelowOutline,
    floorSettings,
    hoveredEdge,
    levelOfDetail,
    polylineDraft,
    rectangleDraft,
    selectionDrag,
    selectedShapeIds,
    shapeMove,
    shapeResize,
    view,
  } = options;
  const width = Math.max(1, canvasSize.width);
  const height = Math.max(1, canvasSize.height);
  const pixelRatio = Math.max(1, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const scaledWidth = Math.round(width * pixelRatio);
  const scaledHeight = Math.round(height * pixelRatio);

  if (canvas.width !== scaledWidth) canvas.width = scaledWidth;
  if (canvas.height !== scaledHeight) canvas.height = scaledHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const normalizedSettings = normalizeBlockingFloorSettings(floorSettings);
  const normalizedBlockingSettings = normalizeBlockingSettings(blockingSettings);
  drawBlockingGrid(ctx, normalizedBlockingSettings, { width, height }, view);
  drawBlockingFloorBelowOutline(ctx, floorBelowOutline, view);

  const selectedShapeIdSet = new Set(selectedShapeIds ?? []);
  const previewShapes = getBlockingParentPreviewShapesForLevel(normalizedSettings.shapes, levelOfDetail);
  const editableShapes = getBlockingShapesForLevel(normalizedSettings.shapes, levelOfDetail);
  const displayedShapes = getBlockingDisplayedShapes(editableShapes, shapeMove, shapeResize);
  for (const previewShape of previewShapes) {
    drawBlockingShape(ctx, previewShape, view, {
      isPreview: true,
      textSize: normalizedSettings.textSize,
    });
  }

  for (const displayShape of displayedShapes) {
    drawBlockingShape(ctx, displayShape, view, {
      isSelected: selectedShapeIdSet.has(displayShape.id),
      textSize: normalizedSettings.textSize,
    });
  }

  if (hoveredEdge && !shapeMove && !shapeResize) {
    drawBlockingHoveredEdge(ctx, hoveredEdge, view);
  }

  if (rectangleDraft) {
    drawBlockingRectangleDraft(ctx, rectangleDraft, view);
  }

  if (polylineDraft) {
    drawBlockingPolylineDraft(ctx, polylineDraft, view);
  }

  if (selectionDrag) {
    drawBlockingSelectionDrag(ctx, selectionDrag, view);
  }

  if (activeFloor?.label) {
    drawBlockingFloorBadge(ctx, activeFloor.label);
  }
}

function drawBlockingGrid(ctx, settings, size, view) {
  const baseSpacing = getBlockingGridSpacing(settings);
  const structuralSpacing = getBlockingStructuralGridSpacing(settings);
  const scale = getBlockingScale(view);
  let spacing = baseSpacing;
  while (spacing * scale < 8) spacing *= 2;

  const topLeft = blockingScreenToModel({ x: 0, y: 0 }, view);
  const bottomRight = blockingScreenToModel({ x: size.width, y: size.height }, view);
  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);
  const startX = Math.floor(minX / spacing) * spacing;
  const startY = Math.floor(minY / spacing) * spacing;
  const majorMultiple = Math.max(1, Math.round((spacing / baseSpacing) * 5));

  ctx.save();
  ctx.lineWidth = 1;

  for (let x = startX, index = Math.round(startX / spacing); x <= maxX; x += spacing, index += 1) {
    const screen = blockingModelToScreen({ x, y: 0 }, view);
    ctx.strokeStyle = index % majorMultiple === 0 ? "#dedede" : "#eeeeee";
    ctx.beginPath();
    ctx.moveTo(Math.round(screen.x) + 0.5, 0);
    ctx.lineTo(Math.round(screen.x) + 0.5, size.height);
    ctx.stroke();
  }

  for (let y = startY, index = Math.round(startY / spacing); y <= maxY; y += spacing, index += 1) {
    const screen = blockingModelToScreen({ x: 0, y }, view);
    ctx.strokeStyle = index % majorMultiple === 0 ? "#dedede" : "#eeeeee";
    ctx.beginPath();
    ctx.moveTo(0, Math.round(screen.y) + 0.5);
    ctx.lineTo(size.width, Math.round(screen.y) + 0.5);
    ctx.stroke();
  }

  drawBlockingGridLinesForSpacing(ctx, structuralSpacing, size, view, {
    color: "#8e8e88",
    lineWidth: 1.15,
  });

  ctx.restore();
}

function drawBlockingGridLinesForSpacing(ctx, spacing, size, view, options) {
  if (!(spacing > 0)) return;

  const topLeft = blockingScreenToModel({ x: 0, y: 0 }, view);
  const bottomRight = blockingScreenToModel({ x: size.width, y: size.height }, view);
  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);
  const startX = Math.floor(minX / spacing) * spacing;
  const startY = Math.floor(minY / spacing) * spacing;

  ctx.save();
  ctx.strokeStyle = options.color;
  ctx.lineWidth = options.lineWidth;

  for (let x = startX; x <= maxX; x += spacing) {
    const screen = blockingModelToScreen({ x, y: 0 }, view);
    ctx.beginPath();
    ctx.moveTo(Math.round(screen.x) + 0.5, 0);
    ctx.lineTo(Math.round(screen.x) + 0.5, size.height);
    ctx.stroke();
  }

  for (let y = startY; y <= maxY; y += spacing) {
    const screen = blockingModelToScreen({ x: 0, y }, view);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(screen.y) + 0.5);
    ctx.lineTo(size.width, Math.round(screen.y) + 0.5);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBlockingFloorBelowOutline(ctx, outline, view) {
  const points = normalizeBlockingPoints(outline?.points);
  if (getUniqueBlockingPointCount(points) < 3) return;

  const screenPoints = points.map((point) => blockingModelToScreen(point, view));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
  for (const point of screenPoints.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(150, 150, 150, 0.05)";
  ctx.strokeStyle = "rgba(128, 128, 128, 0.72)";
  ctx.lineWidth = 1.8;
  ctx.setLineDash([5, 3]);
  ctx.fill();
  ctx.stroke();
  drawBlockingFloorBelowLabel(ctx, outline.floorLabel, screenPoints);
  ctx.restore();
}

function drawBlockingFloorBelowLabel(ctx, label, screenPoints) {
  const normalizedLabel = String(label ?? "").trim();
  if (!normalizedLabel) return;

  const bounds = getBlockingScreenPointBounds(screenPoints);
  if (bounds.width < 44 || bounds.height < 18) return;

  const centroid = getBlockingPolygonCentroid(screenPoints);
  ctx.save();
  ctx.font = "800 11px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = truncateCanvasText(ctx, normalizedLabel, Math.max(36, bounds.width - 10));
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
  ctx.strokeText(text, centroid.x, centroid.y);
  ctx.fillStyle = "rgba(116, 116, 116, 0.92)";
  ctx.fillText(text, centroid.x, centroid.y);
  ctx.restore();
}

function drawBlockingShape(ctx, shape, view, options = {}) {
  if (shape.type === "rectangle") {
    drawBlockingRectangleShape(ctx, shape, view, options);
    return;
  }

  if (shape.type === "polyline") {
    drawBlockingPolylineShape(ctx, shape, view, options);
  }
}

function drawBlockingHoveredEdge(ctx, edge, view) {
  const startPoint = blockingModelToScreen(edge.startPoint, view);
  const endPoint = blockingModelToScreen(edge.endPoint, view);

  ctx.save();
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(startPoint.x, startPoint.y);
  ctx.lineTo(endPoint.x, endPoint.y);
  ctx.stroke();
  ctx.restore();
}

function drawBlockingRectangleShape(ctx, shape, view, options = {}) {
  const topLeft = blockingModelToScreen({ x: shape.x, y: shape.y }, view);
  const bottomRight = blockingModelToScreen({ x: shape.x + shape.width, y: shape.y + shape.height }, view);
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  const width = Math.abs(bottomRight.x - topLeft.x);
  const height = Math.abs(bottomRight.y - topLeft.y);
  const drawStyle = getBlockingShapeDrawStyle(shape, options.isSelected, { isPreview: options.isPreview });

  ctx.save();
  ctx.fillStyle = drawStyle.fillStyle;
  ctx.strokeStyle = drawStyle.strokeStyle;
  ctx.lineWidth = drawStyle.lineWidth;
  if (drawStyle.lineDash) ctx.setLineDash(drawStyle.lineDash);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  drawBlockingShapeAreaLabel(
    ctx,
    `${formatDiagramArea(shape.width * shape.height)} SF`,
    x + width / 2,
    y + height / 2,
    width,
    height,
    options.textSize,
    normalizeBlockingProgrammingAttribute(shape?.programmingAttribute)?.label,
    { isPreview: options.isPreview },
  );
  ctx.restore();
}

function drawBlockingPolylineShape(ctx, shape, view, options = {}) {
  const points = shape.points ?? [];
  if (points.length < 3) return;
  const screenPoints = points.map((point) => blockingModelToScreen(point, view));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
  for (const point of screenPoints.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  const drawStyle = getBlockingShapeDrawStyle(shape, options.isSelected, { isPreview: options.isPreview });
  ctx.fillStyle = drawStyle.fillStyle;
  ctx.strokeStyle = drawStyle.strokeStyle;
  ctx.lineWidth = drawStyle.lineWidth;
  if (drawStyle.lineDash) ctx.setLineDash(drawStyle.lineDash);
  ctx.fill();
  ctx.stroke();

  const bounds = getBlockingScreenPointBounds(screenPoints);
  const centroid = getBlockingPolygonCentroid(screenPoints);
  drawBlockingShapeAreaLabel(
    ctx,
    `${formatDiagramArea(getBlockingPolygonArea(points))} SF`,
    centroid.x,
    centroid.y,
    bounds.width,
    bounds.height,
    options.textSize,
    normalizeBlockingProgrammingAttribute(shape?.programmingAttribute)?.label,
    { isPreview: options.isPreview },
  );
  ctx.restore();
}

function getBlockingShapeDrawStyle(shape, isSelected, options = {}) {
  if (options.isPreview) {
    return {
      fillStyle: "rgba(105, 110, 116, 0.025)",
      strokeStyle: "rgba(96, 101, 108, 0.58)",
      lineDash: [7, 5],
      lineWidth: 1.1,
    };
  }

  const programmingAttribute = normalizeBlockingProgrammingAttribute(shape?.programmingAttribute);
  if (programmingAttribute) {
    return {
      fillStyle: isSelected ? programmingAttribute.activeFillColor : programmingAttribute.shapeFillColor,
      strokeStyle: programmingAttribute.color,
      lineWidth: isSelected ? 2.2 : 1.5,
    };
  }

  return {
    fillStyle: isSelected ? "rgba(10, 10, 10, 0.1)" : "rgba(10, 10, 10, 0.055)",
    strokeStyle: "#0a0a0a",
    lineWidth: isSelected ? 2 : 1.2,
  };
}

function drawBlockingShapeAreaLabel(ctx, label, x, y, width, height, textSizeValue, attributeLabel = "", options = {}) {
  const textSize = clamp(parsePositiveDiagramNumber(textSizeValue, 12), 6, 42);
  const labelLines = [
    humanizeStackingLabel(attributeLabel),
    String(label ?? "").trim(),
  ].filter(Boolean);
  if (labelLines.length === 0) return;

  const lineHeight = Math.max(textSize + 2, Math.round(textSize * 1.18));
  const blockHeight = lineHeight * labelLines.length;
  if (width < 38 || height < blockHeight + 8) return;

  ctx.save();
  ctx.fillStyle = options.isPreview ? "rgba(10, 10, 10, 0.24)" : "#0a0a0a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxTextWidth = Math.max(20, width - 8);
  const firstTextY = y - (blockHeight - lineHeight) / 2;
  labelLines.forEach((line, index) => {
    ctx.font = `${index === 0 && labelLines.length > 1 ? 800 : 700} ${textSize}px Inter, Arial, sans-serif`;
    ctx.fillText(truncateCanvasText(ctx, line, maxTextWidth), x, firstTextY + index * lineHeight);
  });
  ctx.restore();
}

function drawBlockingRectangleDraft(ctx, draft, view) {
  const rect = normalizeBlockingRectangleFromPoints(draft.startPoint, draft.currentPoint);
  if (rect.width < BLOCKING_MIN_SHAPE_FEET && rect.height < BLOCKING_MIN_SHAPE_FEET) return;

  const topLeft = blockingModelToScreen({ x: rect.x, y: rect.y }, view);
  const bottomRight = blockingModelToScreen({ x: rect.x + rect.width, y: rect.y + rect.height }, view);
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  const width = Math.abs(bottomRight.x - topLeft.x);
  const height = Math.abs(bottomRight.y - topLeft.y);

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.fillStyle = "rgba(10, 10, 10, 0.035)";
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 1.2;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

function drawBlockingPolylineDraft(ctx, draft, view) {
  const points = draft.points ?? [];
  if (points.length === 0) return;
  const previewPoints = draft.previewPoint ? [...points, draft.previewPoint] : points;
  const screenPoints = previewPoints.map((point) => blockingModelToScreen(point, view));

  ctx.save();
  ctx.strokeStyle = "#0a0a0a";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1.3;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
  for (const point of screenPoints.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  for (const [index, point] of points.entries()) {
    const screenPoint = blockingModelToScreen(point, view);
    ctx.beginPath();
    ctx.arc(screenPoint.x, screenPoint.y, index === 0 ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = index === 0 ? "#0a0a0a" : "#ffffff";
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawBlockingSelectionDrag(ctx, selectionDrag, view) {
  const selectionRect = getBlockingSelectionRect(selectionDrag);
  if (!selectionRect) return;

  const topLeft = blockingModelToScreen({ x: selectionRect.x, y: selectionRect.y }, view);
  const bottomRight = blockingModelToScreen(
    { x: selectionRect.x + selectionRect.width, y: selectionRect.y + selectionRect.height },
    view,
  );
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  const width = Math.abs(bottomRight.x - topLeft.x);
  const height = Math.abs(bottomRight.y - topLeft.y);
  const isCrossing = selectionRect.mode === "crossing";

  ctx.save();
  ctx.fillStyle = isCrossing ? "rgba(10, 10, 10, 0.08)" : "rgba(10, 10, 10, 0.035)";
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 1.2;
  ctx.setLineDash(isCrossing ? [4, 3] : []);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

function drawBlockingFloorBadge(ctx, label) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
  ctx.strokeStyle = "#dedede";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(10, 10, 70, 24, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "800 10px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 45, 22, 58);
  ctx.restore();
}

function getBlockingGridSpacing(settings) {
  return getBlockingSpacingFromFeetInches(settings?.gridSpacingFeet, settings?.gridSpacingInches, 5);
}

function getBlockingStructuralGridSpacing(settings) {
  return getBlockingSpacingFromFeetInches(settings?.structuralGridFeet, settings?.structuralGridInches, 20);
}

function getBlockingSpacingFromFeetInches(feetValue, inchesValue, fallbackValue) {
  const feet = Math.max(0, parseEditableNumber(feetValue));
  const inches = clamp(parseEditableNumber(inchesValue), 0, 11);
  const spacing = feet + inches / 12;
  return spacing > 0 ? spacing : fallbackValue;
}

function getBlockingScale(view) {
  return BLOCKING_BASE_PIXELS_PER_FOOT * clamp(getFiniteNumber(view?.zoom) ?? 1, BLOCKING_MIN_ZOOM, BLOCKING_MAX_ZOOM);
}

function blockingModelToScreen(point, view) {
  const scale = getBlockingScale(view);
  const offset = view?.offset ?? BLOCKING_START_OFFSET;
  return {
    x: point.x * scale + offset.x,
    y: point.y * scale + offset.y,
  };
}

function blockingScreenToModel(point, view) {
  const scale = getBlockingScale(view);
  const offset = view?.offset ?? BLOCKING_START_OFFSET;
  return {
    x: (point.x - offset.x) / scale,
    y: (point.y - offset.y) / scale,
  };
}

function getBlockingZoomedViewOffset(currentView, nextZoom, anchorPoint) {
  const modelPoint = blockingScreenToModel(anchorPoint, currentView);
  const nextScale = BLOCKING_BASE_PIXELS_PER_FOOT * nextZoom;

  return {
    x: anchorPoint.x - modelPoint.x * nextScale,
    y: anchorPoint.y - modelPoint.y * nextScale,
  };
}

function normalizeBlockingRectangleFromPoints(startPoint, endPoint) {
  const x1 = getFiniteNumber(startPoint?.x) ?? 0;
  const y1 = getFiniteNumber(startPoint?.y) ?? 0;
  const x2 = getFiniteNumber(endPoint?.x) ?? x1;
  const y2 = getFiniteNumber(endPoint?.y) ?? y1;

  return {
    x: roundBlockingCoordinate(Math.min(x1, x2)),
    y: roundBlockingCoordinate(Math.min(y1, y2)),
    width: roundBlockingCoordinate(Math.abs(x2 - x1)),
    height: roundBlockingCoordinate(Math.abs(y2 - y1)),
  };
}

function createBlockingPolylineShape(points, levelOfDetail = "functionalGroup") {
  const normalizedPoints = normalizeBlockingPoints(points);
  if (getUniqueBlockingPointCount(normalizedPoints) < 3) return null;

  return {
    id: createBlockingShapeId("polyline"),
    type: "polyline",
    closed: true,
    levelOfDetail: getBlockingLevelOfDetailValue(levelOfDetail),
    points: normalizedPoints,
  };
}

function createBlockingFloorBelowOutline(programData, shapes, floor) {
  if (!floor) return null;

  const sourceShapes = getBlockingFloorOutlineSourceShapes(programData, shapes, floor);
  const points = getBlockingMergedOutlinePoints(sourceShapes);
  if (getUniqueBlockingPointCount(points) < 3) return null;

  return {
    floorKey: String(floor.key ?? ""),
    floorLabel: getBlockingFloorOutlineLabel(floor),
    points,
  };
}

function getBlockingFloorOutlineLabel(floor) {
  const floorNumber = getFiniteNumber(floor?.number) ?? floorNumberFromLabel(floor?.label) ?? floorNumberFromId(floor?.key);
  if (floorNumber == null) return String(floor?.label || "Floor below");
  return `Floor ${formatEditableNumber(floorNumber)}`;
}

function getBlockingFloorOutlineSourceShapes(programData, shapes, floor) {
  const normalizedShapes = normalizeBlockingShapes(shapes);
  if (normalizedShapes.length < 2) return normalizedShapes;

  const conflicts = getBlockingGeometryConflictsForFloor(programData, normalizedShapes, floor);
  if (conflicts.length === 0) return normalizedShapes;

  const shapeById = new Map(normalizedShapes.map((shape) => [shape.id, shape]));
  for (const conflict of conflicts) {
    const parentShape = shapeById.get(conflict.shapeId);
    if (!parentShape) continue;

    const childShapeIds = new Set((conflict.childConflicts ?? []).map((childConflict) => childConflict.childShapeId));
    const childShapes = normalizedShapes.filter((shape) => childShapeIds.has(shape.id));
    const nextShape = createBlockingMergedPolylineShape(parentShape, [parentShape, ...childShapes]);
    if (nextShape) shapeById.set(parentShape.id, nextShape);
  }

  return normalizedShapes.map((shape) => shapeById.get(shape.id) ?? shape);
}

function createBlockingMergedPolylineShape(sourceShape, fitShapes) {
  const sourceProgrammingAttribute = normalizeBlockingProgrammingAttribute(sourceShape?.programmingAttribute);
  const points = getBlockingMergedOutlinePoints(fitShapes);
  if (getUniqueBlockingPointCount(points) < 3) return sourceShape;

  return {
    id: sourceShape.id,
    type: "polyline",
    closed: true,
    levelOfDetail: getBlockingShapeLevelOfDetail(sourceShape),
    points,
    ...(sourceProgrammingAttribute ? { programmingAttribute: sourceProgrammingAttribute } : {}),
  };
}

function getBlockingMergedOutlinePoints(fitShapes) {
  const polygons = (fitShapes ?? [])
    .map(getBlockingShapePolygon)
    .filter(Boolean);
  const mergedPoints = polygons.length > 0 ? computeUnion(polygons) : null;
  // Disconnected child regions cannot be represented as one closed polyline, so fall back to the existing hull fit.
  const fallbackPoints = polygons.length > 0
    ? getBlockingConvexHullPoints(polygons.flat())
    : [];
  return normalizeBlockingPoints(mergedPoints ?? fallbackPoints);
}

function getBlockingShapePolygon(shape) {
  const points = normalizeBlockingPoints(getBlockingShapeVertices(shape));
  return getUniqueBlockingPointCount(points) >= 3 ? points : null;
}

function getBlockingConvexHullPoints(points) {
  const uniquePoints = [];
  const seenKeys = new Set();

  for (const point of points ?? []) {
    const x = getFiniteNumber(point?.x);
    const y = getFiniteNumber(point?.y);
    if (x == null || y == null) continue;

    const normalizedPoint = {
      x: roundBlockingCoordinate(x),
      y: roundBlockingCoordinate(y),
    };
    const pointKey = `${normalizedPoint.x}:${normalizedPoint.y}`;
    if (seenKeys.has(pointKey)) continue;
    seenKeys.add(pointKey);
    uniquePoints.push(normalizedPoint);
  }

  if (uniquePoints.length <= 1) return uniquePoints;

  uniquePoints.sort((pointA, pointB) => pointA.x - pointB.x || pointA.y - pointB.y);
  const lowerHull = [];
  for (const point of uniquePoints) {
    while (
      lowerHull.length >= 2 &&
      getBlockingCrossProduct(lowerHull[lowerHull.length - 2], lowerHull[lowerHull.length - 1], point) <= 0
    ) {
      lowerHull.pop();
    }
    lowerHull.push(point);
  }

  const upperHull = [];
  for (let index = uniquePoints.length - 1; index >= 0; index -= 1) {
    const point = uniquePoints[index];
    while (
      upperHull.length >= 2 &&
      getBlockingCrossProduct(upperHull[upperHull.length - 2], upperHull[upperHull.length - 1], point) <= 0
    ) {
      upperHull.pop();
    }
    upperHull.push(point);
  }

  return [...lowerHull.slice(0, -1), ...upperHull.slice(0, -1)];
}

function getBlockingCrossProduct(pointA, pointB, pointC) {
  return (pointB.x - pointA.x) * (pointC.y - pointA.y) - (pointB.y - pointA.y) * (pointC.x - pointA.x);
}

function createBlockingShapeId(type) {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `blocking-${type}-${Date.now().toString(36)}-${randomPart}`;
}

function moveBlockingShape(shape, delta) {
  const dx = roundBlockingCoordinate(delta?.x ?? 0);
  const dy = roundBlockingCoordinate(delta?.y ?? 0);

  if (shape.type === "rectangle") {
    return {
      ...shape,
      x: roundBlockingCoordinate(shape.x + dx),
      y: roundBlockingCoordinate(shape.y + dy),
    };
  }

  if (shape.type === "polyline") {
    return {
      ...shape,
      points: (shape.points ?? []).map((point) => ({
        x: roundBlockingCoordinate(point.x + dx),
        y: roundBlockingCoordinate(point.y + dy),
      })),
    };
  }

  return shape;
}

function findBlockingShapeAtPoint(shapes, point, view) {
  const tolerance = 6 / getBlockingScale(view);
  for (let index = (shapes ?? []).length - 1; index >= 0; index -= 1) {
    const shape = shapes[index];
    if (isBlockingPointInShape(point, shape, tolerance)) return shape;
  }

  return null;
}

function isBlockingPointInShape(point, shape, tolerance) {
  if (shape.type === "rectangle") {
    return (
      point.x >= shape.x - tolerance &&
      point.x <= shape.x + shape.width + tolerance &&
      point.y >= shape.y - tolerance &&
      point.y <= shape.y + shape.height + tolerance
    );
  }

  if (shape.type === "polyline") {
    const points = shape.points ?? [];
    return isBlockingPointInPolygon(point, points) || isBlockingPointNearPolygonEdge(point, points, tolerance);
  }

  return false;
}

function isBlockingPointInPolygon(point, points) {
  if ((points ?? []).length < 3) return false;

  let isInside = false;
  for (let index = 0, previousIndex = points.length - 1; index < points.length; previousIndex = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previousIndex];
    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (intersects) isInside = !isInside;
  }

  return isInside;
}

function isBlockingPointNearPolygonEdge(point, points, tolerance) {
  if ((points ?? []).length < 2) return false;

  for (let index = 0; index < points.length; index += 1) {
    const startPoint = points[index];
    const endPoint = points[(index + 1) % points.length];
    if (getBlockingPointSegmentDistance(point, startPoint, endPoint) <= tolerance) return true;
  }

  return false;
}

function getBlockingPointSegmentDistance(point, startPoint, endPoint) {
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  if (Math.abs(dx) < BLOCKING_VERTEX_EPSILON && Math.abs(dy) < BLOCKING_VERTEX_EPSILON) {
    return Math.hypot(point.x - startPoint.x, point.y - startPoint.y);
  }

  const t = clamp(
    ((point.x - startPoint.x) * dx + (point.y - startPoint.y) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );
  return Math.hypot(point.x - (startPoint.x + t * dx), point.y - (startPoint.y + t * dy));
}

function areBlockingPointsNearScreen(pointA, pointB, view, radius) {
  const screenPointA = blockingModelToScreen(pointA, view);
  const screenPointB = blockingModelToScreen(pointB, view);
  return Math.hypot(screenPointA.x - screenPointB.x, screenPointA.y - screenPointB.y) <= radius;
}

function areBlockingPointsEqual(pointA, pointB) {
  return (
    Math.abs((pointA?.x ?? 0) - (pointB?.x ?? 0)) <= BLOCKING_VERTEX_EPSILON &&
    Math.abs((pointA?.y ?? 0) - (pointB?.y ?? 0)) <= BLOCKING_VERTEX_EPSILON
  );
}

function getUniqueBlockingPointCount(points) {
  const uniqueKeys = new Set();
  for (const point of points ?? []) {
    uniqueKeys.add(`${Math.round(point.x / BLOCKING_VERTEX_EPSILON)}:${Math.round(point.y / BLOCKING_VERTEX_EPSILON)}`);
  }
  return uniqueKeys.size;
}

function getBlockingPolygonArea(points) {
  if ((points ?? []).length < 3) return 0;

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const currentPoint = points[index];
    const nextPoint = points[(index + 1) % points.length];
    area += currentPoint.x * nextPoint.y - nextPoint.x * currentPoint.y;
  }

  return Math.abs(area / 2);
}

function getBlockingPolygonCentroid(points) {
  if ((points ?? []).length === 0) return { x: 0, y: 0 };

  const sum = points.reduce((total, point) => ({
    x: total.x + point.x,
    y: total.y + point.y,
  }), { x: 0, y: 0 });

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

function getBlockingScreenPointBounds(points) {
  if ((points ?? []).length === 0) return { width: 0, height: 0 };

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function roundBlockingCoordinate(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function getStackingFloorEdgeHitRegions(diagram, layout) {
  if (!diagram?.floors?.length || !layout?.stackItems?.length) return [];

  const regions = [];
  for (const item of layout.stackItems) {
    if (item.kind !== "floor" || !item.floor || !(item.width > 0) || !(item.height > 0)) continue;

    const floor = item.floor;
    const modelX = getFiniteNumber(item.modelX) ?? getStackingFloorX(floor);
    const modelWidth = getFiniteNumber(item.modelWidth) ?? getStackingFloorWidth(diagram, floor);
    const edges = [
      { edge: "left", modelValue: modelX, x: item.x },
      { edge: "right", modelValue: modelX + modelWidth, x: item.x + item.width },
    ];

    for (const edge of edges) {
      regions.push({
        edge: edge.edge,
        floor,
        floorKey: floor.key,
        height: item.height,
        modelLeft: modelX,
        modelRight: modelX + modelWidth,
        modelValue: edge.modelValue,
        modelWidth,
        width: item.width,
        x: edge.x,
        y: item.y,
      });
    }
  }

  return regions;
}

function findStackingFloorEdgeHitRegion(regions, point) {
  if (!point) return null;

  let closestRegion = null;
  let closestDistance = Infinity;
  for (const region of regions ?? []) {
    if (
      point.y < region.y ||
      point.y > region.y + region.height ||
      Math.abs(point.x - region.x) > STACKING_FLOOR_EDGE_HIT_RADIUS
    ) {
      continue;
    }

    const distance = Math.abs(point.x - region.x);
    if (distance < closestDistance) {
      closestRegion = region;
      closestDistance = distance;
    }
  }

  return closestRegion;
}

function createStackingFloorResize(pointerId, hitRegion, point, layout, diagram) {
  return {
    currentPoint: point,
    edge: hitRegion.edge,
    floorKey: hitRegion.floorKey,
    pointerId,
    scale: Math.max(0.0001, getFiniteNumber(layout?.scale) ?? 1),
    snapCandidates: getStackingFloorResizeSnapCandidates(diagram, hitRegion.floorKey),
    startLeft: hitRegion.modelLeft,
    startPoint: point,
    startRight: hitRegion.modelRight,
    startWidth: hitRegion.modelWidth,
  };
}

function getStackingFloorResizePreview(diagram, resize) {
  if (!diagram?.floors?.length || !resize) return null;

  const currentPoint = resize.currentPoint ?? resize.startPoint;
  const scale = Math.max(0.0001, getFiniteNumber(resize.scale) ?? 1);
  const delta = (currentPoint.x - resize.startPoint.x) / scale;
  const snapTolerance = STACKING_FLOOR_EDGE_SNAP_RADIUS / scale;
  let left = resize.startLeft;
  let right = resize.startRight;
  let snapCandidate = null;

  if (resize.edge === "left") {
    const snapResult = snapStackingFloorResizeEdge(resize.startLeft + delta, resize.snapCandidates, snapTolerance);
    snapCandidate = snapResult.snapCandidate;
    left = Math.min(snapResult.value, right - STACKING_MIN_DIMENSION_FEET);
  } else {
    const snapResult = snapStackingFloorResizeEdge(resize.startRight + delta, resize.snapCandidates, snapTolerance);
    snapCandidate = snapResult.snapCandidate;
    right = Math.max(snapResult.value, left + STACKING_MIN_DIMENSION_FEET);
  }

  left = roundArea(left);
  right = roundArea(right);
  const width = roundArea(Math.max(STACKING_MIN_DIMENSION_FEET, right - left));
  if (resize.edge === "left") {
    left = roundArea(right - width);
  } else {
    right = roundArea(left + width);
  }

  return {
    diagram: updateStackingDiagramFloorBounds(diagram, resize.floorKey, { left, width }),
    edge: resize.edge,
    floorKey: resize.floorKey,
    left,
    right,
    snapCandidate,
    width,
  };
}

function snapStackingFloorResizeEdge(value, snapCandidates, tolerance) {
  let closestCandidate = null;
  let closestDistance = Infinity;

  for (const candidate of snapCandidates ?? []) {
    const distance = Math.abs(candidate.value - value);
    if (distance <= tolerance && distance < closestDistance) {
      closestCandidate = candidate;
      closestDistance = distance;
    }
  }

  return {
    snapCandidate: closestCandidate,
    value: closestCandidate ? closestCandidate.value : value,
  };
}

function getStackingFloorResizeSnapCandidates(diagram, floorKey) {
  const candidates = [];

  for (const floor of diagram?.floors ?? []) {
    if (floor.key === floorKey) continue;
    const bounds = getStackingFloorBounds(diagram, floor);
    candidates.push(
      { floorKey: floor.key, edge: "left", value: bounds.left },
      { floorKey: floor.key, edge: "right", value: bounds.right },
    );
  }

  return candidates;
}

function updateStackingDiagramFloorBounds(diagram, floorKey, bounds) {
  if (!diagram?.floors?.length) return diagram;

  const left = roundArea(getFiniteNumber(bounds?.left) ?? 0);
  const width = roundArea(Math.max(STACKING_MIN_DIMENSION_FEET, getFiniteNumber(bounds?.width) ?? diagram.defaultWidth ?? 100));

  return {
    ...diagram,
    floors: diagram.floors.map((floor) =>
      floor.key === floorKey
        ? normalizeStackingFloorSegments(
            {
              ...floor,
              width,
              x: left,
            },
            width,
          )
        : floor,
    ),
  };
}

function isStackingFloorResizeCommitChange(preview, resize) {
  return Boolean(
    preview?.diagram &&
    resize &&
    (Math.abs(preview.left - resize.startLeft) > 0.001 || Math.abs(preview.width - resize.startWidth) > 0.001),
  );
}

function getStackingSegmentHitRegions(diagram, layout) {
  if (!diagram?.floors?.length || !layout?.stackItems?.length) return [];

  const regions = [];
  for (const item of layout.stackItems) {
    if (item.kind !== "floor" || !item.floor) continue;

    const floor = item.floor;
    const totalArea = getStackingFloorTotalArea(floor);
    if (!(totalArea > 0)) continue;

    let x = item.x;
    for (const [segmentIndex, segment] of (floor.segments ?? []).entries()) {
      const remainingWidth = item.x + item.width - x;
      const segmentWidth = segmentIndex === floor.segments.length - 1
        ? remainingWidth
        : item.width * (getStackingSegmentArea(segment) / totalArea);

      if (segmentWidth > 0 && item.height > 0) {
        regions.push({
          centerX: x + segmentWidth / 2,
          centerY: item.y + item.height / 2,
          floor,
          floorItem: item,
          floorKey: floor.key,
          height: item.height,
          segment,
          segmentIndex,
          width: segmentWidth,
          x,
          y: item.y,
        });
      }

      x += segmentWidth;
    }
  }

  return regions;
}

function findStackingSegmentHitRegion(regions, point) {
  if (!point) return null;

  for (const region of regions ?? []) {
    if (
      point.x >= region.x &&
      point.x <= region.x + region.width &&
      point.y >= region.y &&
      point.y <= region.y + region.height
    ) {
      return region;
    }
  }

  return null;
}

function createStackingSegmentDrag(pointerId, hitRegion, point) {
  const center = {
    x: hitRegion.centerX,
    y: hitRegion.centerY,
  };

  return {
    currentPoint: point,
    pointerId,
    pointerOffset: {
      x: point.x - center.x,
      y: point.y - center.y,
    },
    segment: { ...hitRegion.segment },
    sourceFloorKey: hitRegion.floorKey,
    sourceSegmentIndex: hitRegion.segmentIndex,
    startCenter: center,
    startPoint: point,
    startRect: {
      height: hitRegion.height,
      width: hitRegion.width,
    },
  };
}

function getStackingDragPreview(diagram, layout, drag) {
  if (!diagram?.floors?.length || !layout?.stackItems?.length || !drag) return null;

  const draggedSegment = getStackingDraggedSegment(diagram, drag);
  if (!draggedSegment) return null;

  const draggedCenter = getStackingDraggedCenter(drag);
  const sourceFloorItem = getStackingFloorLayoutItem(layout, drag.sourceFloorKey);
  const isOverSourceFloor = sourceFloorItem ? isStackingYInsideFloorItem(draggedCenter.y, sourceFloorItem) : false;
  const targetFloorItem = isOverSourceFloor ? sourceFloorItem : getStackingFloorLayoutItemAtY(layout, draggedCenter.y);
  const targetFloorKey = targetFloorItem?.floor?.key ?? null;
  const targetSegmentIndex = targetFloorItem
    ? getStackingDragInsertionIndex(diagram, targetFloorItem, drag, draggedSegment, draggedCenter.x)
    : null;

  return {
    diagram: moveStackingSegmentInDiagram(diagram, drag, targetFloorKey, targetSegmentIndex, draggedSegment),
    draggedCenter,
    draggedRect: drag.startRect,
    draggedSegment,
    targetFloorKey,
    targetSegmentIndex,
  };
}

function getStackingDraggedCenter(drag) {
  const point = drag.currentPoint ?? drag.startPoint;
  return {
    x: point.x - drag.pointerOffset.x,
    y: point.y - drag.pointerOffset.y,
  };
}

function getStackingDraggedSegment(diagram, drag) {
  const sourceFloor = (diagram?.floors ?? []).find((floor) => floor.key === drag.sourceFloorKey);
  return sourceFloor?.segments?.[drag.sourceSegmentIndex] ?? drag.segment ?? null;
}

function getStackingFloorByKey(diagram, floorKey) {
  return (diagram?.floors ?? []).find((floor) => floor.key === floorKey) ?? null;
}

function getStackingFloorLayoutItem(layout, floorKey) {
  return (layout?.stackItems ?? []).find((item) => item.kind === "floor" && item.floor?.key === floorKey) ?? null;
}

function getStackingFloorLayoutItemAtY(layout, y) {
  return (layout?.stackItems ?? []).find((item) => item.kind === "floor" && isStackingYInsideFloorItem(y, item)) ?? null;
}

function isStackingYInsideFloorItem(y, item) {
  return y >= item.y && y <= item.y + item.height;
}

function getStackingDragInsertionIndex(diagram, targetFloorItem, drag, draggedSegment, draggedCenterX) {
  const targetFloorKey = targetFloorItem.floor?.key;
  const targetFloor = (diagram?.floors ?? []).find((floor) => floor.key === targetFloorKey);
  if (!targetFloor) return null;

  const otherSegments = getStackingFloorSegmentsWithoutDragged(targetFloor, targetFloorKey, drag);
  const slotCenters = Array.from({ length: otherSegments.length + 1 }, (_unused, slotIndex) =>
    getStackingDragSlotCenter(targetFloorItem, otherSegments, draggedSegment, slotIndex),
  );

  for (let slotIndex = 0; slotIndex < slotCenters.length - 1; slotIndex += 1) {
    const midpoint = (slotCenters[slotIndex] + slotCenters[slotIndex + 1]) / 2;
    if (draggedCenterX < midpoint) return slotIndex;
  }

  return Math.max(0, slotCenters.length - 1);
}

function getStackingDragSlotCenter(floorItem, otherSegments, draggedSegment, slotIndex) {
  const segments = [
    ...otherSegments.slice(0, slotIndex),
    draggedSegment,
    ...otherSegments.slice(slotIndex),
  ];
  const totalArea = getStackingSegmentsTotalArea(segments);

  if (!(totalArea > 0)) return floorItem.x + floorItem.width / 2;

  let x = floorItem.x;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const remainingWidth = floorItem.x + floorItem.width - x;
    const segmentWidth = segmentIndex === segments.length - 1
      ? remainingWidth
      : floorItem.width * (getStackingSegmentArea(segment) / totalArea);

    if (segmentIndex === slotIndex) return x + segmentWidth / 2;
    x += segmentWidth;
  }

  return floorItem.x + floorItem.width / 2;
}

function getStackingFloorSegmentsWithoutDragged(floor, floorKey, drag) {
  const segments = floor?.segments ?? [];
  if (floorKey !== drag.sourceFloorKey) return [...segments];
  return segments.filter((_segment, segmentIndex) => segmentIndex !== drag.sourceSegmentIndex);
}

function moveStackingSegmentInDiagram(diagram, drag, targetFloorKey, targetSegmentIndex, draggedSegment) {
  if (!diagram?.floors?.length || !draggedSegment) return diagram;

  return {
    ...diagram,
    floors: diagram.floors.map((floor) => {
      let segments = [...(floor.segments ?? [])];

      if (floor.key === drag.sourceFloorKey) {
        segments = segments.filter((_segment, segmentIndex) => segmentIndex !== drag.sourceSegmentIndex);
      }

      if (floor.key === targetFloorKey && targetSegmentIndex != null) {
        const insertIndex = clamp(targetSegmentIndex, 0, segments.length);
        segments = [
          ...segments.slice(0, insertIndex),
          { ...draggedSegment },
          ...segments.slice(insertIndex),
        ];
      }

      return normalizeStackingFloorSegments({ ...floor, segments }, getStackingFloorWidth(diagram, floor));
    }),
  };
}

function updateStackingDiagramToMatchConflictFloor(diagram, conflict, spreadsheetFloorValue) {
  if (!diagram?.floors?.length) return { diagram, matched: false, changed: false };

  const segmentLocation = findStackingConflictDiagramSegment(diagram, conflict);
  if (!segmentLocation) return { diagram, matched: false, changed: false };

  const useSourceFloorMetadata = doFloorValuesMatch(spreadsheetFloorValue, conflict.sourceFloorValue);
  const floorResult = ensureStackingDiagramFloorForValue(
    diagram,
    spreadsheetFloorValue,
    useSourceFloorMetadata ? conflict.sourceFloorKey : "",
    useSourceFloorMetadata ? conflict.sourceFloorLabel : "",
  );
  if (!floorResult.floorKey) return { diagram, matched: false, changed: false };

  if (segmentLocation.floorKey === floorResult.floorKey) {
    return {
      diagram: floorResult.diagram,
      matched: true,
      changed: floorResult.diagram !== diagram,
    };
  }

  const targetSegmentIndex = getStackingDiagramConflictInsertIndex(
    floorResult.diagram,
    floorResult.floorKey,
    segmentLocation.segment,
  );
  const nextDiagram = moveStackingSegmentInDiagram(
    floorResult.diagram,
    {
      sourceFloorKey: segmentLocation.floorKey,
      sourceSegmentIndex: segmentLocation.segmentIndex,
    },
    floorResult.floorKey,
    targetSegmentIndex,
    segmentLocation.segment,
  );

  return {
    diagram: nextDiagram,
    matched: true,
    changed: nextDiagram !== diagram,
  };
}

function findStackingConflictDiagramSegment(diagram, conflict) {
  const conflictRowIds = new Set((conflict.rowIds ?? []).map((rowId) => String(rowId)));
  const normalizedSegmentLabel = normalizeStackingGroupKey(conflict.segmentLabel ?? "");
  const preferredFloorKeys = [
    conflict.targetFloorKey,
    findStackingDiagramFloorForValue(diagram, conflict.targetFloorValue)?.key,
  ].filter(Boolean);
  const orderedFloors = [
    ...preferredFloorKeys
      .map((floorKey) => getStackingFloorByKey(diagram, floorKey))
      .filter(Boolean),
    ...(diagram.floors ?? []),
  ];
  const visitedFloorKeys = new Set();
  let fallbackMatch = null;

  for (const floor of orderedFloors) {
    if (!floor || visitedFloorKeys.has(floor.key)) continue;
    visitedFloorKeys.add(floor.key);

    for (const [segmentIndex, segment] of (floor.segments ?? []).entries()) {
      const sourceItemIds = new Set((segment.sourceItemIds ?? []).map((rowId) => String(rowId)));
      const hasSourceItemMatch =
        conflictRowIds.size > 0 &&
        [...conflictRowIds].some((rowId) => sourceItemIds.has(rowId));
      if (hasSourceItemMatch) {
        return {
          floorKey: floor.key,
          segment,
          segmentIndex,
        };
      }

      if (
        !fallbackMatch &&
        normalizedSegmentLabel &&
        normalizeStackingGroupKey(segment.label ?? segment.key ?? "") === normalizedSegmentLabel
      ) {
        fallbackMatch = {
          floorKey: floor.key,
          segment,
          segmentIndex,
        };
      }
    }
  }

  return fallbackMatch;
}

function ensureStackingDiagramFloorForValue(diagram, floorValue, preferredFloorKey = "", preferredFloorLabel = "") {
  const existingFloor = findStackingDiagramFloorForValue(diagram, floorValue, preferredFloorKey);
  if (existingFloor) {
    return {
      diagram,
      floorKey: existingFloor.key,
    };
  }

  const floorNumber = floorNumberFromLabel(floorValue) ?? getFiniteNumber(floorValue);
  if (floorNumber == null) return { diagram, floorKey: null };

  const existingFloorKeys = new Set((diagram.floors ?? []).map((floor) => floor.key));
  const floorKey = createUniqueStackingFloorKey(String(preferredFloorKey || floorNumber), existingFloorKeys);
  const floorLabel = preferredFloorLabel && doFloorValuesMatch(preferredFloorLabel, floorValue)
    ? preferredFloorLabel
    : `Floor ${formatEditableNumber(floorNumber)}`;
  const nextFloors = [
    ...(diagram.floors ?? []),
    {
      key: floorKey,
      number: floorNumber,
      label: floorLabel,
      height: getPositiveStackingDimension(diagram.floorHeight, 12),
      totalArea: 0,
      segments: [],
    },
  ].sort((a, b) => a.number - b.number);

  return {
    diagram: {
      ...diagram,
      floors: nextFloors,
      slabs: createStackingSlabsForFloors(nextFloors, getPositiveStackingDimension(diagram.slabHeight, 1)),
    },
    floorKey,
  };
}

function findStackingDiagramFloorForValue(diagram, floorValue, preferredFloorKey = "") {
  const floors = diagram?.floors ?? [];
  const preferredFloor = preferredFloorKey ? floors.find((floor) => floor.key === preferredFloorKey) : null;
  if (preferredFloor && doFloorValuesMatch(getStackingConflictFloorValue(preferredFloor, preferredFloor.key), floorValue)) {
    return preferredFloor;
  }

  return floors.find((floor) => doFloorValuesMatch(getStackingConflictFloorValue(floor, floor.key), floorValue)) ?? null;
}

function createUniqueStackingFloorKey(baseKey, existingFloorKeys) {
  const normalizedBaseKey = String(baseKey || "floor").trim() || "floor";
  if (!existingFloorKeys.has(normalizedBaseKey)) return normalizedBaseKey;

  let index = 2;
  while (existingFloorKeys.has(`${normalizedBaseKey}-${index}`)) index += 1;
  return `${normalizedBaseKey}-${index}`;
}

function getStackingDiagramConflictInsertIndex(diagram, targetFloorKey, draggedSegment) {
  const targetFloor = getStackingFloorByKey(diagram, targetFloorKey);
  const targetSegments = targetFloor?.segments ?? [];
  const draggedSortOrder = getFiniteNumber(draggedSegment?.sortOrder);
  if (draggedSortOrder == null) return targetSegments.length;

  const insertIndex = targetSegments.findIndex((segment) => {
    const sortOrder = getFiniteNumber(segment?.sortOrder);
    return sortOrder != null && sortOrder > draggedSortOrder;
  });
  return insertIndex === -1 ? targetSegments.length : insertIndex;
}

function normalizeStackingFloorSegments(floor, diagramWidth) {
  const width = Math.max(STACKING_MIN_DIMENSION_FEET, getFiniteNumber(diagramWidth) ?? 100);
  const segments = (floor.segments ?? []).map((segment) => ({ ...segment }));
  const totalArea = getStackingSegmentsTotalArea(segments);

  return {
    ...floor,
    totalArea,
    segments: segments.map((segment) => ({
      ...segment,
      width: totalArea > 0 ? roundArea((getStackingSegmentArea(segment) / totalArea) * width) : 0,
    })),
  };
}

function getStackingSegmentsTotalArea(segments) {
  return roundArea((segments ?? []).reduce((sum, segment) => sum + getStackingSegmentArea(segment), 0));
}

function getStackingFloorTotalArea(floor) {
  const totalArea = getFiniteNumber(floor?.totalArea);
  if (totalArea != null && totalArea >= 0) return totalArea;
  return getStackingSegmentsTotalArea(floor?.segments ?? []);
}

function getStackingSegmentArea(segment) {
  return Math.max(0, getFiniteNumber(segment?.area) ?? 0);
}

function isStackingDragCommitChange(preview, drag) {
  return Boolean(
    preview?.diagram &&
    preview.targetFloorKey != null &&
    preview.targetSegmentIndex != null &&
    (preview.targetFloorKey !== drag.sourceFloorKey || preview.targetSegmentIndex !== drag.sourceSegmentIndex),
  );
}

function buildHealthcareStackingDiagram(programData, settings = createDefaultStackingSettings()) {
  if (!programData) throw new Error("The selected source could not be loaded.");

  const normalizedSettings = {
    ...createDefaultStackingSettings(),
    ...settings,
  };
  const feet = Math.max(0, parseEditableNumber(normalizedSettings.defaultFloorToFloorFeet));
  const inches = clamp(parseEditableNumber(normalizedSettings.defaultFloorToFloorInches), 0, 11);
  const rawFloorHeight = feet + inches / 12;
  const floorHeight = rawFloorHeight > 0 ? rawFloorHeight : 12;
  const floorHeightOverrides = normalizeStackingFloorHeightOverrides(normalizedSettings.floorHeights);
  const floorOffsetOverrides = normalizeStackingFloorOffsetOverrides(normalizedSettings.floorOffsets);
  const floorWidthOverrides = normalizeStackingFloorWidthOverrides(normalizedSettings.floorWidths);
  const slabHeight = parsePositiveDiagramNumber(normalizedSettings.slabHeight, 1);
  const slabHeightOverrides = normalizeStackingSlabHeightOverrides(normalizedSettings.slabHeights);
  const defaultWidth = parsePositiveDiagramNumber(normalizedSettings.defaultWidth, 100);
  const textSize = parsePositiveDiagramNumber(normalizedSettings.textSize, 12);
  const areaMode = normalizedSettings.grossSquareFootage ? "gross" : "net";
  const departmentsById = new Map((programData.departments ?? []).map((department) => [department.id, department]));
  const groupsById = new Map((programData.program_groups ?? []).map((group) => [group.id, group]));
  const floorsById = new Map((programData.floors ?? []).map((floor) => [floor.id, floor]));
  const floorsByNumber = new Map();
  const hierarchyColorLookup = buildProgramHierarchyColorLookup(programData);
  const effectiveLevelOfDetail = getEffectiveProgramHierarchyLevel(
    normalizedSettings.levelOfDetail,
    hierarchyColorLookup.availableLevels,
  );

  for (const item of programData.program_items ?? []) {
    const group = groupsById.get(item.program_group_id);
    const department = departmentsById.get(group?.department_id ?? item.extensions?.department_id);
    const diagramFloorId = getProgramItemDiagramFloorId(item);
    const sourceFloor = floorsById.get(diagramFloorId);
    const floorNumber = getStackingFloorNumber(item, sourceFloor, diagramFloorId);
    const floorKey = String(floorNumber);
    const detail = getStackingDetailForItem(item, group, department, effectiveLevelOfDetail);
    const netArea = getProgramItemNetArea(item);
    const grossArea = getProgramItemGrossArea(item, department, netArea);
    const activeArea = areaMode === "gross" ? grossArea : netArea;
    const hierarchyColor = getProgramHierarchyColorForItemLevel(
      hierarchyColorLookup,
      item,
      group,
      department,
      effectiveLevelOfDetail,
    );

    if (!(activeArea > 0)) continue;

    if (!floorsByNumber.has(floorKey)) {
      floorsByNumber.set(floorKey, {
        key: floorKey,
        number: floorNumber,
        label: sourceFloor?.name || `Floor ${floorNumber}`,
        height: getStackingFloorHeightWithOverride(
          floorHeightOverrides,
          floorHeight,
          floorKey,
          floorNumber,
          diagramFloorId,
        ),
        width: getStackingFloorWidthWithOverride(
          floorWidthOverrides,
          defaultWidth,
          floorKey,
          floorNumber,
          diagramFloorId,
        ),
        x: getStackingFloorOffsetWithOverride(
          floorOffsetOverrides,
          0,
          floorKey,
          floorNumber,
          diagramFloorId,
        ),
        segmentsByKey: new Map(),
      });
    }

    const floor = floorsByNumber.get(floorKey);
    const segmentKey = getProgramHierarchySegmentKeyForItemLevel(
      hierarchyColorLookup,
      item,
      group,
      department,
      effectiveLevelOfDetail,
    ) ?? normalizeStackingGroupKey(detail.label);
    const existingSegment = floor.segmentsByKey.get(segmentKey);
    const segment = existingSegment ?? {
      key: segmentKey,
      label: detail.label,
      sortOrder: detail.sortOrder,
      area: 0,
      netArea: 0,
      grossArea: 0,
      color: hierarchyColor ?? colorForStackingLabel(detail.label),
      sourceItemIds: [],
    };

    segment.area = roundArea(segment.area + activeArea);
    segment.netArea = roundArea(segment.netArea + netArea);
    segment.grossArea = roundArea(segment.grossArea + grossArea);
    segment.sortOrder = Math.min(segment.sortOrder, detail.sortOrder);
    if (item.id) segment.sourceItemIds.push(item.id);
    floor.segmentsByKey.set(segmentKey, segment);
  }

  const floors = [...floorsByNumber.values()]
    .map((floor) => {
      const segments = [...floor.segmentsByKey.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
      const totalArea = roundArea(segments.reduce((sum, segment) => sum + segment.area, 0));

      return {
        key: floor.key,
        number: floor.number,
        label: floor.label,
        height: floor.height,
        width: floor.width,
        x: floor.x,
        totalArea,
        segments: segments.map((segment) => ({
          ...segment,
          sourceItemIds: [...new Set(segment.sourceItemIds ?? [])],
          width: totalArea > 0 ? roundArea((segment.area / totalArea) * floor.width) : 0,
        })),
      };
    })
    .filter((floor) => floor.totalArea > 0)
    .sort((a, b) => a.number - b.number);

  return {
    projectName: getProgramTitle(programData),
    levelOfDetail: effectiveLevelOfDetail,
    defaultWidth,
    floorHeight,
    slabHeight,
    slabs: createStackingSlabsForFloors(floors, slabHeight, slabHeightOverrides),
    textSize,
    areaMode,
    showGross: Boolean(normalizedSettings.grossSquareFootage),
    showNet: Boolean(normalizedSettings.netSquareFootage),
    floors,
  };
}

function getStackingDiagramLayout(diagram, size, zoom = 1, viewOffset = { x: 0, y: 0 }) {
  const canvasWidth = Math.max(1, size.width);
  const canvasHeight = Math.max(1, size.height);
  const offsetX = getFiniteNumber(viewOffset?.x) ?? 0;
  const offsetY = getFiniteNumber(viewOffset?.y) ?? 0;
  const emptyLayout = {
    buildingHeight: 0,
    buildingWidth: 0,
    buildingX: 0,
    buildingY: 0,
    dimensionInputs: [],
    horizontalDimensionY: 0,
    layoutX: 0,
    layoutY: 0,
    modelLeft: 0,
    modelOriginX: 0,
    modelRight: 0,
    scale: 1,
    stackItems: [],
    verticalDimensionX: 0,
  };

  if (!diagram?.floors?.length) return emptyLayout;

  const defaultWidth = Math.max(STACKING_MIN_DIMENSION_FEET, getFiniteNumber(diagram.defaultWidth) ?? 100);
  const modelBounds = getStackingDiagramModelBounds(diagram, defaultWidth);
  const modelWidth = modelBounds.width;
  const stackItems = getStackingStackItems(diagram);
  const modelHeight = Math.max(
    STACKING_MIN_DIMENSION_FEET,
    stackItems.reduce((sum, item) => sum + item.value, 0),
  );
  const normalizedZoom = clamp(zoom, STACKING_MIN_ZOOM, STACKING_MAX_ZOOM);
  const verticalDimensionOffset = clamp(modelWidth * 0.12, 8, 18);
  const horizontalDimensionOffset = clamp(modelHeight * 0.08, 7, 16);
  const padding = {
    left: canvasWidth < 620 ? 96 : 126,
    right: canvasWidth < 620 ? 74 : 116,
    top: 34,
    bottom: 88,
  };
  const availableWidth = Math.max(1, canvasWidth - padding.left - padding.right);
  const availableHeight = Math.max(1, canvasHeight - padding.top - padding.bottom);
  const modelLayoutWidth = modelWidth + verticalDimensionOffset;
  const modelLayoutHeight = modelHeight + horizontalDimensionOffset;
  const fitScale = Math.max(0.1, Math.min(availableWidth / modelLayoutWidth, availableHeight / modelLayoutHeight));
  const scale = fitScale * normalizedZoom;
  const layoutWidth = modelLayoutWidth * scale;
  const layoutHeight = modelLayoutHeight * scale;
  const layoutX = padding.left + Math.max(0, (availableWidth - layoutWidth) / 2) + offsetX;
  const layoutY = padding.top + Math.max(0, (availableHeight - layoutHeight) / 2) + offsetY;
  const buildingX = layoutX + verticalDimensionOffset * scale;
  const buildingY = layoutY;
  const buildingWidth = modelWidth * scale;
  const buildingHeight = modelHeight * scale;
  const modelOriginX = buildingX + (0 - modelBounds.left) * scale;
  const verticalDimensionX = layoutX;
  const horizontalDimensionY = buildingY + buildingHeight + horizontalDimensionOffset * scale;
  let y = buildingY;

  const layoutStackItems = stackItems.map((item) => {
    const height = item.value * scale;
    const isFloor = item.kind === "floor" && item.floor;
    const modelX = isFloor ? getStackingFloorX(item.floor) : modelBounds.left;
    const modelItemWidth = isFloor ? getStackingFloorWidth(diagram, item.floor) : modelWidth;
    const layoutItem = {
      ...item,
      height,
      modelHeight: item.value,
      modelWidth: modelItemWidth,
      modelX,
      width: modelItemWidth * scale,
      x: isFloor ? modelOriginX + modelX * scale : buildingX,
      y,
    };
    y += height;
    return layoutItem;
  });

  return {
    buildingHeight,
    buildingWidth,
    buildingX,
    buildingY,
    dimensionInputs: [
      ...layoutStackItems.map((item) => ({
        ariaLabel: item.kind === "floor" ? `${item.floor.label} height` : `${item.label} height`,
        floorKey: item.floor?.key,
        kind: item.kind,
        key: item.dimensionKey,
        left: verticalDimensionX - (item.kind === "slab" ? 38 : 0),
        orientation: "vertical",
        slabKey: item.slabKey,
        slabIndex: item.slabIndex,
        top: item.y + item.height / 2,
        value: item.value,
      })),
      {
        ariaLabel: "Overall stacking diagram width",
        kind: "width",
        key: "width",
        left: buildingX + buildingWidth / 2,
        orientation: "horizontal",
        top: horizontalDimensionY,
        value: modelWidth,
      },
    ],
    horizontalDimensionY,
    layoutX,
    layoutY,
    modelLeft: modelBounds.left,
    modelOriginX,
    modelRight: modelBounds.right,
    scale,
    stackItems: layoutStackItems,
    verticalDimensionX,
  };
}

function getStackingZoomedViewOffset(diagram, size, currentZoom, nextZoom, currentOffset, anchorPoint) {
  const currentLayout = getStackingDiagramLayout(diagram, size, currentZoom, { x: 0, y: 0 });
  const nextLayout = getStackingDiagramLayout(diagram, size, nextZoom, { x: 0, y: 0 });

  if (!currentLayout.scale || !nextLayout.scale) return currentOffset;

  const modelX = (anchorPoint.x - currentLayout.layoutX - currentOffset.x) / currentLayout.scale;
  const modelY = (anchorPoint.y - currentLayout.layoutY - currentOffset.y) / currentLayout.scale;

  return {
    x: anchorPoint.x - nextLayout.layoutX - modelX * nextLayout.scale,
    y: anchorPoint.y - nextLayout.layoutY - modelY * nextLayout.scale,
  };
}

function getStackingStackItems(diagram) {
  const orderedFloors = getOrderedStackingFloors(diagram);
  const slabs = getStackingSlabs(diagram);
  const stackItems = [];

  for (const [floorIndex, floor] of orderedFloors.entries()) {
    stackItems.push({
      dimensionKey: `floor:${floor.key}`,
      floor,
      kind: "floor",
      label: floor.label,
      value: getStackingFloorHeight(diagram, floor),
    });

    if (floorIndex < orderedFloors.length - 1) {
      const slab = slabs[floorIndex];
      stackItems.push({
        dimensionKey: slab?.key ?? `slab:${floorIndex}`,
        kind: "slab",
        label: slab.label,
        slabKey: slab.key,
        slabIndex: floorIndex,
        value: getPositiveStackingDimension(slab?.height, diagram?.slabHeight, 1),
      });
    }
  }

  return stackItems;
}

function getOrderedStackingFloors(diagram) {
  return [...(diagram?.floors ?? [])].sort((a, b) => b.number - a.number);
}

function getStackingDiagramModelBounds(diagram, defaultWidth = 100) {
  let left = 0;
  let right = Math.max(STACKING_MIN_DIMENSION_FEET, getFiniteNumber(defaultWidth) ?? 100);

  for (const floor of diagram?.floors ?? []) {
    const bounds = getStackingFloorBounds(diagram, floor);
    left = Math.min(left, bounds.left);
    right = Math.max(right, bounds.right);
  }

  if (!(right > left)) right = left + STACKING_MIN_DIMENSION_FEET;

  return {
    left,
    right,
    width: Math.max(STACKING_MIN_DIMENSION_FEET, right - left),
  };
}

function getStackingFloorBounds(diagram, floor) {
  const left = getStackingFloorX(floor);
  const width = getStackingFloorWidth(diagram, floor);
  return {
    left,
    right: left + width,
    width,
  };
}

function getStackingFloorX(floor) {
  return roundArea(getFiniteNumber(floor?.x) ?? 0);
}

function getStackingFloorWidth(diagram, floor) {
  return getPositiveStackingDimension(floor?.width, diagram?.defaultWidth, 100);
}

function getStackingFloorHeight(diagram, floor) {
  return getPositiveStackingDimension(floor?.height, diagram?.floorHeight, 12);
}

function getPositiveStackingDimension(...values) {
  for (const value of values) {
    const parsedValue = getFiniteNumber(value);
    if (parsedValue != null && parsedValue > 0) return Math.max(STACKING_MIN_DIMENSION_FEET, parsedValue);
  }

  return STACKING_MIN_DIMENSION_FEET;
}

function createStackingSlabsForFloors(floors, slabHeight, slabHeightOverrides = {}) {
  const orderedFloors = [...(floors ?? [])].sort((a, b) => b.number - a.number);
  return orderedFloors.slice(0, -1).map((floor, index) => {
    const lowerFloor = orderedFloors[index + 1];
    const slabKey = createStackingSlabKey(floor.key, lowerFloor.key);
    return {
      height: getStackingSlabHeightWithOverride(slabHeightOverrides, slabHeight, slabKey, floor.key, lowerFloor.key),
      key: slabKey,
      label: "Slab",
    };
  });
}

function createStackingSlabKey(upperFloorKey, lowerFloorKey) {
  return `slab:${upperFloorKey}:${lowerFloorKey}`;
}

function getStackingSlabs(diagram) {
  const slabCount = Math.max(0, (diagram?.floors?.length ?? 0) - 1);
  const existingSlabs = Array.isArray(diagram?.slabs) ? diagram.slabs : [];
  const defaultSlabHeight = getPositiveStackingDimension(diagram?.slabHeight, 1);

  return Array.from({ length: slabCount }, (_, index) => ({
    height: getPositiveStackingDimension(existingSlabs[index]?.height, defaultSlabHeight),
    key: existingSlabs[index]?.key ?? `slab:${index}`,
    label: existingSlabs[index]?.label ?? "Slab",
  }));
}

function updateStackingDiagramDimension(diagram, dimension, value) {
  const nextValue = roundArea(Math.max(STACKING_MIN_DIMENSION_FEET, value));

  if (dimension.kind === "width") {
    return updateStackingDiagramWidth(diagram, nextValue);
  }

  if (dimension.kind === "floor") {
    return {
      ...diagram,
      floors: diagram.floors.map((floor) =>
        floor.key === dimension.floorKey
          ? {
              ...floor,
              height: nextValue,
            }
          : floor,
      ),
    };
  }

  if (dimension.kind === "slab") {
    const slabs = getStackingSlabs(diagram).map((slab, index) =>
      slab.key === dimension.slabKey || (!dimension.slabKey && index === dimension.slabIndex)
        ? {
            ...slab,
            height: nextValue,
          }
        : slab,
    );

    return {
      ...diagram,
      slabs,
    };
  }

  return diagram;
}

function updateStackingDiagramWidth(diagram, width) {
  const currentWidth = Math.max(STACKING_MIN_DIMENSION_FEET, getFiniteNumber(diagram?.defaultWidth) ?? width);
  const scale = currentWidth > 0 ? width / currentWidth : 1;

  return {
    ...diagram,
    defaultWidth: width,
    floors: diagram.floors.map((floor) => ({
      ...floor,
      width: roundArea(getStackingFloorWidth(diagram, floor) * scale),
      x: roundArea(getStackingFloorX(floor) * scale),
      segments: floor.segments.map((segment) => ({
        ...segment,
        width: floor.totalArea > 0 ? roundArea((segment.area / floor.totalArea) * getStackingFloorWidth(diagram, floor) * scale) : 0,
      })),
    })),
  };
}

function parseDimensionInputValue(value) {
  const normalizedValue = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[’′]/g, "'")
    .replace(/[“”″]/g, "\"")
    .trim()
    .toLowerCase();

  if (!normalizedValue) return null;

  const formattedImperialMatch = normalizedValue.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*-\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?$/);
  if (formattedImperialMatch) {
    const feet = Number(formattedImperialMatch[1]);
    const inches = Number(formattedImperialMatch[2]);
    const parsedValue = feet + inches / 12;
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }

  const imperialMatch = normalizedValue.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (imperialMatch) {
    const feet = Number(imperialMatch[1]);
    const inches = Number(imperialMatch[2] ?? 0);
    const parsedValue = feet + inches / 12;
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }

  const dashMatch = normalizedValue.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?$/);
  if (dashMatch) {
    const feet = Number(dashMatch[1]);
    const inches = Number(dashMatch[2]);
    const parsedValue = feet + inches / 12;
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }

  const inchesMatch = normalizedValue.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (inchesMatch) {
    const parsedValue = Number(inchesMatch[1]) / 12;
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function formatDimensionInputValue(value) {
  const totalInches = Math.max(0, Math.round((getFiniteNumber(value) ?? 0) * 12));
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'-${inches}"`;
}

function getDimensionEditorWidth(value) {
  const characterCount = clamp(String(value ?? "").length || 1, 4, 24);
  return `calc(${characterCount}ch + 14px)`;
}

function drawStackingDiagram(canvas, diagram, size, layout, options = {}) {
  if (!canvas) return;

  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const pixelRatio = Math.max(1, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const scaledWidth = Math.round(width * pixelRatio);
  const scaledHeight = Math.round(height * pixelRatio);

  if (canvas.width !== scaledWidth) canvas.width = scaledWidth;
  if (canvas.height !== scaledHeight) canvas.height = scaledHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!diagram?.floors?.length || !layout?.stackItems?.length) return;

  const labelFontSize = clamp(diagram.textSize, 7, 30);
  const dragPreview = options.dragPreview ?? null;
  const floorResizePreview = options.floorResizePreview ?? null;
  const dragHighlightRects = [];

  ctx.lineJoin = "miter";

  for (const item of layout.stackItems) {
    if (item.kind === "slab") {
      drawStackingSlab(ctx, item.x, item.y, item.width, item.height);
      continue;
    }

    const floor = item.floor;
    const totalArea = getStackingFloorTotalArea(floor);
    let x = item.x;

    for (const [segmentIndex, segment] of floor.segments.entries()) {
      const remainingWidth = item.x + item.width - x;
      const segmentWidth = segmentIndex === floor.segments.length - 1
        ? remainingWidth
        : item.width * (getStackingSegmentArea(segment) / totalArea);
      const isDragPreviewSegment = isStackingDragPreviewSegment(dragPreview, floor.key, segmentIndex);

      if (dragPreview && !isDragPreviewSegment) {
        ctx.save();
        ctx.globalAlpha = 0.64;
        drawStackingSegment(ctx, segment, x, item.y, segmentWidth, item.height, diagram, labelFontSize);
        ctx.restore();
      } else {
        drawStackingSegment(ctx, segment, x, item.y, segmentWidth, item.height, diagram, labelFontSize);
      }

      if (isDragPreviewSegment) {
        dragHighlightRects.push({ height: item.height, width: segmentWidth, x, y: item.y });
      }
      x += segmentWidth;
    }

    ctx.strokeStyle = "#0a0a0a";
    ctx.lineWidth = 1;
    ctx.strokeRect(item.x, item.y, item.width, item.height);
    drawStackingFloorLabel(ctx, floor, item.x + item.width + 10, item.y + item.height / 2, diagram);
  }

  drawStackingDimensions(ctx, layout);
  drawStackingFloorResizePreview(ctx, floorResizePreview, layout);
  drawStackingDragPreview(ctx, dragPreview, dragHighlightRects, diagram, labelFontSize);
}

function drawStackingFloorResizePreview(ctx, floorResizePreview, layout) {
  if (!floorResizePreview) return;

  const item = getStackingFloorLayoutItem(layout, floorResizePreview.floorKey);
  if (!item) return;

  const edgeX = floorResizePreview.edge === "left" ? item.x : item.x + item.width;

  ctx.save();
  ctx.strokeStyle = "#1a5cff";
  ctx.lineWidth = 2;
  drawCanvasLine(ctx, edgeX, item.y, edgeX, item.y + item.height);

  if (floorResizePreview.snapCandidate) {
    const snapX = layout.modelOriginX + floorResizePreview.snapCandidate.value * layout.scale;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    drawCanvasLine(ctx, snapX, layout.buildingY, snapX, layout.buildingY + layout.buildingHeight);
  }

  ctx.restore();
}

function isStackingDragPreviewSegment(dragPreview, floorKey, segmentIndex) {
  return Boolean(
    dragPreview?.targetFloorKey === floorKey &&
    dragPreview.targetSegmentIndex === segmentIndex,
  );
}

function drawStackingDragPreview(ctx, dragPreview, highlightRects, diagram, labelFontSize) {
  if (!dragPreview) return;

  if (dragPreview.targetFloorKey != null) {
    for (const rect of highlightRects) {
      drawStackingDragOutline(ctx, rect.x, rect.y, rect.width, rect.height);
    }
    return;
  }

  const width = Math.max(24, dragPreview.draggedRect?.width ?? 72);
  const height = Math.max(18, dragPreview.draggedRect?.height ?? 36);
  const x = dragPreview.draggedCenter.x - width / 2;
  const y = dragPreview.draggedCenter.y - height / 2;

  ctx.save();
  ctx.globalAlpha = 0.76;
  drawStackingSegment(ctx, dragPreview.draggedSegment, x, y, width, height, diagram, labelFontSize);
  ctx.restore();
  drawStackingDragOutline(ctx, x, y, width, height);
}

function drawStackingDragOutline(ctx, x, y, width, height) {
  if (width <= 0 || height <= 0) return;

  ctx.save();
  ctx.strokeStyle = "#1a5cff";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
  ctx.restore();
}

function drawStackingSegment(ctx, segment, x, y, width, height, diagram, fontSize) {
  if (width <= 0 || height <= 0) return;

  ctx.fillStyle = getStackingSegmentColor(segment);
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);

  if (width < 28 || height < 18) return;

  const padding = clamp(Math.min(width, height) * 0.08, 4, 8);
  const textWidth = Math.max(1, width - padding * 2);
  const textHeight = Math.max(1, height - padding * 2);
  const lineHeight = fontSize * 1.14;
  const maxLines = Math.max(1, Math.floor(textHeight / lineHeight));

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + padding, y + padding, textWidth, textHeight);
  ctx.clip();

  ctx.fillStyle = "#0a0a0a";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${fontSize}px Arial, sans-serif`;

  const labelLines = wrapCanvasText(ctx, segment.label, textWidth, maxLines);
  const areaLabels = getStackingSegmentAreaLabels(segment, diagram);
  const areaFontSize = clamp(fontSize * 0.82, 7, 24);
  const usedLabelLines = areaLabels.length > 0 && labelLines.length >= maxLines ? labelLines.slice(0, Math.max(1, maxLines - 1)) : labelLines;
  let textY = y + padding;

  for (const line of usedLabelLines.slice(0, maxLines)) {
    ctx.fillText(line, x + padding, textY);
    textY += lineHeight;
  }

  const remainingLines = maxLines - usedLabelLines.length;
  if (remainingLines > 0 && areaLabels.length > 0) {
    ctx.font = `400 ${areaFontSize}px Arial, sans-serif`;
    for (const line of areaLabels.slice(0, remainingLines)) {
      ctx.fillText(truncateCanvasText(ctx, line, textWidth), x + padding, textY);
      textY += lineHeight;
    }
  }

  ctx.restore();
}

function drawStackingSlab(ctx, x, y, width, height) {
  if (width <= 0 || height <= 0) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
}

function drawStackingFloorLabel(ctx, floor, x, y, diagram) {
  ctx.fillStyle = "#0a0a0a";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "700 11px Arial, sans-serif";
  ctx.fillText(floor.label, x, y - 7);
  ctx.font = "400 10px Arial, sans-serif";
  ctx.fillText(`${formatDiagramArea(floor.totalArea)} ${diagram.areaMode === "gross" ? "DGSF" : "NSF"}`, x, y + 7);
}

function drawStackingDimensions(ctx, layout) {
  const {
    buildingX,
    buildingY,
    buildingWidth,
    buildingHeight,
    dimensionInputs,
    horizontalDimensionY,
    stackItems,
    verticalDimensionX,
  } = layout;

  const boundaryYs = [buildingY];
  for (const item of stackItems) boundaryYs.push(item.y + item.height);

  ctx.save();
  ctx.strokeStyle = "#0a0a0a";
  ctx.lineWidth = 1;

  const verticalDimensionDistance = Math.max(1, buildingX - verticalDimensionX);
  const horizontalDimensionDistance = Math.max(1, horizontalDimensionY - (buildingY + buildingHeight));
  const verticalGap = Math.min(STACKING_DIMENSION_EXTENSION_GAP, verticalDimensionDistance * 0.45);
  const horizontalGap = Math.min(STACKING_DIMENSION_EXTENSION_GAP, horizontalDimensionDistance * 0.45);
  const dimensionLineGaps = getStackingDimensionLineGaps(ctx, {
    dimensionInputs,
    horizontalDimensionY,
    verticalDimensionX,
  });

  for (const y of boundaryYs) {
    drawCanvasLine(ctx, verticalDimensionX - STACKING_DIMENSION_EXTENSION_OVERHANG, y, buildingX - verticalGap, y);
    drawDimensionTick(ctx, verticalDimensionX, y);
  }

  drawCanvasLineWithGaps(
    ctx,
    verticalDimensionX,
    buildingY - STACKING_DIMENSION_EXTENSION_OVERHANG,
    verticalDimensionX,
    buildingY + buildingHeight + STACKING_DIMENSION_EXTENSION_OVERHANG,
    dimensionLineGaps.vertical,
  );
  drawCanvasLine(
    ctx,
    buildingX,
    buildingY + buildingHeight + horizontalGap,
    buildingX,
    horizontalDimensionY + STACKING_DIMENSION_EXTENSION_OVERHANG,
  );
  drawCanvasLine(
    ctx,
    buildingX + buildingWidth,
    buildingY + buildingHeight + horizontalGap,
    buildingX + buildingWidth,
    horizontalDimensionY + STACKING_DIMENSION_EXTENSION_OVERHANG,
  );
  drawCanvasLineWithGaps(
    ctx,
    buildingX - STACKING_DIMENSION_EXTENSION_OVERHANG,
    horizontalDimensionY,
    buildingX + buildingWidth + STACKING_DIMENSION_EXTENSION_OVERHANG,
    horizontalDimensionY,
    dimensionLineGaps.horizontal,
  );
  drawDimensionTick(ctx, buildingX, horizontalDimensionY);
  drawDimensionTick(ctx, buildingX + buildingWidth, horizontalDimensionY);

  ctx.restore();
}

function getStackingDimensionLineGaps(ctx, layout) {
  const vertical = [];
  const horizontal = [];
  const dimensionInputs = layout.dimensionInputs ?? [];

  ctx.save();
  ctx.font = STACKING_DIMENSION_LABEL_FONT;

  for (const dimension of dimensionInputs) {
    const labelWidth = Math.min(
      STACKING_DIMENSION_LABEL_WIDTH,
      Math.max(1, ctx.measureText(formatDimensionInputValue(dimension.value)).width + STACKING_DIMENSION_LABEL_TEXT_PADDING * 2),
    );
    const labelLeft = dimension.left - labelWidth / 2;
    const labelRight = dimension.left + labelWidth / 2;
    const labelTop = dimension.top - STACKING_DIMENSION_LABEL_HEIGHT / 2;
    const labelBottom = dimension.top + STACKING_DIMENSION_LABEL_HEIGHT / 2;

    if (
      dimension.orientation === "vertical" &&
      layout.verticalDimensionX >= labelLeft - STACKING_DIMENSION_LABEL_LINE_GAP &&
      layout.verticalDimensionX <= labelRight + STACKING_DIMENSION_LABEL_LINE_GAP
    ) {
      vertical.push([
        labelTop - STACKING_DIMENSION_LABEL_LINE_GAP,
        labelBottom + STACKING_DIMENSION_LABEL_LINE_GAP,
      ]);
    }

    if (
      dimension.orientation === "horizontal" &&
      layout.horizontalDimensionY >= labelTop - STACKING_DIMENSION_LABEL_LINE_GAP &&
      layout.horizontalDimensionY <= labelBottom + STACKING_DIMENSION_LABEL_LINE_GAP
    ) {
      horizontal.push([
        labelLeft - STACKING_DIMENSION_LABEL_LINE_GAP,
        labelRight + STACKING_DIMENSION_LABEL_LINE_GAP,
      ]);
    }
  }

  ctx.restore();
  return { horizontal, vertical };
}

function drawCanvasLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawCanvasLineWithGaps(ctx, x1, y1, x2, y2, gaps = []) {
  const isVertical = Math.abs(x1 - x2) < 0.01;
  const isHorizontal = Math.abs(y1 - y2) < 0.01;

  if ((!isVertical && !isHorizontal) || gaps.length === 0) {
    drawCanvasLine(ctx, x1, y1, x2, y2);
    return;
  }

  const lineStart = isVertical ? y1 : x1;
  const lineEnd = isVertical ? y2 : x2;
  const lineMin = Math.min(lineStart, lineEnd);
  const lineMax = Math.max(lineStart, lineEnd);
  const normalizedGaps = normalizeDimensionLineGaps(gaps, lineMin, lineMax);

  if (normalizedGaps.length === 0) {
    drawCanvasLine(ctx, x1, y1, x2, y2);
    return;
  }

  let cursor = lineMin;
  for (const [gapStart, gapEnd] of normalizedGaps) {
    if (gapStart - cursor > 0.5) {
      drawCanvasLine(
        ctx,
        isVertical ? x1 : cursor,
        isVertical ? cursor : y1,
        isVertical ? x2 : gapStart,
        isVertical ? gapStart : y2,
      );
    }
    cursor = Math.max(cursor, gapEnd);
  }

  if (lineMax - cursor > 0.5) {
    drawCanvasLine(
      ctx,
      isVertical ? x1 : cursor,
      isVertical ? cursor : y1,
      isVertical ? x2 : lineMax,
      isVertical ? lineMax : y2,
    );
  }
}

function normalizeDimensionLineGaps(gaps, lineMin, lineMax) {
  const normalizedGaps = gaps
    .map(([start, end]) => [
      clamp(Math.min(start, end), lineMin, lineMax),
      clamp(Math.max(start, end), lineMin, lineMax),
    ])
    .filter(([start, end]) => end - start > 0.5)
    .sort((a, b) => a[0] - b[0]);

  const mergedGaps = [];
  for (const gap of normalizedGaps) {
    const previousGap = mergedGaps[mergedGaps.length - 1];
    if (!previousGap || gap[0] > previousGap[1]) {
      mergedGaps.push(gap);
      continue;
    }
    previousGap[1] = Math.max(previousGap[1], gap[1]);
  }

  return mergedGaps;
}

function drawDimensionTick(ctx, x, y) {
  const tickSize = 5;
  ctx.beginPath();
  ctx.moveTo(x - tickSize, y + tickSize);
  ctx.lineTo(x + tickSize, y - tickSize);
  ctx.stroke();
}

function getStackingSegmentAreaLabels(segment, diagram) {
  const labels = [];
  if (diagram.showNet) labels.push(`${formatDiagramArea(segment.netArea)} NSF`);
  if (diagram.showGross) labels.push(`${formatDiagramArea(segment.grossArea)} DGSF`);
  return labels;
}

function wrapCanvasText(ctx, text, maxWidth, maxLines) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const word = words[wordIndex];
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) lines.push(currentLine);
    currentLine = word;

    if (lines.length === maxLines) {
      const overflowText = [currentLine, ...words.slice(wordIndex + 1)].join(" ");
      lines[lines.length - 1] = truncateCanvasText(ctx, `${lines[lines.length - 1]} ${overflowText}`, maxWidth);
      return lines;
    }
  }

  if (currentLine) lines.push(currentLine);

  if (lines.length > maxLines) {
    const visibleLines = lines.slice(0, maxLines);
    visibleLines[visibleLines.length - 1] = truncateCanvasText(ctx, lines.slice(maxLines - 1).join(" "), maxWidth);
    return visibleLines;
  }

  return lines.length > 0 ? lines : [""];
}

function truncateCanvasText(ctx, text, maxWidth) {
  const value = String(text ?? "");
  if (ctx.measureText(value).width <= maxWidth) return value;

  let truncated = value;
  while (truncated.length > 1 && ctx.measureText(`${truncated}...`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }

  return `${truncated}...`;
}

function parsePositiveDiagramNumber(value, fallbackValue) {
  const parsed = parseEditableNumber(value);
  return parsed > 0 ? parsed : fallbackValue;
}

function getStackingFloorNumber(item, floor, floorId = item?.floor_id) {
  const floorNumber = getFiniteNumber(floor?.number);
  if (floorNumber != null) return floorNumber;
  return floorNumberFromId(floorId) ?? floorNumberFromLabel(item.extensions?.original_floor_label) ?? floorNumberFromId(item.floor_id) ?? 1;
}

function getProgramItemDiagramValues(item) {
  const values = item?.extensions?.[DIAGRAM_VALUES_EXTENSION_KEY];
  return isPlainObject(values) ? values : {};
}

function getProgramItemExplicitDiagramFloorId(item) {
  const floorId = getProgramItemDiagramValues(item).floor_id;
  return floorId === undefined || floorId === null || floorId === "" ? null : String(floorId);
}

function getProgramItemDiagramFloorId(item) {
  return getProgramItemExplicitDiagramFloorId(item) ?? String(item?.floor_id ?? "");
}

function getStackingDetailForItem(item, group, department, levelOfDetail) {
  const detailSortOrder =
    getFiniteNumber(department?.sort_order) ??
    getFiniteNumber(group?.sort_order) ??
    getFiniteNumber(item.sort_order) ??
    0;
  const level = LEVEL_OF_DETAIL_OPTIONS.some((option) => option.value === levelOfDetail)
    ? levelOfDetail
    : "department";
  const levelLabel = LEVEL_OF_DETAIL_OPTIONS.find((option) => option.value === level)?.label ?? "Program";

  return {
    label: getProgramHierarchyLevelLabel(level, null, item, group, department) || `Unlabeled ${levelLabel}`,
    sortOrder: getProgramHierarchyLevelSortOrder(level, item, group, department, detailSortOrder),
  };
}

function getProgramHierarchyLevelSortOrder(level, item, group, department, fallbackSortOrder = 0) {
  switch (level) {
    case "department":
      return getFiniteNumber(department?.sort_order) ?? fallbackSortOrder;
    case "room":
      return getFiniteNumber(item?.sort_order) ?? fallbackSortOrder;
    case "functionalGroup":
    case "departmentFunction":
    case "functionalArea":
    default:
      return getFiniteNumber(group?.sort_order) ?? getFiniteNumber(department?.sort_order) ?? fallbackSortOrder;
  }
}

function getProgramItemNetArea(item) {
  const storedTotal = firstFiniteNumber(
    item.net_nsf,
    item.total_nsf,
    item.extensions?.computed_total_nsf,
    item.extensions?.spreadsheet_total_nsf,
  );
  if (storedTotal != null) return roundArea(storedTotal);

  const quantity = getFiniteNumber(item.quantity) ?? 0;
  const nsfPerUnit = getFiniteNumber(item.nsf_per_unit) ?? 0;
  return roundArea(quantity * nsfPerUnit);
}

function getProgramItemGrossArea(item, department, netArea) {
  const storedGross = firstFiniteNumber(
    item.gross_dgsf,
    item.gross_nsf,
    item.extensions?.computed_gross_dgsf,
    item.extensions?.spreadsheet_gross_dgsf,
  );
  if (storedGross != null) return roundArea(storedGross);

  const grossingFactor = firstFiniteNumber(item.grossing_factor, department?.grossing_factor) ?? 1;
  return roundArea(netArea * Math.max(0, grossingFactor));
}

function readStackingProperty(source, keys) {
  if (!source || typeof source !== "object") return undefined;

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
    if (source.extensions?.[key] !== undefined && source.extensions[key] !== null && source.extensions[key] !== "") {
      return source.extensions[key];
    }
  }

  return undefined;
}

function firstStackingLabel(...values) {
  for (const value of values) {
    const label = humanizeStackingLabel(value);
    if (label) return label;
  }

  return "Unlabeled";
}

function humanizeStackingLabel(value) {
  if (value === undefined || value === null) return "";
  const label = String(value).trim().replace(/\s+/g, " ");
  if (!label) return "";

  if (/^[a-z0-9_]+$/.test(label) && label.includes("_")) {
    return label
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  return label;
}

function normalizeStackingGroupKey(label) {
  return humanizeStackingLabel(label).toLowerCase();
}

function floorNumberFromLabel(value) {
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = getFiniteNumber(value);
    if (parsed != null) return parsed;
  }

  return undefined;
}

function getFiniteNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function colorForStackingLabel(label) {
  const normalizedLabel = normalizeStackingGroupKey(label);
  let hash = 0;
  for (let index = 0; index < normalizedLabel.length; index += 1) {
    hash = (hash * 31 + normalizedLabel.charCodeAt(index)) | 0;
  }

  return getProgramHierarchyColorCss(getProgramHierarchyBaseColor(Math.abs(hash)));
}

function getStackingSegmentColor(segment) {
  return segment?.color || colorForStackingLabel(segment?.label ?? segment?.key ?? "");
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.trim().slice(0, 40);
    const detail = preview.startsWith("<") ? "The dev server returned HTML instead of JSON." : "The response was not valid JSON.";
    throw new Error(`Could not read ${label}. ${detail}`);
  }
}

async function createResponseError(response, fallbackMessage) {
  try {
    const payload = await parseJsonResponse(response, "error response");
    if (payload?.error) return new Error(payload.error);
  } catch {
    // The status code is more useful than replacing it with a secondary parse error.
  }

  return new Error(`${fallbackMessage} (${response.status}).`);
}

function createDefaultAdvancedSortRules() {
  return columns.map((column) => ({
    key: column.key,
    label: column.label,
    enabled: true,
  }));
}

function createDefaultProjectTableState() {
  return {
    program: {
      sortConfig: null,
      advancedSortConfig: null,
    },
  };
}

function normalizeSortConfig(config) {
  if (!config || typeof config !== "object") return null;
  if (!columns.some((column) => column.key === config.key)) return null;
  if (config.direction !== "asc" && config.direction !== "desc") return null;
  return { key: config.key, direction: config.direction };
}

function normalizeAdvancedSortConfig(config) {
  if (!config || !Array.isArray(config.rules)) return null;

  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const rules = config.rules
    .filter((rule) => columnsByKey.has(rule.key))
    .map((rule) => ({
      key: rule.key,
      label: columnsByKey.get(rule.key).label,
      enabled: Boolean(rule.enabled),
    }));

  return rules.length > 0 ? { rules } : null;
}

function serializeRules(rules) {
  return JSON.stringify(rules.map(({ key, enabled }) => ({ key, enabled })));
}

function reorderRules(rules, sourceRuleKey, targetRuleKey, placement = "before") {
  const sourceIndex = rules.findIndex((rule) => rule.key === sourceRuleKey);
  const targetIndex = rules.findIndex((rule) => rule.key === targetRuleKey);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return rules;

  const nextRules = [...rules];
  const [movedRule] = nextRules.splice(sourceIndex, 1);
  const insertionIndex = nextRules.findIndex((rule) => rule.key === targetRuleKey);
  nextRules.splice(placement === "after" ? insertionIndex + 1 : insertionIndex, 0, movedRule);

  if (nextRules.every((rule, index) => rule.key === rules[index].key)) return rules;
  return nextRules;
}

function sortRows(rows, sortConfig, advancedSortConfig) {
  const enabledAdvancedRules = advancedSortConfig?.rules.filter((rule) => rule.enabled) ?? [];
  if (enabledAdvancedRules.length > 0) {
    return sortRowsByRules(rows, enabledAdvancedRules);
  }

  if (!sortConfig) return rows;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const comparison = compareSortValues(getSortValue(a.row, sortConfig.key), getSortValue(b.row, sortConfig.key));
      const directionalComparison = sortConfig.direction === "asc" ? comparison : -comparison;
      return directionalComparison || a.index - b.index;
    })
    .map(({ row }) => row);
}

function sortRowsByRules(rows, rules) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const rule of rules) {
        const comparison = compareSortValues(getSortValue(a.row, rule.key), getSortValue(b.row, rule.key));
        if (comparison !== 0) return comparison;
      }

      return a.index - b.index;
    })
    .map(({ row }) => row);
}

function getSortValue(row, columnKey) {
  switch (columnKey) {
    case "quantity":
    case "nsfPerUnit":
    case "floor":
      return parseEditableNumber(row[columnKey]);
    case "totalNsf":
      return computeTotalNsf(row.quantity, row.nsfPerUnit);
    default:
      return String(row[columnKey] ?? "").trim();
  }
}

function compareSortValues(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getAriaSort(columnKey, sortConfig) {
  if (sortConfig?.key !== columnKey) return "none";
  return sortConfig.direction === "asc" ? "ascending" : "descending";
}

function getSortIconClass(columnKey, sortConfig) {
  if (sortConfig?.key !== columnKey) return "";
  return sortConfig.direction === "asc" ? "is-asc" : "is-desc";
}

function getSpreadsheetColumnLabel(index) {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }

  return label;
}

function getTableColumnsForDocument(tableDocument, spreadsheetSettings = createDefaultSpreadsheetSettings()) {
  if (tableDocument?.draftRows?.length === 0) return blankSpreadsheetColumns;

  const importedColumns = normalizeTableDisplayColumns(tableDocument?.programData?.extensions?.table_display?.columns);
  const orderedImportedColumns = createOrderedTableColumns(importedColumns);
  if (orderedImportedColumns.length > 0) return applySpreadsheetColumnSettings(orderedImportedColumns, spreadsheetSettings);

  if (isImportedProgramData(tableDocument?.programData)) {
    return applySpreadsheetColumnSettings(
      createOrderedTableColumns(IMPORTED_SPREADSHEET_COLUMN_KEYS.map((key) => ({ key }))),
      spreadsheetSettings,
    );
  }

  return applySpreadsheetColumnSettings(columns, spreadsheetSettings);
}

function getHierarchicalSpreadsheetColumns(spreadsheetSettings = createDefaultSpreadsheetSettings()) {
  return applySpreadsheetColumnSettings(HIERARCHICAL_SPREADSHEET_COLUMNS, spreadsheetSettings);
}

function applySpreadsheetColumnSettings(tableColumns, spreadsheetSettings = createDefaultSpreadsheetSettings()) {
  if (!spreadsheetSettings?.distributeIdenticalRooms) return tableColumns;
  return tableColumns.filter((column) => column.key !== "quantity");
}

function createOrderedTableColumns(sourceColumns) {
  const baseColumnsByKey = new Map(columns.map((column) => [column.key, column]));
  const sourceColumnsByKey = new Map(sourceColumns.map((column) => [column.key, column]));
  const usedKeys = new Set();
  const orderedColumns = [];
  const prioritizedSourceColumns = [
    ...PRIMARY_SPREADSHEET_COLUMN_KEYS.map((key) => sourceColumnsByKey.get(key) ?? { key }),
    ...sourceColumns.filter((column) => !PRIMARY_SPREADSHEET_COLUMN_KEYS.includes(column.key)),
  ];

  for (const sourceColumn of prioritizedSourceColumns) {
    const baseColumn = baseColumnsByKey.get(sourceColumn.key);
    if (!baseColumn || usedKeys.has(sourceColumn.key)) continue;

    usedKeys.add(sourceColumn.key);
    orderedColumns.push({
      ...baseColumn,
      ...(sourceColumn.label ? { displayLabel: sourceColumn.label } : {}),
    });
  }

  if (orderedColumns.length === 0) return [];

  return [
    ...orderedColumns,
    ...columns.filter((column) => !usedKeys.has(column.key)),
  ];
}

function normalizeTableDisplayColumns(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((column) => {
      const key = String(column?.key ?? "");
      return {
        key,
        label: normalizeTableDisplayLabel(key, column?.label),
      };
    })
    .filter((column) => column.key && column.label);
}

function normalizeTableDisplayLabel(columnKey, label) {
  const normalizedLabel = normalizeProjectName(label);
  if (columnKey === "programGroup" && normalizedLabel.toLowerCase() === "program group") {
    return "Functional Area";
  }
  return normalizedLabel;
}

function isImportedProgramData(programData) {
  return Boolean(programData?.project?.source_files?.length || programData?.extensions?.parser);
}

function getProgramDataSourceSignature(programData) {
  if (!isPlainObject(programData)) return "";

  const sourceFile = Array.isArray(programData.project?.source_files) ? programData.project.source_files[0] : null;
  if (sourceFile?.checksum) return `checksum:${sourceFile.checksum}`;
  if (sourceFile?.id || sourceFile?.name) {
    return `source:${sourceFile.id ?? ""}:${sourceFile.name ?? ""}`;
  }

  const itemIds = (programData.program_items ?? [])
    .map((item) => String(item?.id ?? ""))
    .filter(Boolean)
    .sort();
  if (programData.project?.id && itemIds.length > 0) {
    return `project-items:${programData.project.id}:${itemIds.join("|")}`;
  }

  return "";
}

function doProgramDataSourcesMatch(leftProgramData, rightProgramData) {
  const leftSignature = getProgramDataSourceSignature(leftProgramData);
  const rightSignature = getProgramDataSourceSignature(rightProgramData);
  return Boolean(leftSignature && rightSignature && leftSignature === rightSignature);
}

function hasMatchingSavedProgramDataOption(optionsById, option, label) {
  const rowCount = Number(option.rowCount);
  const normalizedLabel = normalizeProjectName(label);

  return [...optionsById.values()].some((existingOption) => (
    existingOption.source === "output" &&
    Number(existingOption.rowCount) === rowCount &&
    normalizeProjectName(existingOption.label) === normalizedLabel
  ));
}

function getTableColumnDisplayLabel(column) {
  return column.displayLabel || column.label;
}

function getTableColumnHeaderLabel(column, columnIndex, isBlankSpreadsheet) {
  const spreadsheetLabel = `(${getSpreadsheetColumnLabel(columnIndex)})`;
  return isBlankSpreadsheet ? spreadsheetLabel : `${spreadsheetLabel} ${getTableColumnDisplayLabel(column)}`;
}

function createBlankSpreadsheetRows() {
  return Array.from({ length: BLANK_SPREADSHEET_ROW_COUNT }, (_, index) => {
    const row = { id: `blank-row-${index + 1}` };
    for (const column of blankSpreadsheetColumns) row[column.key] = "";
    return row;
  });
}

function getCellKey(rowId, columnKey) {
  return `${rowId}::${columnKey}`;
}

function getDocumentCellKey(documentId, rowId, columnKey) {
  return `${documentId || DEFAULT_TABLE_DOCUMENT_ID}::::${getCellKey(rowId, columnKey)}`;
}

function parseCellKey(cellKey) {
  const value = String(cellKey ?? "");
  const separatorIndex = value.lastIndexOf("::");
  if (separatorIndex < 0) return null;

  return {
    rowId: value.slice(0, separatorIndex),
    columnKey: value.slice(separatorIndex + 2),
  };
}

function isEditableTableColumnKey(columnKey) {
  return !NON_EDITABLE_TABLE_COLUMN_KEYS.has(columnKey);
}

function isEditableTableCell(columnKey, tableDocument) {
  return tableDocument?.draftRows?.length === 0 || isEditableTableColumnKey(columnKey);
}

function isPrintableTableEditKey(event) {
  return event.key.length === 1;
}

function isEventFromTextEditingTarget(event) {
  const target = event.target;
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, button, [contenteditable='true']"));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseClipboardTableText(text) {
  const normalizedText = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmedText = normalizedText.endsWith("\n") ? normalizedText.slice(0, -1) : normalizedText;
  if (!trimmedText) return [];
  return trimmedText.split("\n").map((line) => line.split("\t"));
}

function writeTextToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  if (typeof document === "undefined") return Promise.reject(new Error("Clipboard is unavailable."));

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto 0";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  } finally {
    textarea.remove();
  }
}

function readTextFromClipboard() {
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }

  return Promise.reject(new Error("Clipboard read is unavailable."));
}

function createImportedTableDocumentId(file) {
  const name = encodeURIComponent(String(file?.name ?? "spreadsheet.xlsx"));
  const size = Number.isFinite(file?.size) ? file.size : 0;
  const lastModified = Number.isFinite(file?.lastModified) ? file.lastModified : 0;
  return `spreadsheet:${name}:${size}:${lastModified}`;
}

function isSelectableSpreadsheetOption(option) {
  if (!option?.id) return false;
  if (Number(option.rowCount) === 0) return false;
  if (option.source === "loaded" || option.source === "pane") return true;
  if (!isSavedProgramDataDocumentId(option.id) && !isImportedSpreadsheetDocumentId(option.id)) return false;
  return true;
}

function isSavedProgramDataDocumentId(documentId) {
  const value = String(documentId ?? "").toLowerCase();
  return value.startsWith("output:") && value.endsWith(".saved.json");
}

function isImportedSpreadsheetDocumentId(documentId) {
  return String(documentId ?? "").toLowerCase().startsWith("spreadsheet:");
}

function getCellInputMode(columnKey) {
  if (columnKey === "quantity" || columnKey === "nsfPerUnit") return "decimal";
  if (columnKey === "floor") return "numeric";
  return undefined;
}

function getCellAriaLabel(row, column) {
  const rowLabel = row.program || "Program row";
  return `${rowLabel} ${getTableColumnDisplayLabel(column)}`;
}

function blurActiveTableInput() {
  if (typeof document === "undefined") return;

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && activeElement.closest(".program-table")) {
    activeElement.blur();
  }
}

function blurActiveElement() {
  if (typeof document === "undefined") return;

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && activeElement !== document.body) {
    activeElement.blur();
  }
}

function scrollTableCellIntoView(paneId, rowId, columnKey, options = {}) {
  if (typeof document === "undefined") return;

  window.requestAnimationFrame(() => {
    const paneSelector = paneId ? `[data-pane-id="${escapeAttributeSelectorValue(paneId)}"] ` : "";
    const cellSelector = `[data-cell-key="${escapeAttributeSelectorValue(getCellKey(rowId, columnKey))}"]`;
    document.querySelector(`${paneSelector}${cellSelector}`)?.scrollIntoView({
      block: "nearest",
      behavior: options.behavior ?? "auto",
      inline: "nearest",
    });
  });
}

function scrollTableCellsIntoCenteredView(paneId, rowIds, columnKey, options = {}) {
  if (typeof document === "undefined") return false;

  const paneSelector = paneId ? `[data-pane-id="${escapeAttributeSelectorValue(paneId)}"]` : "";
  const shellSelector = paneSelector ? `${paneSelector} .table-shell` : ".table-shell";
  const cellSelectorPrefix = paneSelector ? `${paneSelector} ` : "";
  const shell = document.querySelector(shellSelector);
  if (!(shell instanceof HTMLElement)) return false;

  const cellElements = (rowIds ?? [])
    .map((rowId) =>
      document.querySelector(`${cellSelectorPrefix}[data-cell-key="${escapeAttributeSelectorValue(getCellKey(rowId, columnKey))}"]`),
    )
    .filter((element) => element instanceof HTMLElement);
  if (cellElements.length === 0) return false;

  const shellRect = shell.getBoundingClientRect();
  const cellRects = cellElements.map((element) => element.getBoundingClientRect());
  const conflictTop = Math.min(...cellRects.map((rect) => rect.top)) - shellRect.top + shell.scrollTop;
  const conflictRight = Math.max(...cellRects.map((rect) => rect.right)) - shellRect.left + shell.scrollLeft;
  const conflictBottom = Math.max(...cellRects.map((rect) => rect.bottom)) - shellRect.top + shell.scrollTop;
  const conflictLeft = Math.min(...cellRects.map((rect) => rect.left)) - shellRect.left + shell.scrollLeft;

  shell.scrollTo({
    top: getCenteredScrollValueForRange(
      conflictTop,
      conflictBottom,
      shell.clientHeight,
      shell.scrollHeight,
      options.topInset ?? 0,
    ),
    left: getCenteredScrollValueForRange(conflictLeft, conflictRight, shell.clientWidth, shell.scrollWidth),
    behavior: options.behavior ?? "auto",
  });

  return true;
}

function scrollHierarchyNodeIntoView(paneId, nodeKey, options = {}) {
  if (typeof document === "undefined") return false;

  const paneSelector = paneId ? `[data-pane-id="${escapeAttributeSelectorValue(paneId)}"] ` : "";
  const nodeSelector = `[data-hierarchy-node-key="${escapeAttributeSelectorValue(nodeKey)}"]`;
  const nodeElement = document.querySelector(`${paneSelector}${nodeSelector}`);
  if (!(nodeElement instanceof HTMLElement)) return false;

  nodeElement.scrollIntoView({
    block: "center",
    behavior: options.behavior ?? "auto",
    inline: "nearest",
  });
  return true;
}

function getCenteredScrollValueForRange(rangeStart, rangeEnd, viewportSize, scrollSize, viewportStartInset = 0) {
  const maxScroll = Math.max(0, scrollSize - viewportSize);
  const usableViewportSize = Math.max(0, viewportSize - viewportStartInset);
  const rangeCenter = (rangeStart + rangeEnd) / 2;
  const targetScroll = rangeCenter - viewportStartInset - usableViewportSize / 2;
  return clamp(targetScroll, 0, maxScroll);
}

function escapeAttributeSelectorValue(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

async function saveBlobToFile(blob, fileName) {
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: "SIGNAL Project",
          accept: {
            "application/vnd.signal.project+zip": [".signal"],
          },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

async function rememberProjectArchive(blob) {
  const response = await fetch(PROJECT_ARCHIVE_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/vnd.signal.project+zip" },
    body: blob,
  });

  if (!response.ok) {
    throw await createResponseError(response, "Could not remember saved project");
  }

  await parseJsonResponse(response, "remembered project");
}

function getProgramTitle(data) {
  return (
    normalizeProjectName(data?.project?.name) ||
    stripFileExtension(data?.project?.source_files?.[0]?.name) ||
    "Untitled Project"
  );
}

function normalizeProjectName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function stripFileExtension(fileName) {
  return String(fileName ?? "").replace(/\.[^.]+$/, "").trim();
}

function sanitizeFileName(value) {
  return normalizeProjectName(value)
    .replace(/[^\w .()-]+/g, "_")
    .slice(0, 80) || "signal-project";
}

function createEmptyProgramData(projectName = "Untitled Project") {
  const now = new Date().toISOString();
  const name = normalizeProjectName(projectName) || "Untitled Project";

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

function createCellStyles(data) {
  const styles = {};

  for (const item of data.program_items ?? []) {
    const storedStyles = item.extensions?.table_cell_styles ?? {};

    for (const column of columns) {
      const style = normalizeCellStyle(storedStyles[column.key]);
      if (style) styles[getCellKey(item.id, column.key)] = style;
    }
  }

  return styles;
}

function getRowCellStyles(rowId, cellStyles) {
  const rowStyles = {};

  for (const column of columns) {
    const style = normalizeCellStyle(cellStyles[getCellKey(rowId, column.key)]);
    if (style) rowStyles[column.key] = style;
  }

  return Object.keys(rowStyles).length > 0 ? rowStyles : null;
}

function serializeCellStyles(cellStyles) {
  return JSON.stringify(
    Object.entries(cellStyles)
      .map(([cellKey, style]) => {
        const normalizedStyle = normalizeCellStyle(style);
        return normalizedStyle ? [cellKey, normalizedStyle] : null;
      })
      .filter(Boolean)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function normalizeCellStyle(style) {
  if (!style || typeof style !== "object") return null;

  const normalizedStyle = {};
  if (style.bold) normalizedStyle.bold = true;
  if (style.italic) normalizedStyle.italic = true;
  if (style.underline) normalizedStyle.underline = true;

  return hasCellStyle(normalizedStyle) ? normalizedStyle : null;
}

function hasCellStyle(style) {
  return Boolean(style?.bold || style?.italic || style?.underline);
}

function createRows(data) {
  const departmentsById = new Map((data.departments ?? []).map((department) => [department.id, department]));
  const groupsById = new Map((data.program_groups ?? []).map((group) => [group.id, group]));
  const floorsById = new Map((data.floors ?? []).map((floor) => [floor.id, floor]));

  return [...(data.program_items ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((item) => {
      const group = groupsById.get(item.program_group_id);
      const department = departmentsById.get(group?.department_id ?? item.extensions?.department_id);
      const floor = floorsById.get(item.floor_id);

      return {
        id: item.id,
        departmentId: department?.id ?? item.extensions?.department_id ?? "",
        groupId: group?.id ?? item.program_group_id ?? "",
        department: department?.name ?? "",
        programGroup: group?.name ?? "",
        program: item.name ?? "",
        quantity: formatEditableNumber(item.quantity),
        nsfPerUnit: formatEditableNumber(item.nsf_per_unit),
        floor: formatEditableNumber(floor?.number ?? item.extensions?.original_floor_label ?? floorNumberFromId(item.floor_id)),
        comments: item.comment ?? "",
        sortOrder: getFiniteNumber(item.sort_order) ?? 0,
      };
    });
}

function buildSpreadsheetHierarchy(programData, rows, availableHierarchyLevels = getExistingProgramHierarchyLevels(programData, rows)) {
  const hierarchyLevels = availableHierarchyLevels.filter((level) => level.value !== "room");
  const root = createSpreadsheetHierarchyNode({
    key: "root",
    label: getProgramTitle(programData),
    level: "project",
    levelLabel: "Project",
    sortIndex: 0,
  });
  const departmentsById = new Map((programData?.departments ?? []).map((department) => [department.id, department]));
  const groupsById = new Map((programData?.program_groups ?? []).map((group) => [group.id, group]));
  const itemsById = new Map((programData?.program_items ?? []).map((item) => [item.id, item]));
  root.availableHierarchyLevels = availableHierarchyLevels;
  root.hierarchyLevels = hierarchyLevels;

  rows.forEach((row, rowIndex) => {
    const item = itemsById.get(row.id);
    const group = groupsById.get(item?.program_group_id ?? row.groupId);
    const department = departmentsById.get(group?.department_id ?? item?.extensions?.department_id ?? row.departmentId);
    const path = getSpreadsheetHierarchyPath(row, item, group, department, hierarchyLevels);
    const totalNsf = computeTotalNsf(row.quantity, row.nsfPerUnit);
    let node = root;

    addSpreadsheetHierarchyNodeTotal(node, row, totalNsf);

    for (const entry of path) {
      const localChildKey = getProgramHierarchyLocalChildKey(entry);
      let child = node.childMap.get(localChildKey);

      if (!child) {
        child = createSpreadsheetHierarchyNode({
          ...entry,
          key: `${node.key}/${localChildKey}`,
          sortIndex: rowIndex,
        });
        node.childMap.set(localChildKey, child);
        node.children.push(child);
      }

      addSpreadsheetHierarchyNodeTotal(child, row, totalNsf);
      node = child;
    }

    node.rows.push({ ...row });
  });

  sortSpreadsheetHierarchyNode(root);
  assignSpreadsheetHierarchyColors(root);
  return root;
}

function createSpreadsheetHierarchyNode({ key, label, level, levelLabel, sortIndex }) {
  return {
    key,
    label,
    level,
    levelLabel,
    sortIndex,
    children: [],
    childMap: new Map(),
    rows: [],
    rowCount: 0,
    totalNsf: 0,
    color: "",
    fillColor: "",
    colorModel: null,
    rowColorById: new Map(),
  };
}

function addSpreadsheetHierarchyNodeTotal(node, row, totalNsf) {
  node.rowCount += 1;
  node.totalNsf = roundArea(node.totalNsf + totalNsf);
  node.sortIndex = Math.min(node.sortIndex, row.sortOrder ?? node.sortIndex);
}

function sortSpreadsheetHierarchyNode(node) {
  node.children.sort((a, b) => a.sortIndex - b.sortIndex || a.label.localeCompare(b.label));
  for (const child of node.children) sortSpreadsheetHierarchyNode(child);
}

function assignSpreadsheetHierarchyColors(root) {
  const rootChildren = root.children ?? [];

  rootChildren.forEach((child, index) => {
    setSpreadsheetHierarchyNodeColor(child, getProgramHierarchyBaseColor(index, rootChildren.length));
    assignSpreadsheetHierarchyChildColors(child, 1);
  });

  assignSpreadsheetHierarchyRowColors(root);
}

function assignSpreadsheetHierarchyChildColors(node, depth) {
  assignSpreadsheetHierarchyRowColors(node);

  const children = node.children ?? [];
  children.forEach((child, index) => {
    const isLowestSubgroup = child.children.length === 0;
    setSpreadsheetHierarchyNodeColor(
      child,
      createProgramHierarchyChildColor(
        node.colorModel ?? getProgramHierarchyBaseColor(index, children.length),
        index,
        children.length,
        depth,
        { isLowestSubgroup },
      ),
    );
    assignSpreadsheetHierarchyChildColors(child, depth + 1);
  });
}

function assignSpreadsheetHierarchyRowColors(node) {
  if (!node.rows?.length) return;

  node.rows = node.rows.map((row, index) => {
    const colorModel = node.colorModel ?? getProgramHierarchyBaseColor(index, node.rows.length);

    node.rowColorById.set(String(row.id ?? index), colorModel);

    return {
      ...row,
      hierarchyColor: getProgramHierarchyColorCss(colorModel),
      hierarchyFillColor: getProgramHierarchyColorCss(colorModel, PROGRAM_HIERARCHY_ROW_FILL_ALPHA),
      hierarchyColorModel: colorModel,
    };
  });
}

function setSpreadsheetHierarchyNodeColor(node, colorModel) {
  node.colorModel = colorModel;
  node.color = getProgramHierarchyColorCss(colorModel);
  node.fillColor = getProgramHierarchyColorCss(colorModel, PROGRAM_HIERARCHY_FILL_ALPHA);
  node.hoverFillColor = getProgramHierarchyColorCss(colorModel, PROGRAM_HIERARCHY_HOVER_FILL_ALPHA);
}

function getProgramHierarchyLocalChildKey(entry) {
  return `${entry.level}:${normalizeStackingGroupKey(entry.label)}`;
}

function getProgramHierarchyNodeKey(path) {
  return path.reduce((key, entry) => `${key}/${getProgramHierarchyLocalChildKey(entry)}`, "root");
}

function getExistingProgramHierarchyLevels(programData, rows = []) {
  const existingLevels = new Set();
  const departmentsById = new Map((programData?.departments ?? []).map((department) => [department.id, department]));
  const groupsById = new Map((programData?.program_groups ?? []).map((group) => [group.id, group]));
  const itemsById = new Map((programData?.program_items ?? []).map((item) => [item.id, item]));
  const sourceRows = Array.isArray(rows) ? rows : [];

  if (sourceRows.length > 0) {
    for (const row of sourceRows) {
      const item = itemsById.get(row.id);
      const group = groupsById.get(item?.program_group_id ?? row.groupId);
      const department = departmentsById.get(group?.department_id ?? item?.extensions?.department_id ?? row.departmentId);
      addExistingProgramHierarchyLevels(existingLevels, row, item, group, department);
    }
  } else {
    for (const item of programData?.program_items ?? []) {
      const group = groupsById.get(item.program_group_id);
      const department = departmentsById.get(group?.department_id ?? item.extensions?.department_id);
      addExistingProgramHierarchyLevels(existingLevels, null, item, group, department);
    }
  }

  if (existingLevels.size === 0) {
    for (const department of programData?.departments ?? []) {
      if (getProgramHierarchyLevelLabel("department", null, null, null, department)) existingLevels.add("department");
    }

    for (const group of programData?.program_groups ?? []) {
      const department = departmentsById.get(group.department_id);
      if (getProgramHierarchyLevelLabel("functionalArea", null, null, group, department)) existingLevels.add("functionalArea");
    }
  }

  return LEVEL_OF_DETAIL_OPTIONS.filter((level) => existingLevels.has(level.value));
}

function addExistingProgramHierarchyLevels(existingLevels, row, item, group, department) {
  for (const level of LEVEL_OF_DETAIL_OPTIONS) {
    if (getProgramHierarchyLevelLabel(level.value, row, item, group, department)) {
      existingLevels.add(level.value);
    }
  }
}

function getEffectiveProgramHierarchyLevel(requestedLevel, availableLevels = LEVEL_OF_DETAIL_OPTIONS) {
  const availableValues = new Set(availableLevels.map((level) => level.value ?? level));
  const requestedIndex = Math.max(0, LEVEL_OF_DETAIL_OPTIONS.findIndex((level) => level.value === requestedLevel));

  for (let index = requestedIndex; index < LEVEL_OF_DETAIL_OPTIONS.length; index += 1) {
    if (availableValues.has(LEVEL_OF_DETAIL_OPTIONS[index].value)) return LEVEL_OF_DETAIL_OPTIONS[index].value;
  }

  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    if (availableValues.has(LEVEL_OF_DETAIL_OPTIONS[index].value)) return LEVEL_OF_DETAIL_OPTIONS[index].value;
  }

  return "room";
}

function getBlockingProgrammingOptions(programData, requestedLevel, activeFloor = null) {
  const level = getBlockingLevelOfDetailValue(requestedLevel);
  const options = [];
  const seenKeys = new Set();
  const addOption = (option) => {
    const normalizedOption = normalizeBlockingProgrammingAttribute(option);
    if (!normalizedOption || seenKeys.has(normalizedOption.key)) return;
    seenKeys.add(normalizedOption.key);
    options.push({
      ...normalizedOption,
      ...normalizeBlockingProgrammingOptionMetrics(option),
    });
  };

  addOption(createBlockingCirculationProgrammingOption(level));

  if (!isPlainObject(programData)) {
    return options;
  }

  const rows = createRows(programData);
  if (rows.length === 0) {
    return options;
  }

  const activeFloorRowIds = getProgramDiagramFloorRowIdSet(programData, activeFloor);
  if (activeFloor && activeFloorRowIds.size === 0) {
    return options;
  }

  const availableLevels = getExistingProgramHierarchyLevels(programData, rows);
  const hierarchy = buildSpreadsheetHierarchy(programData, rows, availableLevels);

  if (level === "room") {
    collectBlockingProgrammingRows(hierarchy, addOption, activeFloorRowIds);
    return options;
  }

  if (availableLevels.some((option) => option.value === level)) {
    collectBlockingProgrammingNodes(hierarchy, level, addOption, activeFloorRowIds);
  }

  return options;
}

function getProgramDiagramFloorRowIdSet(programData, activeFloor) {
  if (!activeFloor) {
    return new Set((programData?.program_items ?? []).map((item) => String(item.id ?? "")).filter(Boolean));
  }

  const rowIds = new Set();
  for (const item of programData?.program_items ?? []) {
    if (isProgramItemOnBlockingDiagramFloor(programData, item, activeFloor)) {
      const rowId = String(item.id ?? "");
      if (rowId) rowIds.add(rowId);
    }
  }

  return rowIds;
}

function isProgramItemOnBlockingDiagramFloor(programData, item, activeFloor) {
  const diagramFloorId = getProgramItemExplicitDiagramFloorId(item);
  if (!diagramFloorId || !activeFloor) return false;

  const activeFloorKey = String(activeFloor.key ?? "").trim();
  if (activeFloorKey && String(diagramFloorId) === activeFloorKey) return true;

  const itemFloorValue = normalizeFloorConflictValue(
    getProgramDataFloorValue(programData, diagramFloorId, diagramFloorId),
    diagramFloorId,
  );
  const activeFloorValue = normalizeFloorConflictValue(
    activeFloor.number ?? activeFloor.label ?? activeFloor.key,
    activeFloor.key,
  );
  return Boolean(itemFloorValue && activeFloorValue && doFloorValuesMatch(itemFloorValue, activeFloorValue));
}

function collectBlockingProgrammingNodes(node, targetLevel, addOption, allowedRowIds = null) {
  for (const child of node.children ?? []) {
    if (child.level === targetLevel && doesHierarchyNodeContainAllowedRow(child, allowedRowIds)) {
      const metrics = getBlockingHierarchyNodeMetrics(child, allowedRowIds);
      addOption(createBlockingProgrammingOption({
        key: child.key,
        level: child.level,
        levelLabel: child.levelLabel,
        label: child.label,
        colorModel: child.colorModel,
        color: child.color,
        ...metrics,
      }));
    }

    collectBlockingProgrammingNodes(child, targetLevel, addOption, allowedRowIds);
  }
}

function collectBlockingProgrammingRows(node, addOption, allowedRowIds = null) {
  const levelOption = LEVEL_OF_DETAIL_OPTIONS.find((option) => option.value === "room");

  for (const row of node.rows ?? []) {
    if (allowedRowIds && !allowedRowIds.has(String(row.id ?? ""))) continue;

    addOption(createBlockingProgrammingOption({
      key: `room:${String(row.id ?? `${node.key}/${normalizeStackingGroupKey(row.program)}`)}`,
      level: "room",
      levelLabel: levelOption?.label ?? "Room",
      label: row.program || "Unlabeled Room",
      colorModel: row.hierarchyColorModel,
      color: row.hierarchyColor,
      ...getBlockingRowMetrics(row),
    }));
  }

  for (const child of node.children ?? []) collectBlockingProgrammingRows(child, addOption, allowedRowIds);
}

function doesHierarchyNodeContainAllowedRow(node, allowedRowIds = null) {
  if (!allowedRowIds) return true;

  for (const row of node.rows ?? []) {
    if (allowedRowIds.has(String(row.id ?? ""))) return true;
  }

  return (node.children ?? []).some((child) => doesHierarchyNodeContainAllowedRow(child, allowedRowIds));
}

function getBlockingHierarchyNodeMetrics(node, allowedRowIds = null) {
  const metrics = {
    rowCount: 0,
    roomCount: 0,
    totalArea: 0,
  };

  collectBlockingHierarchyNodeMetrics(node, allowedRowIds, metrics);
  return {
    rowCount: metrics.rowCount,
    roomCount: roundArea(metrics.roomCount),
    totalArea: roundArea(metrics.totalArea),
  };
}

function collectBlockingHierarchyNodeMetrics(node, allowedRowIds, metrics) {
  for (const row of node.rows ?? []) {
    if (allowedRowIds && !allowedRowIds.has(String(row.id ?? ""))) continue;
    const rowMetrics = getBlockingRowMetrics(row);
    metrics.rowCount += rowMetrics.rowCount;
    metrics.roomCount += rowMetrics.roomCount;
    metrics.totalArea += rowMetrics.totalArea;
  }

  for (const child of node.children ?? []) collectBlockingHierarchyNodeMetrics(child, allowedRowIds, metrics);
}

function getBlockingRowMetrics(row) {
  return {
    rowCount: 1,
    roomCount: Math.max(0, parseEditableNumber(row?.quantity)),
    totalArea: computeTotalNsf(row?.quantity, row?.nsfPerUnit),
  };
}

function normalizeBlockingProgrammingOptionMetrics(option) {
  const rowCount = Math.max(0, getFiniteNumber(option?.rowCount) ?? 0);
  const roomCount = Math.max(0, getFiniteNumber(option?.roomCount) ?? rowCount);
  const totalArea = Math.max(0, getFiniteNumber(option?.totalArea) ?? getFiniteNumber(option?.totalNsf) ?? 0);

  return {
    rowCount,
    roomCount: roundArea(roomCount),
    totalArea: roundArea(totalArea),
    placedArea: 0,
  };
}

function createBlockingProgrammingOption({ key, level, levelLabel, label, colorModel, color, rowCount = 0, roomCount = 0, totalArea = 0 }) {
  const displayLabel = humanizeStackingLabel(label) || `Unlabeled ${levelLabel || "Program"}`;
  const strokeColor = colorModel
    ? getProgramHierarchyColorCss(colorModel)
    : color || colorForStackingLabel(displayLabel);

  return {
    key: String(key ?? `${level}:${normalizeStackingGroupKey(displayLabel)}`),
    level,
    levelLabel,
    label: displayLabel,
    color: strokeColor,
    hoverFillColor: colorModel ? getProgramHierarchyColorCss(colorModel, 0.1) : getCssColorWithAlpha(strokeColor, 0.1),
    activeFillColor: colorModel ? getProgramHierarchyColorCss(colorModel, 0.2) : getCssColorWithAlpha(strokeColor, 0.2),
    shapeFillColor: colorModel ? getProgramHierarchyColorCss(colorModel, 0.12) : getCssColorWithAlpha(strokeColor, 0.12),
    rowCount,
    roomCount,
    totalArea,
  };
}

function createBlockingCirculationProgrammingOption(level) {
  const normalizedLevel = getBlockingLevelOfDetailValue(level);
  const levelLabel = LEVEL_OF_DETAIL_OPTIONS.find((option) => option.value === normalizedLevel)?.label ?? "Program";

  return createBlockingProgrammingOption({
    key: getBlockingCirculationProgrammingKey(normalizedLevel),
    level: normalizedLevel,
    levelLabel,
    label: BLOCKING_CIRCULATION_LABEL,
    color: BLOCKING_CIRCULATION_COLOR,
  });
}

function getBlockingCirculationProgrammingKey(level) {
  return `${BLOCKING_CIRCULATION_KEY_PREFIX}:${getBlockingLevelOfDetailValue(level)}`;
}

function isBlockingCirculationProgrammingAttribute(attribute) {
  const normalizedAttribute = normalizeBlockingProgrammingAttribute(attribute);
  return Boolean(
    normalizedAttribute &&
    normalizedAttribute.key === getBlockingCirculationProgrammingKey(normalizedAttribute.level),
  );
}

function getBlockingPlacedAreaForProgrammingAttribute(shapes, programmingAttribute) {
  const normalizedAttribute = normalizeBlockingProgrammingAttribute(programmingAttribute);
  if (!normalizedAttribute) return 0;

  const placedArea = (shapes ?? []).reduce((sum, shape) => {
    const shapeAttribute = normalizeBlockingProgrammingAttribute(shape?.programmingAttribute);
    if (
      !shapeAttribute ||
      shapeAttribute.key !== normalizedAttribute.key ||
      shapeAttribute.level !== normalizedAttribute.level
    ) {
      return sum;
    }

    return sum + getBlockingShapeArea(shape);
  }, 0);

  return roundArea(placedArea);
}

function getBlockingGeometryConflictsForFloor(programData, shapes, activeFloor = null) {
  const normalizedShapes = normalizeBlockingShapes(shapes);
  if (!isPlainObject(programData) || normalizedShapes.length < 2) return [];

  const relationLookup = buildBlockingProgrammingRelationLookup(programData, activeFloor);
  const conflictGroups = new Map();

  for (const parentShape of normalizedShapes) {
    const parentAttribute = normalizeBlockingProgrammingAttribute(parentShape.programmingAttribute);
    if (!parentAttribute) continue;

    const parentLevelIndex = getBlockingLevelOfDetailIndex(parentAttribute.level);
    if (parentLevelIndex < 0) continue;

    for (const childShape of normalizedShapes) {
      if (childShape.id === parentShape.id) continue;

      const childAttribute = normalizeBlockingProgrammingAttribute(childShape.programmingAttribute);
      if (!childAttribute) continue;

      const childLevelIndex = getBlockingLevelOfDetailIndex(childAttribute.level);
      if (childLevelIndex <= parentLevelIndex) continue;
      if (!isBlockingProgrammingAttributeDescendantOf(relationLookup, childAttribute, parentAttribute)) continue;
      if (doesBlockingShapeContainShape(parentShape, childShape)) continue;

      const groupKey = `${parentShape.id}:${parentAttribute.key}`;
      const group = conflictGroups.get(groupKey) ?? {
        id: createBlockingGeometryConflictId(parentShape, parentAttribute),
        level: parentAttribute.level,
        parentKey: parentAttribute.key,
        parentLabel: parentAttribute.label,
        parentLevel: parentAttribute.level,
        parentLevelLabel: parentAttribute.levelLabel,
        primaryChildLabel: childAttribute.label,
        primaryChildLevel: childAttribute.level,
        primaryChildLevelLabel: childAttribute.levelLabel,
        shapeId: parentShape.id,
        childConflicts: [],
      };

      group.childConflicts.push({
        childKey: childAttribute.key,
        childLabel: childAttribute.label,
        childLevel: childAttribute.level,
        childLevelLabel: childAttribute.levelLabel,
        childShapeId: childShape.id,
      });
      conflictGroups.set(groupKey, group);
    }
  }

  return [...conflictGroups.values()].map((conflict) => ({
    ...conflict,
    allChildShapeIds: normalizedShapes
      .filter((shape) => {
        if (shape.id === conflict.shapeId) return false;
        const shapeAttribute = normalizeBlockingProgrammingAttribute(shape.programmingAttribute);
        return isBlockingProgrammingAttributeDescendantOf(relationLookup, shapeAttribute, {
          key: conflict.parentKey,
          label: conflict.parentLabel,
          level: conflict.parentLevel,
          levelLabel: conflict.parentLevelLabel,
        });
      })
      .map((shape) => shape.id),
    conflictCount: conflict.childConflicts.length,
  }));
}

function createBlockingGeometryConflictId(parentShape, parentAttribute) {
  return [
    "blocking-geometry-conflict",
    encodeURIComponent(String(parentShape?.id ?? "")),
    encodeURIComponent(String(parentAttribute?.key ?? "")),
  ].join(":");
}

function buildBlockingProgrammingRelationLookup(programData, activeFloor = null) {
  const lookup = new Map();
  if (!isPlainObject(programData)) return lookup;

  const rows = createRows(programData);
  if (rows.length === 0) return lookup;

  const allowedRowIds = activeFloor ? getProgramDiagramFloorRowIdSet(programData, activeFloor) : null;
  const hierarchy = buildSpreadsheetHierarchy(programData, rows, getExistingProgramHierarchyLevels(programData, rows));

  const visitNode = (node, ancestorKeysByLevel) => {
    let nextAncestorKeysByLevel = ancestorKeysByLevel;

    if (node.key !== "root") {
      lookup.set(node.key, {
        key: node.key,
        label: node.label,
        level: node.level,
        ancestorKeysByLevel,
      });
      nextAncestorKeysByLevel = {
        ...ancestorKeysByLevel,
        [node.level]: node.key,
      };
    }

    for (const row of node.rows ?? []) {
      const rowId = String(row.id ?? "");
      if (allowedRowIds && !allowedRowIds.has(rowId)) continue;

      const roomKey = `room:${String(row.id ?? `${node.key}/${normalizeStackingGroupKey(row.program)}`)}`;
      lookup.set(roomKey, {
        key: roomKey,
        label: row.program || "Unlabeled Room",
        level: "room",
        ancestorKeysByLevel: nextAncestorKeysByLevel,
      });
    }

    for (const child of node.children ?? []) visitNode(child, nextAncestorKeysByLevel);
  };

  visitNode(hierarchy, {});
  return lookup;
}

function isBlockingProgrammingAttributeDescendantOf(relationLookup, childAttribute, parentAttribute) {
  const normalizedChild = normalizeBlockingProgrammingAttribute(childAttribute);
  const normalizedParent = normalizeBlockingProgrammingAttribute(parentAttribute);
  if (!normalizedChild || !normalizedParent) return false;

  const childLevelIndex = getBlockingLevelOfDetailIndex(normalizedChild.level);
  const parentLevelIndex = getBlockingLevelOfDetailIndex(normalizedParent.level);
  if (childLevelIndex <= parentLevelIndex) return false;

  const childRelation = relationLookup.get(normalizedChild.key);
  if (childRelation?.ancestorKeysByLevel?.[normalizedParent.level] === normalizedParent.key) return true;

  return normalizedChild.level !== "room" && String(normalizedChild.key).startsWith(`${normalizedParent.key}/`);
}

function doesBlockingShapeContainShape(parentShape, childShape) {
  const childVertices = getBlockingShapeVertices(childShape);
  if (childVertices.length === 0) return true;

  const tolerance = BLOCKING_VERTEX_EPSILON * 4;
  return childVertices.every((point) => isBlockingPointInShape(point, parentShape, tolerance));
}

function getBlockingGeometryConflictAnchors(conflicts, shapes, levelOfDetail, view, canvasSize) {
  const normalizedLevel = getBlockingLevelOfDetailValue(levelOfDetail);
  const previewLevel = getBlockingParentLevelOfDetail(normalizedLevel);
  const shapeById = new Map((shapes ?? []).map((shape) => [shape.id, shape]));
  const canvasWidth = Math.max(1, canvasSize?.width ?? 1);
  const canvasHeight = Math.max(1, canvasSize?.height ?? 1);
  const menuWidth = Math.max(1, Math.min(376, canvasWidth - 24));

  return (conflicts ?? [])
    .map((conflict) => {
      const shape = shapeById.get(conflict.shapeId);
      if (!shape) return null;

      const shapeLevel = getBlockingShapeLevelOfDetail(shape);
      const isCurrent = shapeLevel === normalizedLevel;
      const isPreview = Boolean(previewLevel && shapeLevel === previewLevel);
      if (!isCurrent && !isPreview) return null;

      const bounds = getBlockingShapeBounds(shape);
      if (!bounds) return null;

      const screenPoint = blockingModelToScreen(
        {
          x: bounds.x + bounds.width,
          y: bounds.y,
        },
        view,
      );
      const left = clamp(screenPoint.x + 8, 8, Math.max(8, canvasWidth - 28));
      const top = clamp(screenPoint.y - 8, 8, Math.max(8, canvasHeight - 28));
      const menuPlacementX = screenPoint.x > canvasWidth - menuWidth - 24 ? "left" : "right";
      const menuPlacementY = top > canvasHeight / 2 ? "up" : "down";

      return {
        ...conflict,
        isPreview,
        left,
        menuMaxHeight: Math.max(
          1,
          menuPlacementY === "up" ? top - 8 : canvasHeight - top - 36,
        ),
        menuPlacementX,
        menuPlacementY,
        menuWidth,
        top,
      };
    })
    .filter(Boolean);
}

function getBlockingGeometryConflictExplanation(conflict) {
  const primaryChildLabel = conflict?.primaryChildLabel || "Child program";
  const primaryChildLevelLabel = conflict?.primaryChildLevelLabel || "Lower LOD";
  const parentLabel = conflict?.parentLabel || "Parent area";
  const parentLevelLabel = conflict?.parentLevelLabel || "Higher LOD";
  const count = Math.max(0, conflict?.conflictCount ?? conflict?.childConflicts?.length ?? 0);
  const additionalText = count > 1 ? ` and ${count - 1} other child ${count === 2 ? "area" : "areas"}` : "";
  const verb = count > 1 ? "extend" : "extends";

  return `${primaryChildLevelLabel} ${primaryChildLabel}${additionalText} ${verb} outside ${parentLevelLabel} ${parentLabel}. The lower LOD geometry is the source of truth, so review the higher LOD boundary.`;
}

function getBlockingGeometryConflictRecalculateLabel(conflict) {
  return `Recalculate area to fit child ${getBlockingLevelPluralLabel(conflict?.primaryChildLevelLabel || "functional areas")}`;
}

function getBlockingLevelPluralLabel(levelLabel) {
  const label = String(levelLabel ?? "").trim().toLowerCase();
  if (!label) return "areas";
  if (label.endsWith("y")) return `${label.slice(0, -1)}ies`;
  if (label.endsWith("s")) return label;
  return `${label}s`;
}

function getBlockingShapeArea(shape) {
  if (shape?.type === "rectangle") {
    return Math.max(0, Math.abs((getFiniteNumber(shape.width) ?? 0) * (getFiniteNumber(shape.height) ?? 0)));
  }

  if (shape?.type === "polyline") {
    return Math.max(0, getBlockingPolygonArea(shape.points ?? []));
  }

  return 0;
}

function formatBlockingProgrammingProgress(option) {
  if (isBlockingCirculationProgrammingAttribute(option)) {
    return `${formatDiagramArea(option?.placedArea)} SF`;
  }

  return `${formatDiagramArea(option?.placedArea)} / ${formatDiagramArea(option?.totalArea)} SF`;
}

function formatBlockingProgrammingRoomCount(roomCount) {
  const normalizedRoomCount = Math.max(0, Math.round(Number(roomCount) || 0));
  return normalizedRoomCount === 1 ? "1 room" : `${normalizedRoomCount.toLocaleString()} rooms`;
}

function buildProgramHierarchyColorLookup(programData) {
  const rows = createRows(programData ?? {});
  const availableLevels = getExistingProgramHierarchyLevels(programData, rows);
  const hierarchy = buildSpreadsheetHierarchy(programData, rows, availableLevels);
  const lookup = {
    availableLevels,
    hierarchyLevels: hierarchy.hierarchyLevels ?? [],
    nodeColorByKey: new Map(),
    rowColorById: new Map(),
  };

  collectProgramHierarchyColorLookup(hierarchy, lookup);
  return lookup;
}

function collectProgramHierarchyColorLookup(node, lookup) {
  if (node.key !== "root" && node.colorModel) {
    lookup.nodeColorByKey.set(node.key, node.colorModel);
  }

  for (const row of node.rows ?? []) {
    if (row.id !== undefined && row.id !== null && row.hierarchyColorModel) {
      lookup.rowColorById.set(String(row.id), row.hierarchyColorModel);
    }
  }

  for (const child of node.children ?? []) collectProgramHierarchyColorLookup(child, lookup);
}

function getProgramHierarchyColorForItemLevel(colorLookup, item, group, department, level) {
  if (!colorLookup || !item) return null;

  if (level === "room") {
    const rowColor = colorLookup.rowColorById.get(String(item.id));
    return rowColor ? getProgramHierarchyColorCss(rowColor) : null;
  }

  const pathLevels = getProgramHierarchyLevelsThroughLevel(colorLookup.hierarchyLevels, level);
  if (pathLevels.length === 0) return null;

  const path = getSpreadsheetHierarchyPath(null, item, group, department, pathLevels);
  const colorModel = colorLookup.nodeColorByKey.get(getProgramHierarchyNodeKey(path));
  return colorModel ? getProgramHierarchyColorCss(colorModel) : null;
}

function getProgramHierarchySegmentKeyForItemLevel(colorLookup, item, group, department, level) {
  if (!colorLookup || !item) return null;

  if (level === "room") {
    return `room:${String(item.id ?? normalizeStackingGroupKey(item.name))}`;
  }

  const pathLevels = getProgramHierarchyLevelsThroughLevel(colorLookup.hierarchyLevels, level);
  if (pathLevels.length === 0) return null;

  const path = getSpreadsheetHierarchyPath(null, item, group, department, pathLevels);
  return getProgramHierarchyNodeKey(path);
}

function getProgramHierarchyLevelsThroughLevel(hierarchyLevels, level) {
  const levelIndex = hierarchyLevels.findIndex((candidate) => candidate.value === level);
  return levelIndex === -1 ? [] : hierarchyLevels.slice(0, levelIndex + 1);
}

function getProgramHierarchyBaseColor(index, count = PROGRAM_HIERARCHY_BASE_COLORS.length) {
  if (index < PROGRAM_HIERARCHY_BASE_COLORS.length) {
    const baseColor = PROGRAM_HIERARCHY_BASE_COLORS[index];
    return createProgramHierarchyColor(baseColor.h, baseColor.s, baseColor.l);
  }

  const hue = (index * 137.508 + count * 11) % 360;
  return createProgramHierarchyColor(hue, 68, 58);
}

function createProgramHierarchyChildColor(parentColor, index, count, depth, options = {}) {
  const siblingCount = Math.max(1, count);
  const centeredIndex = siblingCount === 1 ? 0 : index / (siblingCount - 1) - 0.5;
  const isLowestSubgroup = Boolean(options.isLowestSubgroup);
  const hueSpread = isLowestSubgroup
    ? clamp(18 + siblingCount * 2.5, 22, 42)
    : clamp(10 + siblingCount * 3, 12, 36);
  const hue = parentColor.h + centeredIndex * hueSpread + depth * 1.5;
  const saturation = isLowestSubgroup
    ? clamp(parentColor.s - 8 + (index % 4) * 6, 44, 94)
    : clamp(parentColor.s - 6 + (index % 3) * 4, 42, 92);
  const lightnessOffset = siblingCount === 1
    ? 8
    : ((index % (isLowestSubgroup ? 7 : 5)) - (isLowestSubgroup ? 3 : 2)) * (isLowestSubgroup ? 6 : 4) + 8 - depth * 1.5;
  const lightness = clamp(parentColor.l + lightnessOffset, 34, 82);
  return createProgramHierarchyColor(hue, saturation, lightness);
}

function createProgramHierarchyColor(h, s, l) {
  return {
    h: normalizeHue(h),
    s: Math.round(clamp(s, 0, 100)),
    l: Math.round(clamp(l, 0, 100)),
  };
}

function normalizeHue(hue) {
  return Math.round(((hue % 360) + 360) % 360);
}

function getProgramHierarchyColorCss(color, alpha = null) {
  if (!color) return "";
  if (alpha === null || alpha === undefined) return `hsl(${color.h}, ${color.s}%, ${color.l}%)`;
  return `hsla(${color.h}, ${color.s}%, ${color.l}%, ${clamp(alpha, 0, 1)})`;
}

function getCssColorWithAlpha(color, alpha) {
  const normalizedAlpha = clamp(alpha, 0, 1);
  const normalizedColor = String(color ?? "").trim();
  const hslMatch = normalizedColor.match(/^hsl\(\s*([-\d.]+)\s*,\s*([-\d.]+)%\s*,\s*([-\d.]+)%\s*\)$/i);
  if (hslMatch) return `hsla(${hslMatch[1]}, ${hslMatch[2]}%, ${hslMatch[3]}%, ${normalizedAlpha})`;

  const hslaMatch = normalizedColor.match(/^hsla\(\s*([-\d.]+)\s*,\s*([-\d.]+)%\s*,\s*([-\d.]+)%\s*,\s*([-\d.]+)\s*\)$/i);
  if (hslaMatch) return `hsla(${hslaMatch[1]}, ${hslaMatch[2]}%, ${hslaMatch[3]}%, ${normalizedAlpha})`;

  return `rgba(10, 10, 10, ${normalizedAlpha})`;
}

function getSpreadsheetHierarchyPath(row, item, group, department, hierarchyLevels = SPREADSHEET_HIERARCHY_LEVELS) {
  const path = [];

  for (const level of hierarchyLevels) {
    const label = getSpreadsheetHierarchyLevelLabel(level.value, row, item, group, department);
    const displayLabel = label || `Unlabeled ${level.label}`;
    const normalizedLabel = normalizeStackingGroupKey(displayLabel);
    if (!normalizedLabel) continue;

    path.push({
      level: level.value,
      levelLabel: level.label,
      label: displayLabel,
    });
  }

  return path;
}

function getSpreadsheetHierarchyLevelLabel(level, row, item, group, department) {
  return getProgramHierarchyLevelLabel(level, row, item, group, department);
}

function getProgramHierarchyLevelLabel(level, row, item, group, department) {
  switch (level) {
    case "functionalGroup":
      return firstHierarchyLabel(
        readStackingProperty(item, ["functional_group", "functionalGroup", "functional_group_name", "functionalGroupName"]),
        readStackingProperty(group, ["functional_group", "functionalGroup", "functional_group_name", "functionalGroupName"]),
        readStackingProperty(department, ["functional_group", "functionalGroup", "functional_group_name", "functionalGroupName"]),
      );
    case "departmentFunction":
      return firstHierarchyLabel(
        readStackingProperty(item, ["department_function", "departmentFunction", "department_function_name", "departmentFunctionName"]),
        readStackingProperty(group, ["department_function", "departmentFunction", "department_function_name", "departmentFunctionName"]),
        readStackingProperty(department, ["department_function", "departmentFunction", "department_function_name", "departmentFunctionName"]),
      );
    case "department":
      return firstHierarchyLabel(
        row?.department,
        department?.name,
        readStackingProperty(item, ["department_name", "departmentName"]),
      );
    case "functionalArea":
      return firstHierarchyLabel(
        row?.programGroup,
        readStackingProperty(item, ["functional_area", "functionalArea", "functional_area_name", "functionalAreaName"]),
        readStackingProperty(group, ["functional_area", "functionalArea", "functional_area_name", "functionalAreaName"]),
        group?.name,
        item?.program_type,
      );
    case "room":
      return firstHierarchyLabel(row?.program, item?.name, item?.source_ref?.original_label);
    default:
      return "";
  }
}

function firstHierarchyLabel(...values) {
  for (const value of values) {
    const label = humanizeStackingLabel(value);
    if (label) return label;
  }

  return "";
}

function mergeRowsIntoProgramData(data, rows, cellStyles = {}, projectName, options = {}) {
  const next = JSON.parse(JSON.stringify(data));
  const nextProjectName = normalizeProjectName(projectName) || getProgramTitle(next);
  next.project = {
    ...(next.project ?? {}),
    id: next.project?.id || slugify(nextProjectName),
    name: nextProjectName,
  };
  next.floors = next.floors ?? [];
  next.departments = next.departments ?? [];
  next.program_groups = next.program_groups ?? [];
  next.program_items = next.program_items ?? [];

  const itemsById = new Map((next.program_items ?? []).map((item) => [item.id, item]));
  const groupsById = new Map((next.program_groups ?? []).map((group) => [group.id, group]));
  const departmentsById = new Map((next.departments ?? []).map((department) => [department.id, department]));
  const floorsById = new Map((next.floors ?? []).map((floor) => [floor.id, floor]));
  const departmentNameUpdates = new Map();
  const groupNameUpdates = new Map();

  for (const row of rows) {
    const departmentName = row.department.trim();
    const groupName = row.programGroup.trim();
    const department = departmentsById.get(row.departmentId);
    const group = groupsById.get(row.groupId);

    if (departmentName && departmentName !== department?.name && !departmentNameUpdates.has(row.departmentId)) {
      departmentNameUpdates.set(row.departmentId, departmentName);
    }

    if (groupName && groupName !== group?.name && !groupNameUpdates.has(row.groupId)) {
      groupNameUpdates.set(row.groupId, groupName);
    }
  }

  for (const [departmentId, name] of departmentNameUpdates) {
    const department = departmentsById.get(departmentId);
    if (department) department.name = name;
  }

  for (const [groupId, name] of groupNameUpdates) {
    const group = groupsById.get(groupId);
    if (group) group.name = name;
  }

  for (const row of rows) {
    const item = itemsById.get(row.id);
    if (!item) continue;

    const group = groupsById.get(row.groupId);
    const quantity = parseEditableNumber(row.quantity);
    const nsfPerUnit = parseEditableNumber(row.nsfPerUnit);
    const totalNsf = roundArea(quantity * nsfPerUnit);
    const floor = normalizeFloor(row.floor, item.floor_id);
    const comment = row.comments.trim();

    if (!floorsById.has(floor.id)) {
      const nextFloor = {
        id: floor.id,
        number: floor.number,
        name: `Floor ${floor.number}`,
      };
      next.floors.push(nextFloor);
      floorsById.set(nextFloor.id, nextFloor);
    }

    item.name = row.program.trim() || item.name;
    item.quantity = quantity;
    item.nsf_per_unit = nsfPerUnit;
    item.floor_id = floor.id;
    const rowCellStyles = getRowCellStyles(row.id, cellStyles);
    const extensions = {
      ...(item.extensions ?? {}),
      spreadsheet_total_nsf: totalNsf,
      computed_total_nsf: totalNsf,
      original_floor_label: String(floor.number),
      department_id: group?.department_id ?? item.extensions?.department_id,
    };
    if (rowCellStyles) {
      extensions.table_cell_styles = rowCellStyles;
    } else {
      delete extensions.table_cell_styles;
    }
    item.extensions = extensions;

    if (comment) {
      item.comment = comment;
    } else {
      delete item.comment;
    }
  }

  if (options.distributeIdenticalRooms) {
    distributeIdenticalProgramRooms(next);
  }

  next.floors = [...(next.floors ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  updateGroupDefaultFloors(next);
  updateDerivedTotals(next);

  next.project.updated_at = new Date().toISOString();

  return next;
}

function distributeIdenticalProgramRooms(data) {
  const sourceItems = Array.isArray(data.program_items) ? data.program_items : [];
  const originalIds = new Set(sourceItems.map((item) => String(item?.id ?? "")).filter(Boolean));
  const usedIds = new Set();
  const distributedItems = [];

  for (const [itemIndex, item] of sourceItems.entries()) {
    const roomCount = getDistributedRoomCount(item.quantity);
    const baseId = String(item.id || `item-${slugify(item.name || `room-${itemIndex + 1}`)}`);

    if (roomCount <= 1) {
      distributedItems.push({
        ...item,
        id: createUniqueProgramItemId(baseId, usedIds, getReservedProgramItemIds(originalIds, baseId)),
      });
      continue;
    }

    for (let roomIndex = 0; roomIndex < roomCount; roomIndex += 1) {
      const copyId = roomIndex === 0
        ? createUniqueProgramItemId(baseId, usedIds, getReservedProgramItemIds(originalIds, baseId))
        : createUniqueProgramItemId(`${baseId}-room-${roomIndex + 1}`, usedIds, originalIds);
      const nsfPerUnit = Number(item.nsf_per_unit) || 0;
      const totalNsf = roundArea(nsfPerUnit);

      distributedItems.push({
        ...item,
        id: copyId,
        quantity: 1,
        sort_order: distributedItems.length + 1,
        extensions: {
          ...(item.extensions ?? {}),
          spreadsheet_total_nsf: totalNsf,
          computed_total_nsf: totalNsf,
          distributed_from_item_id: baseId,
          distributed_room_index: roomIndex + 1,
          distributed_room_count: roomCount,
        },
      });
    }
  }

  data.program_items = distributedItems.map((item, index) => ({
    ...item,
    sort_order: index + 1,
  }));
}

function consolidateIdenticalProgramRooms(data) {
  const sourceItems = Array.isArray(data.program_items) ? data.program_items : [];
  const itemGroups = new Map();
  const consolidatedItems = [];
  let didConsolidate = false;

  for (const item of sourceItems) {
    const key = getProgramRoomConsolidationKey(item);
    const existingItem = itemGroups.get(key);

    if (!existingItem) {
      const nextItem = {
        ...item,
        extensions: removeDistributionExtensions(item.extensions),
      };
      itemGroups.set(key, nextItem);
      consolidatedItems.push(nextItem);
      continue;
    }

    didConsolidate = true;
    existingItem.quantity = roundArea((Number(existingItem.quantity) || 0) + (Number(item.quantity) || 0));
    const totalNsf = roundArea((Number(existingItem.quantity) || 0) * (Number(existingItem.nsf_per_unit) || 0));
    existingItem.extensions = {
      ...(existingItem.extensions ?? {}),
      spreadsheet_total_nsf: totalNsf,
      computed_total_nsf: totalNsf,
    };
  }

  if (!didConsolidate) return false;

  data.program_items = consolidatedItems.map((item, index) => ({
    ...item,
    sort_order: index + 1,
  }));
  return true;
}

function getProgramRoomConsolidationKey(item) {
  return JSON.stringify([
    String(item.program_group_id ?? ""),
    normalizeStackingGroupKey(item.name ?? ""),
    roundArea(Number(item.nsf_per_unit) || 0),
    String(item.floor_id ?? ""),
    String(getProgramItemDiagramFloorId(item) ?? ""),
    normalizeProjectName(item.comment ?? ""),
    normalizeStackingGroupKey(item.program_type ?? ""),
  ]);
}

function removeDistributionExtensions(extensions) {
  if (!isPlainObject(extensions)) return extensions;

  const nextExtensions = { ...extensions };
  delete nextExtensions.distributed_from_item_id;
  delete nextExtensions.distributed_room_index;
  delete nextExtensions.distributed_room_count;
  return nextExtensions;
}

function getDistributedRoomCount(quantity) {
  const numericQuantity = Number(quantity);
  if (!Number.isFinite(numericQuantity) || numericQuantity <= 1) return 1;
  return Math.max(1, Math.round(numericQuantity));
}

function hasDistributableProgramRows(rows) {
  return (rows ?? []).some((row) => getDistributedRoomCount(parseEditableNumber(row.quantity)) > 1);
}

function getReservedProgramItemIds(originalIds, currentId) {
  const reservedIds = new Set(originalIds);
  reservedIds.delete(currentId);
  return reservedIds;
}

function createUniqueProgramItemId(preferredId, usedIds, reservedIds = new Set()) {
  const baseId = String(preferredId || "item").trim() || "item";
  let candidate = baseId;
  let suffix = 2;

  while (usedIds.has(candidate) || reservedIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function updateGroupDefaultFloors(data) {
  for (const group of data.program_groups ?? []) {
    const floorIds = new Set(
      (data.program_items ?? [])
        .filter((item) => item.program_group_id === group.id)
        .map((item) => item.floor_id)
        .filter(Boolean),
    );

    if (floorIds.size === 1) {
      group.default_floor_id = [...floorIds][0];
    } else {
      delete group.default_floor_id;
    }
  }
}

function updateDerivedTotals(data) {
  const groupsByDepartment = new Map();
  for (const group of data.program_groups ?? []) {
    const groups = groupsByDepartment.get(group.department_id) ?? [];
    groups.push(group.id);
    groupsByDepartment.set(group.department_id, groups);
  }

  const itemsByGroup = new Map();
  for (const item of data.program_items ?? []) {
    const items = itemsByGroup.get(item.program_group_id) ?? [];
    items.push(item);
    itemsByGroup.set(item.program_group_id, items);
  }

  const departmentTotals = (data.departments ?? []).map((department) => {
    const groupIds = groupsByDepartment.get(department.id) ?? [];
    const items = groupIds.flatMap((groupId) => itemsByGroup.get(groupId) ?? []);
    const netNsf = roundArea(items.reduce((sum, item) => sum + item.quantity * item.nsf_per_unit, 0));
    const grossDgsf = roundArea(netNsf * (department.grossing_factor ?? 1));
    const floorNumbers = [
      ...new Set(items.map((item) => floorNumberFromId(item.floor_id)).filter((number) => number != null)),
    ].sort((a, b) => a - b);

    return {
      department_id: department.id,
      net_nsf: netNsf,
      grossing_factor: department.grossing_factor ?? 1,
      gross_dgsf: grossDgsf,
      program_count: items.length,
      floor_numbers: floorNumbers,
    };
  });

  data.derived_totals_cache = {
    ...(data.derived_totals_cache ?? {}),
    project_net_nsf: roundArea(departmentTotals.reduce((sum, total) => sum + total.net_nsf, 0)),
    project_gross_dgsf: roundArea(departmentTotals.reduce((sum, total) => sum + total.gross_dgsf, 0)),
    department_totals: departmentTotals,
  };
}

function computeTotalNsf(quantity, nsfPerUnit) {
  return roundArea(parseEditableNumber(quantity) * parseEditableNumber(nsfPerUnit));
}

function parseEditableNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatEditableNumber(value) {
  if (value === undefined || value === null || value === "") return "";
  return Number.isFinite(Number(value)) ? String(Number(value)) : String(value);
}

function formatArea(value) {
  return roundArea(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function formatDiagramArea(value) {
  const roundedValue = Math.round(Number(value) || 0);
  return roundedValue.toLocaleString();
}

function getStackingConflictFloorValue(floor, floorKey) {
  const floorNumber =
    getFiniteNumber(floor?.number) ??
    floorNumberFromLabel(floor?.label) ??
    floorNumberFromId(floorKey);
  return formatEditableNumber(floorNumber ?? floorKey ?? "");
}

function getProgramDataStackingSettings(programData) {
  const diagramSettings = programData?.extensions?.[DIAGRAM_SETTINGS_EXTENSION_KEY];
  const stackingSettings = diagramSettings?.[DIAGRAM_STACKING_SETTINGS_KEY];
  return isPlainObject(stackingSettings) ? stackingSettings : {};
}

function getEffectiveStackingSettingsForProgramData(programData, settings = createDefaultStackingSettings()) {
  const sourceSettings = getProgramDataStackingSettings(programData);
  const mergedSettings = {
    ...createDefaultStackingSettings(),
    ...settings,
    defaultFloorToFloorFeet: sourceSettings.defaultFloorToFloorFeet ?? settings.defaultFloorToFloorFeet,
    defaultFloorToFloorInches: sourceSettings.defaultFloorToFloorInches ?? settings.defaultFloorToFloorInches,
    floorHeights: {
      ...normalizeStackingFloorHeightOverrides(settings.floorHeights),
      ...normalizeStackingFloorHeightOverrides(sourceSettings.floorHeights),
    },
    floorOffsets: {
      ...normalizeStackingFloorOffsetOverrides(settings.floorOffsets),
      ...normalizeStackingFloorOffsetOverrides(sourceSettings.floorOffsets),
    },
    floorWidths: {
      ...normalizeStackingFloorWidthOverrides(settings.floorWidths),
      ...normalizeStackingFloorWidthOverrides(sourceSettings.floorWidths),
    },
    slabHeights: {
      ...normalizeStackingSlabHeightOverrides(settings.slabHeights),
      ...normalizeStackingSlabHeightOverrides(sourceSettings.slabHeights),
    },
    slabHeight: sourceSettings.slabHeight ?? settings.slabHeight,
  };

  return {
    ...mergedSettings,
    levelOfDetail: getEffectiveProgramHierarchyLevel(
      mergedSettings.levelOfDetail,
      getExistingProgramHierarchyLevels(programData),
    ),
  };
}

function getStackingHeightSettings(settings = createDefaultStackingSettings()) {
  const normalizedSettings = {
    ...createDefaultStackingSettings(),
    ...settings,
  };

  return {
    defaultFloorToFloorFeet: String(normalizedSettings.defaultFloorToFloorFeet ?? "12"),
    defaultFloorToFloorInches: String(normalizedSettings.defaultFloorToFloorInches ?? "0"),
    slabHeight: String(normalizedSettings.slabHeight ?? "1"),
  };
}

function normalizeStackingFloorHeightOverrides(floorHeights) {
  return normalizeStackingDimensionHeightOverrides(floorHeights);
}

function normalizeStackingFloorWidthOverrides(floorWidths) {
  return normalizeStackingDimensionHeightOverrides(floorWidths);
}

function normalizeStackingFloorOffsetOverrides(floorOffsets) {
  if (!isPlainObject(floorOffsets)) return {};

  return Object.fromEntries(
    Object.entries(floorOffsets)
      .map(([dimensionKey, offset]) => {
        const key = String(dimensionKey ?? "").trim();
        const parsedOffset = getFiniteNumber(offset);
        if (!key || parsedOffset == null) return null;
        return [key, String(roundArea(parsedOffset))];
      })
      .filter(Boolean),
  );
}

function normalizeStackingSlabHeightOverrides(slabHeights) {
  return normalizeStackingDimensionHeightOverrides(slabHeights);
}

function normalizeStackingDimensionHeightOverrides(dimensionHeights) {
  if (!isPlainObject(dimensionHeights)) return {};

  return Object.fromEntries(
    Object.entries(dimensionHeights)
      .map(([dimensionKey, height]) => {
        const key = String(dimensionKey ?? "").trim();
        const parsedHeight = getFiniteNumber(height);
        if (!key || parsedHeight == null || parsedHeight <= 0) return null;
        return [key, String(roundArea(Math.max(STACKING_MIN_DIMENSION_FEET, parsedHeight)))];
      })
      .filter(Boolean),
  );
}

function getStackingFloorHeightWithOverride(floorHeights, fallbackHeight, floorKey, floorNumber, floorId) {
  const overrideKeys = getStackingFloorHeightOverrideKeys(floorKey, floorNumber, floorId);

  for (const overrideKey of overrideKeys) {
    const parsedHeight = getFiniteNumber(floorHeights?.[overrideKey]);
    if (parsedHeight != null && parsedHeight > 0) {
      return Math.max(STACKING_MIN_DIMENSION_FEET, parsedHeight);
    }
  }

  return fallbackHeight;
}

function getStackingFloorWidthWithOverride(floorWidths, fallbackWidth, floorKey, floorNumber, floorId) {
  const overrideKeys = getStackingFloorHeightOverrideKeys(floorKey, floorNumber, floorId);

  for (const overrideKey of overrideKeys) {
    const parsedWidth = getFiniteNumber(floorWidths?.[overrideKey]);
    if (parsedWidth != null && parsedWidth > 0) {
      return Math.max(STACKING_MIN_DIMENSION_FEET, parsedWidth);
    }
  }

  return fallbackWidth;
}

function getStackingFloorOffsetWithOverride(floorOffsets, fallbackOffset, floorKey, floorNumber, floorId) {
  const overrideKeys = getStackingFloorHeightOverrideKeys(floorKey, floorNumber, floorId);

  for (const overrideKey of overrideKeys) {
    const parsedOffset = getFiniteNumber(floorOffsets?.[overrideKey]);
    if (parsedOffset != null) return roundArea(parsedOffset);
  }

  return fallbackOffset;
}

function getStackingSlabHeightWithOverride(slabHeights, fallbackHeight, slabKey, upperFloorKey, lowerFloorKey) {
  const overrideKeys = getStackingSlabHeightOverrideKeys(slabKey, upperFloorKey, lowerFloorKey);

  for (const overrideKey of overrideKeys) {
    const parsedHeight = getFiniteNumber(slabHeights?.[overrideKey]);
    if (parsedHeight != null && parsedHeight > 0) {
      return Math.max(STACKING_MIN_DIMENSION_FEET, parsedHeight);
    }
  }

  return fallbackHeight;
}

function getStackingFloorHeightOverrideKeys(floorKey, floorNumber, floorId) {
  const formattedFloorNumber = floorNumber == null ? "" : formatEditableNumber(floorNumber);
  return [
    floorKey,
    floorId,
    formattedFloorNumber,
    formattedFloorNumber ? `floor-${formattedFloorNumber}` : "",
  ]
    .map((key) => String(key ?? "").trim())
    .filter((key, index, keys) => key && keys.indexOf(key) === index);
}

function getStackingSlabHeightOverrideKeys(slabKey, upperFloorKey, lowerFloorKey) {
  return [
    slabKey,
    upperFloorKey && lowerFloorKey ? createStackingSlabKey(upperFloorKey, lowerFloorKey) : "",
  ]
    .map((key) => String(key ?? "").trim())
    .filter((key, index, keys) => key && keys.indexOf(key) === index);
}

function ensureProgramDataDiagramSourceState(programData, settings = createDefaultStackingSettings()) {
  if (!isPlainObject(programData)) return { data: programData, changed: false };

  const next = JSON.parse(JSON.stringify(programData));
  let changed = false;

  for (const item of next.program_items ?? []) {
    if (!isPlainObject(item.extensions)) {
      item.extensions = {};
      changed = true;
    }

    if (!isPlainObject(item.extensions[DIAGRAM_VALUES_EXTENSION_KEY])) {
      item.extensions[DIAGRAM_VALUES_EXTENSION_KEY] = {};
      changed = true;
    }

    const diagramValues = item.extensions[DIAGRAM_VALUES_EXTENSION_KEY];
    if (diagramValues.floor_id === undefined || diagramValues.floor_id === null || diagramValues.floor_id === "") {
      diagramValues.floor_id = item.floor_id;
      changed = true;
    }
  }

  if (!isPlainObject(next.extensions)) {
    next.extensions = {};
    changed = true;
  }

  if (!isPlainObject(next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY])) {
    next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY] = {};
    changed = true;
  }

  const diagramSettings = next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY];
  if (!isPlainObject(diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY])) {
    diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY] = getStackingHeightSettings(settings);
    changed = true;
  } else {
    const heightSettings = getStackingHeightSettings(settings);
    const stackingSettings = diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY];
    for (const [key, value] of Object.entries(heightSettings)) {
      if (stackingSettings[key] === undefined || stackingSettings[key] === null || stackingSettings[key] === "") {
        stackingSettings[key] = value;
        changed = true;
      }
    }
  }

  return changed ? { data: next, changed } : { data: programData, changed: false };
}

function setProgramDataStackingHeightSettings(programData, heightSettings) {
  if (!isPlainObject(programData)) return { data: programData, changed: false };

  const next = JSON.parse(JSON.stringify(programData));
  next.extensions = isPlainObject(next.extensions) ? next.extensions : {};
  next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY] = isPlainObject(next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY])
    ? next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY]
    : {};

  const diagramSettings = next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY];
  const currentStackingSettings = isPlainObject(diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY])
    ? diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY]
    : {};
  const nextStackingSettings = {
    ...currentStackingSettings,
    ...heightSettings,
  };
  const changed = Object.keys(nextStackingSettings).some(
    (key) => String(currentStackingSettings[key] ?? "") !== String(nextStackingSettings[key] ?? ""),
  );

  if (!changed) return { data: programData, changed: false };

  diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY] = nextStackingSettings;
  next.project = {
    ...(next.project ?? {}),
    updated_at: new Date().toISOString(),
  };

  return { data: next, changed: true };
}

function setProgramDataStackingFloorHeight(programData, floorKey, height) {
  return setProgramDataStackingDimensionHeightOverride(programData, floorKey, height, "floorHeights");
}

function setProgramDataStackingSlabHeight(programData, slabKey, height) {
  return setProgramDataStackingDimensionHeightOverride(programData, slabKey, height, "slabHeights");
}

function setProgramDataStackingFloorBounds(programData, floorKey, bounds) {
  if (!isPlainObject(programData)) return { data: programData, changed: false };

  const normalizedFloorKey = String(floorKey ?? "").trim();
  const parsedLeft = getFiniteNumber(bounds?.left);
  const parsedWidth = getFiniteNumber(bounds?.width);
  if (!normalizedFloorKey || parsedLeft == null || parsedWidth == null || parsedWidth <= 0) {
    return { data: programData, changed: false };
  }

  const next = JSON.parse(JSON.stringify(programData));
  next.extensions = isPlainObject(next.extensions) ? next.extensions : {};
  next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY] = isPlainObject(next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY])
    ? next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY]
    : {};

  const diagramSettings = next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY];
  const currentStackingSettings = isPlainObject(diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY])
    ? diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY]
    : {};
  const currentFloorOffsets = normalizeStackingFloorOffsetOverrides(currentStackingSettings.floorOffsets);
  const currentFloorWidths = normalizeStackingFloorWidthOverrides(currentStackingSettings.floorWidths);
  const nextOffset = String(roundArea(parsedLeft));
  const nextWidth = String(roundArea(Math.max(STACKING_MIN_DIMENSION_FEET, parsedWidth)));

  if (
    String(currentFloorOffsets[normalizedFloorKey] ?? "") === nextOffset &&
    String(currentFloorWidths[normalizedFloorKey] ?? "") === nextWidth
  ) {
    return { data: programData, changed: false };
  }

  diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY] = {
    ...currentStackingSettings,
    floorOffsets: {
      ...currentFloorOffsets,
      [normalizedFloorKey]: nextOffset,
    },
    floorWidths: {
      ...currentFloorWidths,
      [normalizedFloorKey]: nextWidth,
    },
  };
  next.project = {
    ...(next.project ?? {}),
    updated_at: new Date().toISOString(),
  };

  return { data: next, changed: true };
}

function setProgramDataStackingDimensionHeightOverride(programData, dimensionKey, height, settingKey) {
  if (!isPlainObject(programData)) return { data: programData, changed: false };

  const normalizedDimensionKey = String(dimensionKey ?? "").trim();
  const parsedHeight = getFiniteNumber(height);
  if (!normalizedDimensionKey || parsedHeight == null || parsedHeight <= 0) {
    return { data: programData, changed: false };
  }

  const next = JSON.parse(JSON.stringify(programData));
  next.extensions = isPlainObject(next.extensions) ? next.extensions : {};
  next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY] = isPlainObject(next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY])
    ? next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY]
    : {};

  const diagramSettings = next.extensions[DIAGRAM_SETTINGS_EXTENSION_KEY];
  const currentStackingSettings = isPlainObject(diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY])
    ? diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY]
    : {};
  const currentDimensionHeights = normalizeStackingDimensionHeightOverrides(currentStackingSettings[settingKey]);
  const nextHeight = String(roundArea(Math.max(STACKING_MIN_DIMENSION_FEET, parsedHeight)));
  if (String(currentDimensionHeights[normalizedDimensionKey] ?? "") === nextHeight) {
    return { data: programData, changed: false };
  }

  diagramSettings[DIAGRAM_STACKING_SETTINGS_KEY] = {
    ...currentStackingSettings,
    [settingKey]: {
      ...currentDimensionHeights,
      [normalizedDimensionKey]: nextHeight,
    },
  };
  next.project = {
    ...(next.project ?? {}),
    updated_at: new Date().toISOString(),
  };

  return { data: next, changed: true };
}

function updateProgramDataFloorAssignments(programData, floorIdsByItemId, target = "diagram") {
  if (!isPlainObject(programData) || !(floorIdsByItemId instanceof Map) || floorIdsByItemId.size === 0) {
    return { data: programData, changed: false };
  }

  const next = JSON.parse(JSON.stringify(programData));
  let changed = false;

  for (const item of next.program_items ?? []) {
    const nextFloorId = floorIdsByItemId.get(String(item.id ?? ""));
    if (!nextFloorId) continue;

    ensureProgramDataFloor(next, nextFloorId);

    if (target === "spreadsheet") {
      if (String(item.floor_id ?? "") === String(nextFloorId)) continue;
      item.floor_id = nextFloorId;
      item.extensions = isPlainObject(item.extensions) ? item.extensions : {};
      item.extensions.original_floor_label = formatEditableNumber(floorNumberFromId(nextFloorId) ?? nextFloorId);
      changed = true;
      continue;
    }

    item.extensions = isPlainObject(item.extensions) ? item.extensions : {};
    item.extensions[DIAGRAM_VALUES_EXTENSION_KEY] = isPlainObject(item.extensions[DIAGRAM_VALUES_EXTENSION_KEY])
      ? item.extensions[DIAGRAM_VALUES_EXTENSION_KEY]
      : {};
    const diagramValues = item.extensions[DIAGRAM_VALUES_EXTENSION_KEY];
    if (String(diagramValues.floor_id ?? "") === String(nextFloorId)) continue;

    diagramValues.floor_id = nextFloorId;
    changed = true;
  }

  if (!changed) return { data: programData, changed: false };

  if (target === "spreadsheet") {
    updateGroupDefaultFloors(next);
    updateDerivedTotals(next);
  }

  next.project = {
    ...(next.project ?? {}),
    updated_at: new Date().toISOString(),
  };

  return { data: next, changed: true };
}

function ensureProgramDataFloor(programData, floorId) {
  const floorNumber = floorNumberFromId(floorId);
  if (floorNumber == null) return false;

  programData.floors = Array.isArray(programData.floors) ? programData.floors : [];
  if (programData.floors.some((floor) => floor.id === floorId)) return false;

  programData.floors.push({
    id: floorId,
    number: floorNumber,
    name: `Floor ${floorNumber}`,
  });
  programData.floors.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  return true;
}

function getFloorIdForStackingValue(value, fallbackFloorId = "") {
  return normalizeFloor(value, fallbackFloorId || undefined).id;
}

function getProgramDataFloorValue(programData, floorId, fallbackValue = "") {
  const floor = (programData?.floors ?? []).find((candidate) => candidate.id === floorId);
  const floorNumber =
    getFiniteNumber(floor?.number) ??
    floorNumberFromId(floorId) ??
    floorNumberFromLabel(floor?.name) ??
    floorNumberFromLabel(fallbackValue) ??
    getFiniteNumber(fallbackValue);

  return formatEditableNumber(floorNumber ?? fallbackValue ?? "");
}

function getProgramDataFloorLabel(programData, floorId, fallbackValue = "") {
  const floor = (programData?.floors ?? []).find((candidate) => candidate.id === floorId);
  const floorValue = getProgramDataFloorValue(programData, floorId, fallbackValue);
  return floor?.name || (floorValue ? `Floor ${floorValue}` : "Floor");
}

function normalizeFloorConflictValue(value, fallbackFloorId = "") {
  const floorNumber = floorNumberFromLabel(value) ?? getFiniteNumber(value) ?? floorNumberFromId(fallbackFloorId);
  return formatEditableNumber(floorNumber ?? value ?? "");
}

function createStackingConflictId(documentId, sourceFloorValue, targetFloorValue) {
  return [
    "stacking-conflict",
    encodeURIComponent(String(documentId || DEFAULT_TABLE_DOCUMENT_ID)),
    "floor",
    encodeURIComponent(String(sourceFloorValue ?? "")),
    encodeURIComponent(String(targetFloorValue ?? "")),
  ].join(":");
}

function deriveStackingConflictsForDocument(documentId, tableDocument, previousConflicts = []) {
  const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
  const programData = tableDocument?.programData;
  const rows = Array.isArray(tableDocument?.draftRows) ? tableDocument.draftRows : [];
  if (!isPlainObject(programData) || rows.length === 0) return [];

  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const previousById = new Map(
    previousConflicts
      .filter((conflict) => (conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID) === normalizedDocumentId)
      .map((conflict) => [conflict.id, conflict]),
  );
  const groups = new Map();

  for (const item of programData.program_items ?? []) {
    const row = rowsById.get(String(item.id ?? ""));
    const explicitDiagramFloorId = getProgramItemExplicitDiagramFloorId(item);
    if (!row || !explicitDiagramFloorId) continue;

    const sourceFloorValue = normalizeFloorConflictValue(row.floor, item.floor_id);
    const targetFloorValue = normalizeFloorConflictValue(
      getProgramDataFloorValue(programData, explicitDiagramFloorId, explicitDiagramFloorId),
      explicitDiagramFloorId,
    );
    if (!sourceFloorValue || !targetFloorValue || doFloorValuesMatch(sourceFloorValue, targetFloorValue)) continue;

    const conflictId = createStackingConflictId(normalizedDocumentId, sourceFloorValue, targetFloorValue);
    const sourceFloorId = getFloorIdForStackingValue(sourceFloorValue, item.floor_id);
    const group = groups.get(conflictId) ?? {
      id: conflictId,
      columnKey: "floor",
      documentId: normalizedDocumentId,
      rowIds: [],
      segmentLabel: "",
      sourceDiagramPaneId: "",
      sourceFloorKey: sourceFloorId,
      sourceFloorLabel: getProgramDataFloorLabel(programData, sourceFloorId, sourceFloorValue),
      sourceFloorValue,
      status: previousById.get(conflictId)?.status === "ignored" ? "ignored" : "pending",
      targetFloorKey: explicitDiagramFloorId,
      targetFloorLabel: getProgramDataFloorLabel(programData, explicitDiagramFloorId, targetFloorValue),
      targetFloorValue,
    };

    group.rowIds.push(row.id);
    groups.set(conflictId, group);
  }

  return [...groups.values()].map((conflict) => ({
    ...conflict,
    rowIds: [...new Set(conflict.rowIds)],
    segmentLabel: getStackingConflictGroupLabel(conflict, rowsById),
  }));
}

function mergeStackingConflictsForDocument(conflicts, documentId, tableDocument) {
  const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
  return [
    ...conflicts.filter((conflict) => (conflict.documentId || DEFAULT_TABLE_DOCUMENT_ID) !== normalizedDocumentId),
    ...deriveStackingConflictsForDocument(normalizedDocumentId, tableDocument, conflicts),
  ];
}

function getStackingConflictGroupLabel(conflict, rowsById) {
  const rowIds = conflict.rowIds ?? [];
  if (rowIds.length === 1) {
    const row = rowsById.get(String(rowIds[0]));
    return row?.program || row?.programGroup || row?.department || "Program row";
  }

  return `${rowIds.length} program rows`;
}

function doFloorValuesMatch(value, expectedValue) {
  const valueNumber = floorNumberFromLabel(value) ?? getFiniteNumber(value);
  const expectedNumber = floorNumberFromLabel(expectedValue) ?? getFiniteNumber(expectedValue);

  if (valueNumber != null && expectedNumber != null) return valueNumber === expectedNumber;
  return String(value ?? "").trim() === String(expectedValue ?? "").trim();
}

function getStackingConflictExplanation(conflict) {
  const rowCount = conflict.rowIds?.length ?? 0;
  const subject = rowCount === 1 ? "one program row" : `${rowCount} program rows`;
  const verb = rowCount === 1 ? "was" : "were";
  return `${conflict.segmentLabel} ${verb} moved from ${conflict.sourceFloorLabel} to ${conflict.targetFloorLabel} in the stacking diagram, but the Floor ${rowCount === 1 ? "cell still shows" : "cells still show"} the previous spreadsheet value. Update ${subject} to Floor ${conflict.targetFloorValue}.`;
}

function getStackingConflictCausalityTitle(conflict) {
  return conflict.segmentLabel || "Dragged rectangle";
}

function getStackingConflictCausalityMeta(conflict) {
  const rowCount = conflict.rowIds?.length ?? 0;
  const cellLabel = rowCount === 1 ? "1 cell" : `${rowCount} cells`;
  return `${conflict.sourceFloorLabel} to ${conflict.targetFloorLabel} - ${cellLabel}`;
}

function normalizeFloor(value, fallbackFloorId) {
  const match = String(value ?? "").match(/\d+/);
  if (match) {
    const number = Number(match[0]);
    return { id: `floor-${number}`, number };
  }

  const fallbackNumber = floorNumberFromId(fallbackFloorId) ?? 1;
  return { id: fallbackFloorId || `floor-${fallbackNumber}`, number: fallbackNumber };
}

function floorNumberFromId(floorId) {
  const match = String(floorId ?? "").match(/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function roundArea(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function slugify(value) {
  const slug = normalizeProjectName(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[+/]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}
