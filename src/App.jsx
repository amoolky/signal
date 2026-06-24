import React, { useEffect, useMemo, useRef, useState } from "react";

const PROGRAM_DATA_ENDPOINT = "/api/program-data";
const PROGRAM_DATA_FILE_ENDPOINT = "/api/program-data/file";
const PROGRAM_DATA_FILES_ENDPOINT = "/api/program-data/files";
const PROGRAM_IMPORT_ENDPOINT = "/api/program-data/import";
const PROJECT_ENDPOINT = "/api/project";
const PROJECT_EXPORT_ENDPOINT = "/api/project/export";
const PROJECT_IMPORT_ENDPOINT = "/api/project/import";

const columns = [
  { key: "department", label: "Department", className: "col-department" },
  { key: "programGroup", label: "Program Group", className: "col-group" },
  { key: "program", label: "Program", className: "col-program" },
  { key: "quantity", label: "Quantity", className: "col-number" },
  { key: "nsfPerUnit", label: "NSF/Room", className: "col-number" },
  { key: "totalNsf", label: "Total NSF", className: "col-total" },
  { key: "floor", label: "Floor", className: "col-floor" },
  { key: "comments", label: "Comments", className: "col-comments" },
];

const FORMAT_SHORTCUTS = {
  b: "bold",
  i: "italic",
  u: "underline",
};

const DEFAULT_TABLE_DOCUMENT_ID = "default-table-document";

function createDefaultStackingSettings() {
  return {
    defaultFloorToFloorFeet: "12",
    defaultFloorToFloorInches: "0",
    levelOfDetail: "functionalGroup",
    textSize: "12",
    grossSquareFootage: false,
    netSquareFootage: false,
  };
}

function createDefaultTablePaneState(documentId = DEFAULT_TABLE_DOCUMENT_ID) {
  return {
    documentId,
    sortConfig: null,
    advancedSortConfig: null,
    selectedCells: [],
    selectionAnchor: null,
  };
}

function createTableDocumentFromData(data) {
  return {
    programData: data,
    draftProjectName: getProgramTitle(data),
    draftRows: createRows(data),
    cellStyles: createCellStyles(data),
  };
}

export default function App() {
  const spreadsheetImportInputRef = useRef(null);
  const projectImportInputRef = useRef(null);
  const nextWorkspacePaneId = useRef(1);
  const workspaceDisplayRef = useRef(null);
  const pendingSpreadsheetImportPaneIdRef = useRef(null);
  const [isStartDialogOpen, setIsStartDialogOpen] = useState(true);
  const [isTableOpen, setIsTableOpen] = useState(false);
  const [isDiagramsOpen, setIsDiagramsOpen] = useState(false);
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const [sideToolMenu, setSideToolMenu] = useState(null);
  const [workspaceSlots, setWorkspaceSlots] = useState([]);
  const [workspacePaneWidths, setWorkspacePaneWidths] = useState([]);
  const [paneResizeState, setPaneResizeState] = useState(null);
  const [activeTablePaneId, setActiveTablePaneId] = useState(null);
  const [activeDiagramView, setActiveDiagramView] = useState("stacking");
  const [stackingSettings, setStackingSettings] = useState(createDefaultStackingSettings);
  const [programData, setProgramData] = useState(null);
  const [tableDocuments, setTableDocuments] = useState({});
  const [draftProjectName, setDraftProjectName] = useState("");
  const [draftRows, setDraftRows] = useState([]);
  const [cellStyles, setCellStyles] = useState({});
  const [selectedTableCells, setSelectedTableCells] = useState([]);
  const [tableSelectionAnchor, setTableSelectionAnchor] = useState(null);
  const [sortConfig, setSortConfig] = useState(null);
  const [advancedSortConfig, setAdvancedSortConfig] = useState(null);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [columnMenu, setColumnMenu] = useState(null);
  const [openSpreadsheetTitlePaneId, setOpenSpreadsheetTitlePaneId] = useState(null);
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
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const totals = useMemo(() => summarizeRows(draftRows), [draftRows]);
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
  const selectedTableCellSet = useMemo(() => new Set(selectedTableCells), [selectedTableCells]);
  const visibleRowIndexById = useMemo(() => new Map(sortedRows.map((row, index) => [row.id, index])), [sortedRows]);
  const columnIndexByKey = useMemo(() => new Map(columns.map((column, index) => [column.key, index])), []);
  const savedRowsSignature = useMemo(
    () => (programData ? JSON.stringify(createRows(programData)) : ""),
    [programData],
  );
  const draftRowsSignature = useMemo(() => JSON.stringify(draftRows), [draftRows]);
  const savedCellStylesSignature = useMemo(
    () => (programData ? serializeCellStyles(createCellStyles(programData)) : ""),
    [programData],
  );
  const cellStylesSignature = useMemo(() => serializeCellStyles(cellStyles), [cellStyles]);
  const savedProjectName = programData ? getProgramTitle(programData) : "";
  const hasUnsavedEdits = Boolean(
    programData &&
      (
        draftRowsSignature !== savedRowsSignature ||
        cellStylesSignature !== savedCellStylesSignature ||
        normalizeProjectName(draftProjectName) !== savedProjectName
      ),
  );

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

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    advancedSortConfig,
    cellStyles,
    draftProjectName,
    draftRows,
    isProjectSaving,
    isSaving,
    isStartDialogOpen,
    isTableOpen,
    programData,
    sortConfig,
    tableDocuments,
  ]);

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
    if (!isTableOpen) return undefined;

    const onKeyDown = (event) => {
      if (isAdvancedSortOpen || isAdvancedCancelConfirmOpen || isExitConfirmOpen) return;
      const activeSelectedCells = getActiveTableSelectedCells();

      if (event.key === "Escape" && activeSelectedCells.length > 0) {
        event.preventDefault();
        clearActiveTableSelection();
        blurActiveTableInput();
        return;
      }

      const formatKey = FORMAT_SHORTCUTS[event.key.toLowerCase()];
      if (!formatKey || !(event.ctrlKey || event.metaKey) || event.altKey || activeSelectedCells.length === 0) return;

      event.preventDefault();
      applyTableCellFormat(formatKey);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isAdvancedCancelConfirmOpen,
    isAdvancedSortOpen,
    isExitConfirmOpen,
    isTableOpen,
    selectedTableCells,
    activeTablePaneId,
    tableDocuments,
    workspaceSlots,
  ]);

  function applyProgramData(data) {
    const nextDocument = createTableDocumentFromData(data);
    setProgramData(data);
    setTableDocuments({
      [DEFAULT_TABLE_DOCUMENT_ID]: nextDocument,
    });
    setDraftProjectName(nextDocument.draftProjectName);
    setDraftRows(nextDocument.draftRows);
    setCellStyles(nextDocument.cellStyles);
    clearTableSelection();
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

  function setTableDocumentFromData(documentId, data) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const nextDocument = createTableDocumentFromData(data);

    setTableDocuments((documents) => ({
      ...documents,
      [normalizedDocumentId]: nextDocument,
    }));

    if (normalizedDocumentId === DEFAULT_TABLE_DOCUMENT_ID) {
      setProgramData(data);
      setDraftProjectName(nextDocument.draftProjectName);
      setDraftRows(nextDocument.draftRows);
      setCellStyles(nextDocument.cellStyles);
    }
  }

  function updateTableDocument(documentId, updater) {
    const normalizedDocumentId = documentId || DEFAULT_TABLE_DOCUMENT_ID;
    const fallbackDocument = getTableDocument(normalizedDocumentId);

    setTableDocuments((documents) => {
      const currentDocument = documents[normalizedDocumentId] ?? fallbackDocument;
      return {
        ...documents,
        [normalizedDocumentId]: updater(currentDocument),
      };
    });
  }

  function getTablePaneDocumentId(paneId) {
    return getTablePaneStateById(paneId).documentId ?? DEFAULT_TABLE_DOCUMENT_ID;
  }

  function getActiveTableDocumentId() {
    return activeTablePaneId ? getTablePaneDocumentId(activeTablePaneId) : DEFAULT_TABLE_DOCUMENT_ID;
  }

  function createImportedTableDocumentId(file) {
    return `spreadsheet:${file.name}:${file.size}:${file.lastModified}`;
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
    if (tableDocuments[documentId] || !isProjectProgramDataFileId(documentId)) return;

    setLoadingProgramDataFileId(documentId);
    setErrorMessage("");

    try {
      const response = await fetch(`${PROGRAM_DATA_FILE_ENDPOINT}?id=${encodeURIComponent(documentId)}`);
      if (!response.ok) {
        throw await createResponseError(response, "Could not load parsed JSON file");
      }

      const data = await parseJsonResponse(response, "parsed JSON file");
      setTableDocumentFromData(documentId, data);
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
      if (!option?.id || optionsById.has(option.id)) return;
      optionsById.set(option.id, {
        ...option,
        label: option.label || getTableDocumentOptionLabel(option.id),
      });
    };

    addOption({ id: currentDocumentId, label: getTableDocumentOptionLabel(currentDocumentId), source: "current" });

    for (const file of availableProgramDataFiles) {
      addOption({
        id: file.id,
        label: file.label,
        path: file.path,
        source: file.source,
      });
    }

    for (const [documentId, tableDocument] of Object.entries(tableDocuments)) {
      addOption({
        id: documentId,
        label: tableDocument.draftProjectName,
        source: "loaded",
      });
    }

    for (const slot of workspaceSlots) {
      if (getWorkspacePaneType(slot) !== "table") continue;
      const documentId = typeof slot === "string" ? DEFAULT_TABLE_DOCUMENT_ID : slot.tableState?.documentId ?? DEFAULT_TABLE_DOCUMENT_ID;
      addOption({
        id: documentId,
        label: getTableDocumentOptionLabel(documentId),
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
    if (!tableDocument?.programData) return false;

    return (
      JSON.stringify(tableDocument.draftRows) !== JSON.stringify(createRows(tableDocument.programData)) ||
      serializeCellStyles(tableDocument.cellStyles) !== serializeCellStyles(createCellStyles(tableDocument.programData)) ||
      normalizeProjectName(tableDocument.draftProjectName) !== getProgramTitle(tableDocument.programData)
    );
  }

  function applyProjectSnapshot(snapshot) {
    applyProgramData(snapshot.programData);
    const programTableState = snapshot.tableState?.program ?? {};
    setSortConfig(normalizeSortConfig(programTableState.sortConfig));
    setAdvancedSortConfig(normalizeAdvancedSortConfig(programTableState.advancedSortConfig));
  }

  async function handleCreateNewProject() {
    const data = createEmptyProgramData("Untitled Project");
    applyProjectSnapshot({
      programData: data,
      tableState: createDefaultProjectTableState(),
    });
    setWorkspaceSlots([]);
    setWorkspacePaneWidths([]);
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
      const response = await fetch(PROJECT_ENDPOINT);
      if (!response.ok) {
        throw await createResponseError(response, "Could not load last project");
      }

      const snapshot = await parseJsonResponse(response, "last project");
      applyProjectSnapshot(snapshot);
      setWorkspaceSlots([]);
      setWorkspacePaneWidths([]);
      setIsTableOpen(false);
      setIsDiagramsOpen(false);
      setIsToolMenuOpen(false);
      setSideToolMenu(null);
      setIsStartDialogOpen(false);
      setStatusMessage("Loaded last project.");
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
          selectionAnchor: null,
        }));
        setActiveTablePaneId(targetPaneId);
      } else {
        applyProgramData(data);
        setSortConfig(null);
        setAdvancedSortConfig(null);
        setIsToolMenuOpen(false);
        setSideToolMenu(null);
        setIsDiagramsOpen(false);
        setIsTableOpen(true);
        setWorkspaceSlots([createWorkspacePane("table", importedDocumentId)]);
        setWorkspacePaneWidths([1]);
      }
      setIsStartDialogOpen(false);
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
      setWorkspaceSlots([]);
      setWorkspacePaneWidths([]);
      setIsTableOpen(false);
      setIsDiagramsOpen(false);
      setIsToolMenuOpen(false);
      setSideToolMenu(null);
      setIsStartDialogOpen(false);
      setStatusMessage(`Imported ${file.name}.`);
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
    return {
      programData: getCurrentProgramData(),
      tableState: {
        program: {
          sortConfig,
          advancedSortConfig,
        },
      },
    };
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
          )
        : defaultDocument.programData;
    }

    if (!programData) {
      return createEmptyProgramData(normalizeProjectName(draftProjectName) || "Untitled Project");
    }

    return isTableOpen ? mergeRowsIntoProgramData(programData, draftRows, cellStyles, draftProjectName) : programData;
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

      const snapshot = await parseJsonResponse(response, "saved project");
      applyProjectSnapshot(snapshot);
      setStatusMessage("Project saved.");
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsProjectSaving(false);
    }
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
      if (didSave) setStatusMessage("Project exported.");
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
    setIsToolMenuOpen(false);
    setSideToolMenu(null);
    setIsTableOpen(false);
    setIsExitConfirmOpen(false);
    setIsDiagramsOpen(true);
    setWorkspaceSlots([createWorkspacePane("diagrams")]);
    setWorkspacePaneWidths([1]);
  }

  function closeDiagrams() {
    const nextSlots = workspaceSlots.filter((slot) => getWorkspacePaneType(slot) !== "diagrams");
    setWorkspaceSlots(nextSlots);
    setWorkspacePaneWidths(createEqualPaneWidths(nextSlots.length));
    syncWorkspaceToolFlags(nextSlots);
    setSideToolMenu(null);
  }

  function openWorkspaceMenuFromApp() {
    setSideToolMenu((currentSide) => (currentSide === "right" ? null : "right"));
  }

  function getCurrentWorkspaceSlots() {
    if (workspaceSlots.length > 0) return workspaceSlots;
    if (isTableOpen) return [createWorkspacePane("table")];
    if (isDiagramsOpen) return [createWorkspacePane("diagrams")];
    return [];
  }

  function placeToolInWorkspaceSlots(tool, side) {
    const currentSlots = getCurrentWorkspaceSlots();
    const nextPane = createWorkspacePane(tool);
    return side === "left" ? [nextPane, ...currentSlots] : [...currentSlots, nextPane];
  }

  function createWorkspacePane(type, tableDocumentId = DEFAULT_TABLE_DOCUMENT_ID) {
    const id = `workspace-pane-${nextWorkspacePaneId.current}`;
    nextWorkspacePaneId.current += 1;
    return {
      id,
      type,
      tableState: createDefaultTablePaneState(tableDocumentId),
      diagramState: {
        activeView: "stacking",
        stackingSettings: createDefaultStackingSettings(),
      },
    };
  }

  function getWorkspacePaneType(slot) {
    return typeof slot === "string" ? slot : slot.type;
  }

  function getWorkspacePaneId(slot, index) {
    return typeof slot === "string" ? `${slot}-${index}` : slot.id;
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
        selectionAnchor: tableSelectionAnchor,
      });
      setSortConfig(nextState.sortConfig ?? null);
      setAdvancedSortConfig(nextState.advancedSortConfig ?? null);
      setSelectedTableCells(nextState.selectedCells ?? []);
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

  function getActiveTableSelectedCells() {
    if (!activeTablePaneId) return selectedTableCells;
    return getTablePaneStateById(activeTablePaneId).selectedCells ?? [];
  }

  function closeWorkspacePane(paneId) {
    const nextSlots = workspaceSlots.filter((slot, index) => getWorkspacePaneId(slot, index) !== paneId);
    const nextWidths = getPaneWidthsWithoutPane(paneId);
    setWorkspaceSlots(nextSlots);
    setWorkspacePaneWidths(nextWidths);
    syncWorkspaceToolFlags(nextSlots);
    setSideToolMenu(null);
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
    const nextSlots = placeToolInWorkspaceSlots(tool, side);
    setIsToolMenuOpen(false);
    setSideToolMenu(null);
    setWorkspaceSlots(nextSlots);
    setWorkspacePaneWidths(getPaneWidthsWithAddedPane(currentSlots.length, side));
    syncWorkspaceToolFlags(nextSlots);

    if (nextSlots.some((slot) => getWorkspacePaneType(slot) === "table")) {
      await prepareTableForWorkspace();
    }
  }

  async function openTable() {
    setIsToolMenuOpen(false);
    setSideToolMenu(null);
    setIsDiagramsOpen(false);
    setIsTableOpen(true);
    setWorkspaceSlots([createWorkspacePane("table")]);
    setWorkspacePaneWidths([1]);
    await prepareTableForWorkspace();
  }

  function updateRow(rowId, field, value, documentId = DEFAULT_TABLE_DOCUMENT_ID) {
    updateTableDocument(documentId, (tableDocument) => ({
      ...tableDocument,
      draftRows: tableDocument.draftRows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    }));
  }

  function clearTableSelection() {
    setSelectedTableCells([]);
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
      selectionAnchor: null,
    }));
  }

  function selectSingleTableCell(rowId, columnKey, paneId) {
    const cell = { rowId, columnKey };
    const selectedCells = [getCellKey(rowId, columnKey)];
    if (paneId) setActiveTablePaneId(paneId);
    updateTablePaneState(paneId, (state) => ({
      ...state,
      selectedCells,
      selectionAnchor: cell,
    }));
  }

  function handleTableCellMouseDown(
    event,
    rowId,
    columnKey,
    paneId,
    paneSelectedCells = selectedTableCells,
    paneSelectionAnchor = tableSelectionAnchor,
    paneVisibleRowIndexById = visibleRowIndexById,
    paneSortedRows = sortedRows,
  ) {
    if (event.button !== 0) return;
    if (paneId) setActiveTablePaneId(paneId);

    const cell = { rowId, columnKey };
    const cellKey = getCellKey(rowId, columnKey);

    if (event.shiftKey) {
      event.preventDefault();
      blurActiveTableInput();
      const anchor = paneSelectionAnchor ?? cell;
      updateTablePaneState(paneId, (state) => ({
        ...state,
        selectedCells: getCellKeysInRange(anchor, cell, paneVisibleRowIndexById, paneSortedRows),
        selectionAnchor: paneSelectionAnchor ?? cell,
      }));
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      blurActiveTableInput();
      updateTablePaneState(paneId, (state) => ({
        ...state,
        selectedCells: paneSelectedCells.includes(cellKey)
          ? paneSelectedCells.filter((key) => key !== cellKey)
          : [...paneSelectedCells, cellKey],
        selectionAnchor: cell,
      }));
      return;
    }

    selectSingleTableCell(rowId, columnKey, paneId);
  }

  function getCellKeysInRange(startCell, endCell, rowIndexById = visibleRowIndexById, rows = sortedRows) {
    const startRowIndex = rowIndexById.get(startCell.rowId);
    const endRowIndex = rowIndexById.get(endCell.rowId);
    const startColumnIndex = columnIndexByKey.get(startCell.columnKey);
    const endColumnIndex = columnIndexByKey.get(endCell.columnKey);

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
        const column = columns[columnIndex];
        if (column) keys.push(getCellKey(row.id, column.key));
      }
    }

    return keys;
  }

  function getTableCellClassName(
    rowId,
    columnKey,
    paneSelectedCells = selectedTableCells,
    paneSelectedCellSet = selectedTableCellSet,
    paneVisibleRowIndexById = visibleRowIndexById,
    paneSortedRows = sortedRows,
    paneCellStyles = cellStyles,
  ) {
    const cellKey = getCellKey(rowId, columnKey);
    const classes = [];
    const style = paneCellStyles[cellKey];

    if (paneSelectedCellSet.has(cellKey)) {
      classes.push("is-cell-selected");
      if (paneSelectedCells.length > 1) classes.push("is-cell-multi-selected");

      const rowIndex = paneVisibleRowIndexById.get(rowId);
      const columnIndex = columnIndexByKey.get(columnKey);
      if (rowIndex === undefined || columnIndex === undefined) {
        classes.push("cell-edge-top", "cell-edge-right", "cell-edge-bottom", "cell-edge-left");
      } else {
        if (!isTableCellSelectedAt(rowIndex - 1, columnIndex, paneSortedRows, paneSelectedCellSet)) classes.push("cell-edge-top");
        if (!isTableCellSelectedAt(rowIndex, columnIndex + 1, paneSortedRows, paneSelectedCellSet)) classes.push("cell-edge-right");
        if (!isTableCellSelectedAt(rowIndex + 1, columnIndex, paneSortedRows, paneSelectedCellSet)) classes.push("cell-edge-bottom");
        if (!isTableCellSelectedAt(rowIndex, columnIndex - 1, paneSortedRows, paneSelectedCellSet)) classes.push("cell-edge-left");
      }
    }

    if (style?.bold) classes.push("is-cell-bold");
    if (style?.italic) classes.push("is-cell-italic");
    if (style?.underline) classes.push("is-cell-underline");

    return classes.join(" ");
  }

  function isTableCellSelectedAt(rowIndex, columnIndex, rows = sortedRows, selectedSet = selectedTableCellSet) {
    const row = rows[rowIndex];
    const column = columns[columnIndex];
    return Boolean(row && column && selectedSet.has(getCellKey(row.id, column.key)));
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
      );
      const savedData = await putProgramData(nextData);
      setTableDocumentFromData(documentId, savedData);
      setStatusMessage("");
      setIsExitConfirmOpen(false);
      const nextSlots = paneId
        ? workspaceSlots.filter((slot, index) => getWorkspacePaneId(slot, index) !== paneId)
        : workspaceSlots.filter((slot) => getWorkspacePaneType(slot) !== "table");
      const nextWidths = paneId ? getPaneWidthsWithoutPane(paneId) : createEqualPaneWidths(nextSlots.length);
      setWorkspaceSlots(nextSlots);
      setWorkspacePaneWidths(nextWidths);
      syncWorkspaceToolFlags(nextSlots);
      if (paneId) {
        if (activeTablePaneId === paneId) setActiveTablePaneId(null);
        if (advancedSortPaneId === paneId) closeAdvancedSortDialog();
      } else {
        clearTableSelection();
      }
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSaving(false);
      setSavingTablePaneId(null);
    }
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

  function renderMatrixIcon() {
    return (
      <svg className="matrix-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        {[1, 7, 13].flatMap((x) =>
          [1, 7, 13].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="0.8" />),
        )}
      </svg>
    );
  }

  function renderDiagramsIcon() {
    return (
      <svg className="diagrams-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <rect x="2.4" y="4.4" width="6.6" height="2.8" rx="0.75" />
        <rect x="7.6" y="6" width="2.8" height="6" rx="0.75" />
        <rect x="8.8" y="10.8" width="6.8" height="2.8" rx="0.75" />
      </svg>
    );
  }

  function renderSideToolMenu(side) {
    if (sideToolMenu !== side) return null;

    const tableAngle = side === "left" ? "-45deg" : "-135deg";
    const diagramsAngle = side === "left" ? "45deg" : "135deg";
    const tableCounterAngle = side === "left" ? "45deg" : "135deg";
    const diagramsCounterAngle = side === "left" ? "-45deg" : "-135deg";

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
      </aside>
    );
  }

  function renderDiagramsPane(slot, paneIndex) {
    const paneId = getWorkspacePaneId(slot, paneIndex);
    const diagramState = typeof slot === "string"
      ? { activeView: activeDiagramView, stackingSettings }
      : slot.diagramState ?? { activeView: "stacking", stackingSettings: createDefaultStackingSettings() };
    const paneActiveDiagramView = diagramState.activeView ?? "stacking";
    const paneStackingSettings = diagramState.stackingSettings ?? createDefaultStackingSettings();
    const titleId = `diagrams-title-${paneIndex}`;

    const updateDiagramState = (updater) => {
      updateWorkspacePane(paneId, (pane) => ({
        ...pane,
        diagramState: updater(pane.diagramState ?? { activeView: "stacking", stackingSettings: createDefaultStackingSettings() }),
      }));
    };

    const updateStackingSettings = (updater) => {
      updateDiagramState((currentState) => ({
        ...currentState,
        stackingSettings: updater(currentState.stackingSettings ?? createDefaultStackingSettings()),
      }));
    };

    return (
      <section className="diagrams-panel diagrams-app" id={`diagrams-panel-${paneIndex}`} aria-labelledby={titleId}>
        <header className="diagrams-panel-header">
          <h2 id={titleId}>Diagrams</h2>
        </header>
        <div className="diagrams-panel-body" role="tabpanel" aria-label={paneActiveDiagramView === "stacking" ? "Stacking" : "Areas"}>
          <aside className="diagrams-settings-sidebar">
            <div className="diagrams-panel-tabs" role="tablist" aria-label="Diagram views">
              <button
                className={`diagrams-tab${paneActiveDiagramView === "stacking" ? " is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={paneActiveDiagramView === "stacking"}
                onClick={() => updateDiagramState((currentState) => ({ ...currentState, activeView: "stacking" }))}
              >
                Stacking
              </button>
              <button
                className={`diagrams-tab${paneActiveDiagramView === "areas" ? " is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={paneActiveDiagramView === "areas"}
                onClick={() => updateDiagramState((currentState) => ({ ...currentState, activeView: "areas" }))}
              >
                Areas
              </button>
            </div>
            {paneActiveDiagramView === "stacking" && (
              <div className="diagrams-settings" aria-label="Stacking diagram settings">
                <label className="diagrams-field">
                  <span>Default Floor-to-Floor Height:</span>
                  <span className="diagrams-height-inputs">
                    <input
                      className="diagrams-number-input"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={paneStackingSettings.defaultFloorToFloorFeet}
                      aria-label="Default floor-to-floor height feet"
                      onChange={(event) =>
                        updateStackingSettings((settings) => ({
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
                      value={paneStackingSettings.defaultFloorToFloorInches}
                      aria-label="Default floor-to-floor height inches"
                      onChange={(event) =>
                        updateStackingSettings((settings) => ({
                          ...settings,
                          defaultFloorToFloorInches: event.target.value,
                        }))
                      }
                    />
                    <span aria-hidden="true">"</span>
                  </span>
                </label>

                <label className="diagrams-field">
                  <span>Level of Detail:</span>
                  <select
                    value={paneStackingSettings.levelOfDetail}
                    onChange={(event) =>
                      updateStackingSettings((settings) => ({
                        ...settings,
                        levelOfDetail: event.target.value,
                      }))
                    }
                  >
                    <option value="functionalGroup">Functional Group</option>
                    <option value="departmentFunction">Department Function</option>
                    <option value="department">Department</option>
                    <option value="functionalArea">Functional Area</option>
                    <option value="room">Room</option>
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
                    value={paneStackingSettings.textSize}
                    onChange={(event) =>
                      updateStackingSettings((settings) => ({
                        ...settings,
                        textSize: event.target.value,
                      }))
                    }
                  />
                </label>

                <button
                  className={`diagrams-toggle-button${paneStackingSettings.grossSquareFootage ? " is-on" : ""}`}
                  type="button"
                  aria-pressed={paneStackingSettings.grossSquareFootage}
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
                  className={`diagrams-toggle-button${paneStackingSettings.netSquareFootage ? " is-on" : ""}`}
                  type="button"
                  aria-pressed={paneStackingSettings.netSquareFootage}
                  onClick={() =>
                    updateStackingSettings((settings) => ({
                      ...settings,
                      netSquareFootage: !settings.netSquareFootage,
                    }))
                  }
                >
                  <span>Net Square Footage</span>
                </button>
              </div>
            )}
          </aside>
          <div className="diagrams-canvas" aria-label="Diagram canvas" />
        </div>
      </section>
    );
  }

  function renderTablePane(slot, paneIndex) {
    const paneId = getWorkspacePaneId(slot, paneIndex);
    const tableState = typeof slot === "string"
      ? { documentId: DEFAULT_TABLE_DOCUMENT_ID, sortConfig, advancedSortConfig, selectedCells: selectedTableCells, selectionAnchor: tableSelectionAnchor }
      : slot.tableState ?? createDefaultTablePaneState();
    const documentId = tableState.documentId ?? DEFAULT_TABLE_DOCUMENT_ID;
    const tableDocument = getTableDocument(documentId);
    const paneSortConfig = tableState.sortConfig ?? null;
    const paneAdvancedSortConfig = tableState.advancedSortConfig ?? null;
    const paneSelectedCells = tableState.selectedCells ?? [];
    const paneSelectedCellSet = new Set(paneSelectedCells);
    const paneSortedRows = sortRows(tableDocument.draftRows, paneSortConfig, paneAdvancedSortConfig);
    const paneVisibleRowIndexById = new Map(paneSortedRows.map((row, index) => [row.id, index]));
    const titleId = `program-table-title-${paneIndex}`;
    const isPaneSaving = savingTablePaneId === paneId;
    const isPaneImporting = activeSpreadsheetImportPaneId === paneId && isImporting;
    const shouldShowLoading = isLoading && (!isImporting || !activeSpreadsheetImportPaneId || isPaneImporting);
    const spreadsheetTitle = tableDocument.draftProjectName || "Untitled Project";
    const isTitleMenuOpen = openSpreadsheetTitlePaneId === paneId;
    const documentOptions = getAvailableTableDocumentOptions(documentId);
    const selectableDocumentOptions = documentOptions.filter((option) => option.id !== documentId);

    return (
      <section className="table-modal table-app" role="region" aria-labelledby={titleId}>
        <header className="table-modal-header">
          <div
            className={`program-title-dropdown${isTitleMenuOpen ? " is-open" : ""}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              id={titleId}
              className="program-title-input program-title-trigger"
              type="button"
              aria-label="Spreadsheet"
              aria-haspopup="menu"
              aria-expanded={isTitleMenuOpen}
              onClick={() => toggleSpreadsheetTitleMenu(paneId)}
            >
              <span className="program-title-text">{spreadsheetTitle}</span>
              <span className="program-title-arrow" aria-hidden="true" />
            </button>
            {isTitleMenuOpen && (
              <div className="program-title-menu" role="menu" aria-label="Spreadsheet options">
                <button className="program-title-menu-current" type="button" role="menuitem" onClick={() => setOpenSpreadsheetTitlePaneId(null)}>
                  <span className="program-title-text">{spreadsheetTitle}</span>
                  <span className="program-title-arrow" aria-hidden="true" />
                </button>
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

        <div className="table-shell">
          {shouldShowLoading ? (
            <div className="empty-state">{isPaneImporting ? "Importing" : "Loading"}</div>
          ) : errorMessage && tableDocument.draftRows.length === 0 ? (
            <div className="empty-state">{errorMessage}</div>
          ) : (
            <table className="program-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      className={column.className}
                      key={column.key}
                      scope="col"
                      aria-sort={getAriaSort(column.key, paneSortConfig)}
                      onContextMenu={(event) => openColumnMenu(event, column.key, paneId)}
                    >
                      <button className="column-sort-button" type="button" onClick={() => handleSort(column.key, paneId)}>
                        <span className="column-label">{column.label}</span>
                        <span className={`sort-icon ${getSortIconClass(column.key, paneSortConfig)}`} aria-hidden="true">
                          <span className="sort-triangle sort-triangle-up" />
                          <span className="sort-triangle sort-triangle-down" />
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paneSortedRows.map((row) => {
                  const totalNsf = computeTotalNsf(row.quantity, row.nsfPerUnit);

                  return (
                    <tr key={row.id}>
                      {columns.map((column) => {
                        const cellClassName = [
                          column.className,
                          getTableCellClassName(
                            row.id,
                            column.key,
                            paneSelectedCells,
                            paneSelectedCellSet,
                            paneVisibleRowIndexById,
                            paneSortedRows,
                            tableDocument.cellStyles,
                          ),
                        ]
                          .filter(Boolean)
                          .join(" ");

                        return (
                          <td
                            className={cellClassName}
                            key={column.key}
                            onMouseDown={(event) =>
                              handleTableCellMouseDown(
                                event,
                                row.id,
                                column.key,
                                paneId,
                                paneSelectedCells,
                                tableState.selectionAnchor,
                                paneVisibleRowIndexById,
                                paneSortedRows,
                              )
                            }
                          >
                            {column.key === "totalNsf" ? (
                              <output aria-label={getCellAriaLabel(row, column)}>{formatArea(totalNsf)}</output>
                            ) : (
                              <input
                                value={row[column.key]}
                                inputMode={getCellInputMode(column.key)}
                                onChange={(event) => updateRow(row.id, column.key, event.target.value, documentId)}
                                onFocus={() => selectSingleTableCell(row.id, column.key, paneId)}
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
          )}
        </div>

        <footer className="table-modal-footer">
          <div className="footer-left-actions">
            <button className="secondary-button" type="button" onClick={() => openSpreadsheetImportPicker(paneId)} disabled={isPaneSaving || isPaneImporting}>
              {isPaneImporting ? "Importing" : "Import"}
            </button>
            <div className="save-status" role="status">
              {errorMessage || statusMessage}
            </div>
          </div>
          <div className="footer-actions">
            <button className="primary-button" type="button" onClick={() => handleSave(paneId)} disabled={shouldShowLoading || isPaneSaving || isPaneImporting}>
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
      <div className={`workspace-pane-shell${showResizePreview ? " is-resizing" : ""}`}>
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
                    <svg className="diagrams-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                      <rect x="2.4" y="4.4" width="6.6" height="2.8" rx="0.75" />
                      <rect x="7.6" y="6" width="2.8" height="6" rx="0.75" />
                      <rect x="8.8" y="10.8" width="6.8" height="2.8" rx="0.75" />
                    </svg>
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
          <div className="workspace-app-shell">
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

        {false && isDiagramsOpen && (
          <div className="workspace-app-shell">
            <aside className="workspace-side-strip" aria-label="Left workspace actions">
              <button className="workspace-add-button workspace-side-add-button" type="button" onClick={openWorkspaceMenuFromApp} aria-label="Add interface">
                <svg className="plus-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                  <path d="M8 3h2v5h5v2h-5v5H8v-5H3V8h5z" />
                </svg>
              </button>
            </aside>
            <section className="diagrams-panel diagrams-app" id="diagrams-panel" aria-labelledby="diagrams-title">
            <header className="diagrams-panel-header">
              <h2 id="diagrams-title">Diagrams</h2>
              <button className="secondary-button diagrams-close-button" type="button" onClick={closeDiagrams}>
                Close
              </button>
            </header>
            <div className="diagrams-panel-tabs" role="tablist" aria-label="Diagram views">
              <button
                className={`diagrams-tab${activeDiagramView === "stacking" ? " is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={activeDiagramView === "stacking"}
                onClick={() => setActiveDiagramView("stacking")}
              >
                Stacking
              </button>
              <button
                className={`diagrams-tab${activeDiagramView === "areas" ? " is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={activeDiagramView === "areas"}
                onClick={() => setActiveDiagramView("areas")}
              >
                Areas
              </button>
            </div>
            <div className="diagrams-panel-body" role="tabpanel" aria-label={activeDiagramView === "stacking" ? "Stacking" : "Areas"}>
              {activeDiagramView === "stacking" && (
                <div className="diagrams-settings" aria-label="Stacking diagram settings">
                  <label className="diagrams-field">
                    <span>Default Floor-to-Floor Height:</span>
                    <span className="diagrams-height-inputs">
                      <input
                        className="diagrams-number-input"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={stackingSettings.defaultFloorToFloorFeet}
                        aria-label="Default floor-to-floor height feet"
                        onChange={(event) =>
                          setStackingSettings((settings) => ({
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
                        value={stackingSettings.defaultFloorToFloorInches}
                        aria-label="Default floor-to-floor height inches"
                        onChange={(event) =>
                          setStackingSettings((settings) => ({
                            ...settings,
                            defaultFloorToFloorInches: event.target.value,
                          }))
                        }
                      />
                      <span aria-hidden="true">"</span>
                    </span>
                  </label>

                  <label className="diagrams-field">
                    <span>Level of Detail:</span>
                    <select
                      value={stackingSettings.levelOfDetail}
                      onChange={(event) =>
                        setStackingSettings((settings) => ({
                          ...settings,
                          levelOfDetail: event.target.value,
                        }))
                      }
                    >
                      <option value="functionalGroup">Functional Group</option>
                      <option value="departmentFunction">Department Function</option>
                      <option value="department">Department</option>
                      <option value="functionalArea">Functional Area</option>
                      <option value="room">Room</option>
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
                      value={stackingSettings.textSize}
                      onChange={(event) =>
                        setStackingSettings((settings) => ({
                          ...settings,
                          textSize: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <button
                    className={`diagrams-toggle-button${stackingSettings.grossSquareFootage ? " is-on" : ""}`}
                    type="button"
                    aria-pressed={stackingSettings.grossSquareFootage}
                    onClick={() =>
                      setStackingSettings((settings) => ({
                        ...settings,
                        grossSquareFootage: !settings.grossSquareFootage,
                      }))
                    }
                  >
                    <span>Gross Square Footage</span>
                  </button>

                  <button
                    className={`diagrams-toggle-button${stackingSettings.netSquareFootage ? " is-on" : ""}`}
                    type="button"
                    aria-pressed={stackingSettings.netSquareFootage}
                    onClick={() =>
                      setStackingSettings((settings) => ({
                        ...settings,
                        netSquareFootage: !settings.netSquareFootage,
                      }))
                    }
                  >
                    <span>Net Square Footage</span>
                  </button>
                </div>
              )}
            </div>
            </section>
            <aside className="workspace-side-strip" aria-label="Right workspace actions">
              <button className="workspace-add-button workspace-side-add-button" type="button" onClick={openWorkspaceMenuFromApp} aria-label="Add interface">
                <svg className="plus-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                  <path d="M8 3h2v5h5v2h-5v5H8v-5H3V8h5z" />
                </svg>
              </button>
            </aside>
          </div>
        )}

        <button className="project-menu-button" type="button" onClick={toggleProjectMenu} aria-label="Project menu" aria-expanded={isProjectMenuOpen}>
          <svg className="dots-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>

        {isProjectMenuOpen && (
          <div className="project-actions-menu" role="menu" onClick={(event) => event.stopPropagation()}>
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
        )}

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

        {false && isTableOpen && (
          <div className="modal-layer workspace-app-shell" role="presentation">
            <aside className="workspace-side-strip" aria-label="Left workspace actions">
              <button className="workspace-add-button workspace-side-add-button" type="button" onClick={openWorkspaceMenuFromApp} aria-label="Add interface">
                <svg className="plus-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                  <path d="M8 3h2v5h5v2h-5v5H8v-5H3V8h5z" />
                </svg>
              </button>
            </aside>
            <section className="table-modal table-app" role="region" aria-labelledby="program-table-title">
              <header className="table-modal-header">
                <input
                  id="program-table-title"
                  className="program-title-input"
                  value={draftProjectName}
                  onChange={(event) => setDraftProjectName(event.target.value)}
                  aria-label="Program title"
                />
                <div className="modal-metrics" aria-label="Program data totals">
                  <span className="metric-container">{draftRows.length.toLocaleString()} rows</span>
                  <span className="metric-container">Total NSF: {formatArea(totals.totalNsf)}</span>
                </div>
              </header>

              <div className="table-shell">
                {isLoading ? (
                  <div className="empty-state">{isImporting ? "Importing" : "Loading"}</div>
                ) : errorMessage && draftRows.length === 0 ? (
                  <div className="empty-state">{errorMessage}</div>
                ) : (
                  <table className="program-table">
                    <thead>
                      <tr>
                        {columns.map((column) => (
                          <th
                            className={column.className}
                            key={column.key}
                            scope="col"
                            aria-sort={getAriaSort(column.key, sortConfig)}
                            onContextMenu={(event) => openColumnMenu(event, column.key)}
                          >
                            <button className="column-sort-button" type="button" onClick={() => handleSort(column.key)}>
                              <span className="column-label">{column.label}</span>
                              <span className={`sort-icon ${getSortIconClass(column.key, sortConfig)}`} aria-hidden="true">
                                <span className="sort-triangle sort-triangle-up" />
                                <span className="sort-triangle sort-triangle-down" />
                              </span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => {
                        const totalNsf = computeTotalNsf(row.quantity, row.nsfPerUnit);

                        return (
                          <tr key={row.id}>
                            {columns.map((column) => {
                              const cellClassName = [column.className, getTableCellClassName(row.id, column.key)]
                                .filter(Boolean)
                                .join(" ");

                              return (
                                <td
                                  className={cellClassName}
                                  key={column.key}
                                  onMouseDown={(event) => handleTableCellMouseDown(event, row.id, column.key)}
                                >
                                  {column.key === "totalNsf" ? (
                                    <output aria-label={getCellAriaLabel(row, column)}>{formatArea(totalNsf)}</output>
                                  ) : (
                                    <input
                                      value={row[column.key]}
                                      inputMode={getCellInputMode(column.key)}
                                      onChange={(event) => updateRow(row.id, column.key, event.target.value)}
                                      onFocus={() => selectSingleTableCell(row.id, column.key)}
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
                )}
              </div>

              <footer className="table-modal-footer">
                <div className="footer-left-actions">
                  <button className="secondary-button" type="button" onClick={openSpreadsheetImportPicker} disabled={isSaving || isImporting}>
                    {isImporting ? "Importing" : "Import"}
                  </button>
                  <div className="save-status" role="status">
                    {errorMessage || statusMessage}
                  </div>
                </div>
                <div className="footer-actions">
                  <button className="secondary-button" type="button" onClick={requestTableClose} disabled={isSaving || isImporting}>
                    Cancel
                  </button>
                  <button className="primary-button" type="button" onClick={handleSave} disabled={isLoading || isSaving || isImporting}>
                    {isSaving ? "Saving" : "Save"}
                  </button>
                </div>
              </footer>
            </section>
            <aside className="workspace-side-strip" aria-label="Right workspace actions">
              <button className="workspace-add-button workspace-side-add-button" type="button" onClick={openWorkspaceMenuFromApp} aria-label="Add interface">
                <svg className="plus-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                  <path d="M8 3h2v5h5v2h-5v5H8v-5H3V8h5z" />
                </svg>
              </button>
            </aside>

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
                        setIsExitConfirmOpen(false);
                      }}
                    >
                      Keep Editing
                    </button>
                  </div>
                </section>
              </div>
            )}
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

function getCellKey(rowId, columnKey) {
  return `${rowId}::${columnKey}`;
}

function getCellInputMode(columnKey) {
  if (columnKey === "quantity" || columnKey === "nsfPerUnit") return "decimal";
  if (columnKey === "floor") return "numeric";
  return undefined;
}

function getCellAriaLabel(row, column) {
  const rowLabel = row.program || "Program row";
  return `${rowLabel} ${column.label}`;
}

function blurActiveTableInput() {
  if (typeof document === "undefined") return;

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && activeElement.closest(".program-table")) {
    activeElement.blur();
  }
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
      };
    });
}

function mergeRowsIntoProgramData(data, rows, cellStyles = {}, projectName) {
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

  next.floors = [...(next.floors ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  updateGroupDefaultFloors(next);
  updateDerivedTotals(next);

  next.project.updated_at = new Date().toISOString();

  return next;
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

function summarizeRows(rows) {
  return rows.reduce(
    (totals, row) => ({
      totalNsf: totals.totalNsf + computeTotalNsf(row.quantity, row.nsfPerUnit),
    }),
    { totalNsf: 0 },
  );
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
