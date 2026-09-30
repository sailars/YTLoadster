import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { api } from "../lib/api";
import { useI18n, type TranslationKey } from "../lib/i18n";
import {
  aggregatePlaylistFormats,
  defaultPlaylistParameters,
  makeCookieSource,
  mediaSignatureForRequest,
  qualityProfileHeight,
  resolvePlaylistItem,
  retryAfterAuthentication,
  summarizePlaylistSize,
  type PlaylistDownloadMode,
  type PlaylistParameters,
  type ResolvedPlaylistItem,
} from "../lib/playlistModel";
import type {
  BatchDownloadItem,
  BrowserAuthSettings,
  DiskSpace,
  HistoryDuplicate,
  Job,
  MediaInfo,
  PlaylistEntry,
  PlaylistInfo,
  PlaylistItemAnalysis,
  PlaylistFormatSelectionMode,
  ProbeIssue,
  VideoDownloadProfile,
} from "../lib/types";
import { ParameterSelect, type ParameterSelectOption } from "./ParameterSelect";
import { MediaThumbnail } from "./MediaThumbnail";
import { PlaylistDownloadIcon } from "./PlaylistDownloadIcon";
import { AudioWaveIcon } from "./downloader/AudioWaveIcon";
import { DownloadActionButton } from "./downloader/DownloadSummaryCard";
import { DownloadModeTabs } from "./downloader/DownloadModeTabs";
import { UrlInput } from "./downloader/UrlInput";
import { createVideoProfileOptions } from "./downloader/VideoDownloadOptions";

type Layout = "wide" | "stacked";
type AnalysisState = "pending" | "analyzing" | "ready" | "requiresAuth" | "unavailable" | "temporaryError" | "error";
type PlaylistColumn = "title" | "duration" | "size" | "status";
type PlaylistColumnWidths = Record<PlaylistColumn, number>;

const defaultColumnWidths: PlaylistColumnWidths = { title: 370, duration: 78, size: 96, status: 140 };

type PlaylistRow = {
  entry: PlaylistEntry;
  selected: boolean;
  analysisState: AnalysisState;
  media?: MediaInfo | null;
  issue?: ProbeIssue | null;
  jobId?: number | null;
  rejection?: string | null;
};

type BatchDraft = {
  items: BatchDownloadItem[];
  baselineSkipped: number;
  warningCount: number;
};

type Props = {
  url: string;
  defaultDestinationDir?: string | null;
  sourceIsPlaylist: boolean;
  authSettings: BrowserAuthSettings;
  authenticated: boolean;
  includeVideoTechnicalDetailsInFilename: boolean;
  formatSelectionMode: PlaylistFormatSelectionMode;
  showThumbnails?: boolean;
  jobs: Job[];
  finishedMediaSignatures: Set<string>;
  onUrlChange: (url: string) => void;
  onJobsCreated: (jobs: Job[]) => void;
  onOpenQueue: () => void;
};

export function Playlist({
  url,
  defaultDestinationDir,
  sourceIsPlaylist,
  authSettings,
  authenticated,
  includeVideoTechnicalDetailsInFilename,
  formatSelectionMode,
  showThumbnails = true,
  jobs,
  finishedMediaSignatures,
  onUrlChange,
  onJobsCreated,
  onOpenQueue,
}: Props) {
  const { locale, t } = useI18n();
  const [layout, setLayout] = useState<Layout>("wide");
  const [playlist, setPlaylist] = useState<PlaylistInfo | null>(null);
  const [rows, setRows] = useState<PlaylistRow[]>([]);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisStopped, setAnalysisStopped] = useState(false);
  const [largePlaylistWarning, setLargePlaylistWarning] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [diskSpace, setDiskSpace] = useState<DiskSpace | null>(null);
  const [diskSpacePending, setDiskSpacePending] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<Layout, PlaylistColumnWidths>>({
    wide: { ...defaultColumnWidths },
    stacked: { ...defaultColumnWidths },
  });
  const [params, setParams] = useState<PlaylistParameters>({
    ...defaultPlaylistParameters,
    includeVideoTechnicalDetailsInFilename,
    formatSelectionMode,
  });
  const [enqueueing, setEnqueueing] = useState(false);
  const [enqueueResult, setEnqueueResult] = useState<{ added: number; skipped: number } | null>(null);
  const [duplicateDraft, setDuplicateDraft] = useState<{ draft: BatchDraft; duplicates: HistoryDuplicate[] } | null>(null);
  const [warningDraft, setWarningDraft] = useState<BatchDraft | null>(null);

  const rowsRef = useRef(rows);
  const authSettingsRef = useRef(authSettings);
  const generationRef = useRef(0);
  const stopRef = useRef(false);
  const pendingIdsRef = useRef<string[]>([]);
  const analysisWorkersActiveRef = useRef(false);
  const analysisSessionRef = useRef("");
  const cancelledAnalysisSessionsRef = useRef<Set<string>>(new Set());
  const analysisSequenceRef = useRef(0);
  const analysisRequestSequenceRef = useRef(0);
  const authenticatedRef = useRef(authenticated);
  const fittedColumnLayoutsRef = useRef<Set<Layout>>(new Set());
  const previousDefaultDestinationDir = useRef<string | null>(null);

  useEffect(() => {
    const previous = authSettingsRef.current;
    authSettingsRef.current = authSettings;
    const browserCookiesChanged = authSettings.useBrowserCookies
      && (!previous.useBrowserCookies || previous.browser !== authSettings.browser);
    if (browserCookiesChanged) retryAuthenticationRows();
  }, [authSettings]);

  useEffect(() => {
    setParams((current) => ({
      ...current,
      includeVideoTechnicalDetailsInFilename,
    }));
  }, [includeVideoTechnicalDetailsInFilename]);

  useEffect(() => {
    setParams((current) => ({ ...current, formatSelectionMode }));
  }, [formatSelectionMode]);

  useEffect(() => {
    updateRows((current) => current.map((row) => row.rejection ? { ...row, rejection: null } : row));
    setEnqueueResult(null);
  }, [
    params.mode,
    params.videoProfile,
    params.resolution,
    params.fps,
    params.container,
    params.codec,
    params.audioPreset,
    params.audioBitrate,
    params.audioChannels,
    params.embedMetadata,
    params.embedThumbnail,
    params.subtitleLanguage,
    params.subtitleFormat,
    params.allowAutomaticSubtitles,
    params.formatSelectionMode,
  ]);

  useEffect(() => {
    if (defaultDestinationDir === undefined) {
      api.getDefaultDownloadDir()
        .then((destinationDir) => setParams((current) => current.destinationDir ? current : { ...current, destinationDir }))
        .catch(() => setParams((current) => current.destinationDir ? current : { ...current, destinationDir: "Downloads" }));
      return;
    }
    if (!defaultDestinationDir) return;
    setParams((current) =>
      !current.destinationDir || current.destinationDir === previousDefaultDestinationDir.current
        ? { ...current, destinationDir: defaultDestinationDir }
        : current,
    );
    previousDefaultDestinationDir.current = defaultDestinationDir;
  }, [defaultDestinationDir]);

  useEffect(() => {
    const destination = params.destinationDir.trim();
    setDiskSpace(null);
    if (!destination) {
      setDiskSpacePending(false);
      return;
    }
    setDiskSpacePending(true);
    let current = true;
    const timer = window.setTimeout(() => {
      void api.getAvailableDiskSpace(destination)
        .then((space) => {
          if (current) setDiskSpace(space);
        })
        .catch(() => {
          if (current) setDiskSpace(null);
        })
        .finally(() => {
          if (current) setDiskSpacePending(false);
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [params.destinationDir]);

  useEffect(() => {
    const becameAuthenticated = authenticated && !authenticatedRef.current;
    authenticatedRef.current = authenticated;
    if (!becameAuthenticated) return;
    retryAuthenticationRows();
  }, [authenticated]);

  function retryAuthenticationRows() {
    const retryIds = rowsRef.current
      .filter((row) => retryAfterAuthentication(row.issue?.code))
      .map((row) => row.entry.id);
    if (!retryIds.length) return;
    updateRows((current) => current.map((row) => retryIds.includes(row.entry.id)
      ? { ...row, analysisState: "pending", issue: null, rejection: null }
      : row));
    beginAnalysis(retryIds, generationRef.current);
  }

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    stopRef.current = true;
    pendingIdsRef.current = [];
    setAnalysisRunning(false);
    setAnalysisStopped(false);
    setRateLimited(false);
    setLargePlaylistWarning(false);
    setEnqueueResult(null);
    setPlaylistError(null);

    const currentUrl = url.trim();
    if (!sourceIsPlaylist || !currentUrl) {
      setPlaylist(null);
      updateRows(() => []);
      setLoadingPlaylist(false);
      return;
    }

    setLoadingPlaylist(true);
    setPlaylist(null);
    updateRows(() => []);
    const analysisId = nextPlaylistAnalysisId();
    analysisSessionRef.current = analysisId;
    const timer = window.setTimeout(async () => {
      try {
        const info = await api.probePlaylist(currentUrl, makeCookieSource(authSettingsRef.current), analysisId);
        if (generation !== generationRef.current) return;
        setPlaylist(info);
        const initialRows = info.entries.map((entry) => ({
          entry,
          selected: true,
          analysisState: "pending" as const,
          media: null,
          issue: null,
          jobId: null,
          rejection: null,
        }));
        rowsRef.current = initialRows;
        setRows(initialRows);
        if (initialRows.length > 50) {
          stopRef.current = true;
          setAnalysisStopped(true);
          setLargePlaylistWarning(true);
        } else {
          beginAnalysis(initialRows.map((row) => row.entry.id), generation);
        }
      } catch (error) {
        if (generation === generationRef.current) {
          setPlaylistError(isAnalysisTimeout(error) ? t("error.analysisTimeout") : t("playlist.loadError"));
        }
      } finally {
        if (generation === generationRef.current) setLoadingPlaylist(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      stopRef.current = true;
      cancelledAnalysisSessionsRef.current.add(analysisId);
      void api.cancelPlaylistAnalysis(analysisId).catch(() => undefined);
    };
  }, [sourceIsPlaylist, url]);

  function nextPlaylistAnalysisId() {
    return `playlist-${Date.now()}-${++analysisSequenceRef.current}`;
  }

  const analyzedMedia = useMemo(
    () => rows.map((row) => row.media).filter((media): media is MediaInfo => Boolean(media)),
    [rows],
  );
  const formatOptions = useMemo(() => aggregatePlaylistFormats(analyzedMedia), [analyzedMedia]);
  const resolvedRows = useMemo(() => new Map(rows.map((row) => [
    row.entry.id,
    row.media && row.analysisState === "ready"
      ? resolvePlaylistItem(row.media, params, row.entry.url, makeCookieSource(authSettings))
      : null,
  ])), [rows, params, authSettings]);
  const selectedCount = rows.filter((row) => row.selected).length;
  const downloadableSelectedCount = rows.filter((row) => {
    if (!row.selected) return false;
    const resolved = resolvedRows.get(row.entry.id);
    return Boolean(resolved?.available && resolved.request);
  }).length;
  const analyzedCount = rows.filter((row) => row.analysisState !== "pending" && row.analysisState !== "analyzing").length;
  const selectedAnalysisComplete = selectedCount > 0 && rows
    .filter((row) => row.selected)
    .every((row) => row.analysisState !== "pending" && row.analysisState !== "analyzing");
  const readyForBatch = selectedAnalysisComplete && downloadableSelectedCount > 0;
  const exactSelectedCount = rows.filter((row) => {
    if (!row.selected) return false;
    const resolved = resolvedRows.get(row.entry.id);
    return Boolean(resolved?.available && resolved.warnings.length === 0);
  }).length;
  const adaptedSelectedCount = rows.filter((row) => {
    if (!row.selected) return false;
    const resolved = resolvedRows.get(row.entry.id);
    return Boolean(resolved?.available && resolved.warnings.length > 0);
  }).length;
  const unavailableSelectedCount = Math.max(0, selectedCount - exactSelectedCount - adaptedSelectedCount);
  const showMatchSummary = adaptedSelectedCount > 0 || unavailableSelectedCount > 0;
  const matchSummary = selectedAnalysisComplete && params.mode === "video" && showMatchSummary
    ? params.formatSelectionMode === "adaptive"
      ? t("playlist.matchSummaryAdaptive", { exact: exactSelectedCount, adapted: adaptedSelectedCount, unavailable: unavailableSelectedCount })
      : t("playlist.matchSummaryStrict", { available: exactSelectedCount, unavailable: unavailableSelectedCount })
    : null;
  const sizeSummary = summarizePlaylistSize(rows.map((row) => ({
    selected: row.selected,
    analyzing: row.analysisState === "pending" || row.analysisState === "analyzing",
    resolved: resolvedRows.get(row.entry.id),
  })));
  const selectedSizeText = formatHeaderSize(sizeSummary, locale, t);
  const diskSpaceText = diskSpacePending
    ? t("playlist.spaceCalculating")
    : diskSpace == null
      ? t("playlist.spaceUnknown")
      : t("playlist.spaceKnown", {
        available: formatStorageSize(diskSpace.available, locale),
        total: formatStorageSize(diskSpace.total, locale),
      });
  const activeColumnWidths = columnWidths[layout];

  function resizeColumns(widths: PlaylistColumnWidths) {
    setColumnWidths((current) => ({ ...current, [layout]: widths }));
  }

  function fitColumns(widths: PlaylistColumnWidths) {
    if (fittedColumnLayoutsRef.current.has(layout)) return;
    fittedColumnLayoutsRef.current.add(layout);
    setColumnWidths((current) => ({ ...current, [layout]: widths }));
  }

  function updateRows(update: (current: PlaylistRow[]) => PlaylistRow[]) {
    const next = update(rowsRef.current);
    rowsRef.current = next;
    setRows(next);
  }

  function beginAnalysis(ids: string[], generation: number) {
    if (!ids.length || generation !== generationRef.current) return;
    stopRef.current = false;
    pendingIdsRef.current = [...new Set([...pendingIdsRef.current, ...ids])];
    setAnalysisStopped(false);
    setRateLimited(false);
    setAnalysisRunning(true);
    launchAnalysisWorkers(generation);
  }

  function launchAnalysisWorkers(generation: number) {
    if (
      analysisWorkersActiveRef.current
      || stopRef.current
      || generation !== generationRef.current
      || pendingIdsRef.current.length === 0
    ) return;
    analysisWorkersActiveRef.current = true;
    const analysisId = analysisSessionRef.current;
    void (async () => {
      try {
        await api.beginPlaylistAnalysis(analysisId);
        if (
          generation !== generationRef.current
          || analysisId !== analysisSessionRef.current
          || stopRef.current
        ) return;
        await Promise.all([
          analysisWorker(generation, analysisId),
          analysisWorker(generation, analysisId),
        ]);
      } finally {
        analysisWorkersActiveRef.current = false;
        if (
          !stopRef.current
          && pendingIdsRef.current.length > 0
        ) {
          launchAnalysisWorkers(generationRef.current);
          return;
        }
        if (generation !== generationRef.current || analysisId !== analysisSessionRef.current) return;
        setAnalysisRunning(false);
        if (stopRef.current && pendingIdsRef.current.length > 0) setAnalysisStopped(true);
      }
    })();
  }

  async function analysisWorker(generation: number, analysisId: string) {
    while (
      generation === generationRef.current
      && analysisId === analysisSessionRef.current
      && !stopRef.current
    ) {
      const entryId = pendingIdsRef.current.shift();
      if (!entryId) return;
      const row = rowsRef.current.find((candidate) => candidate.entry.id === entryId);
      if (!row || (row.analysisState !== "pending" && row.analysisState !== "temporaryError")) continue;
      updateRows((current) => current.map((candidate) => candidate.entry.id === entryId
        ? { ...candidate, analysisState: "analyzing", issue: null, rejection: null }
        : candidate));

      const requestId = `item-${++analysisRequestSequenceRef.current}`;
      let result = await api.probePlaylistItem(
        entryId,
        row.entry.url,
        makeCookieSource(authSettingsRef.current),
        analysisId,
        requestId,
      );
      if (
        generation !== generationRef.current
        || analysisId !== analysisSessionRef.current
        || cancelledAnalysisSessionsRef.current.has(analysisId)
      ) return;
      if (
        generation === generationRef.current
        && !stopRef.current
        && !isAnalysisTimeout(result.issue?.message)
        && (result.issue?.code === "network" || result.issue?.code === "forbidden")
      ) {
        await delay(900);
        if (generation === generationRef.current && !stopRef.current) {
          result = await api.probePlaylistItem(
            entryId,
            row.entry.url,
            makeCookieSource(authSettingsRef.current),
            analysisId,
            requestId,
          );
        }
      }
      if (
        generation !== generationRef.current
        || analysisId !== analysisSessionRef.current
        || cancelledAnalysisSessionsRef.current.has(analysisId)
      ) return;
      applyAnalysisResult(result);
      if (result.issue?.code === "rateLimited") {
        stopRef.current = true;
        setRateLimited(true);
        setAnalysisStopped(true);
      }
    }
  }

  function applyAnalysisResult(result: PlaylistItemAnalysis) {
    const analysisState = analysisStateFromResult(result);
    updateRows((current) => current.map((row) => row.entry.id === result.entryId
      ? {
          ...row,
          entry: result.media
            ? {
                ...row.entry,
                title: result.media.title || row.entry.title,
                thumbnail: result.media.thumbnail ?? row.entry.thumbnail,
                duration: result.media.duration ?? row.entry.duration,
              }
            : row.entry,
          analysisState,
          media: result.media ?? null,
          issue: result.issue ?? null,
          selected: analysisState === "unavailable" ? false : row.selected,
        }
      : row));
  }

  function stopAnalysis() {
    stopRef.current = true;
    setAnalysisStopped(true);
    setAnalysisRunning(false);
    cancelledAnalysisSessionsRef.current.add(analysisSessionRef.current);
    updateRows((current) => current.map((row) => row.analysisState === "analyzing"
      ? { ...row, analysisState: "pending" }
      : row));
    if (analysisSessionRef.current) {
      void api.cancelPlaylistAnalysis(analysisSessionRef.current).catch(() => undefined);
    }
  }

  function resumeAnalysis() {
    const ids = rowsRef.current
      .filter((row) => row.analysisState === "pending" || row.analysisState === "temporaryError")
      .map((row) => row.entry.id);
    pendingIdsRef.current = [];
    analysisSessionRef.current = nextPlaylistAnalysisId();
    beginAnalysis(ids, generationRef.current);
  }

  function continueLargePlaylist() {
    setLargePlaylistWarning(false);
    resumeAnalysis();
  }

  function toggleRow(entryId: string) {
    updateRows((current) => current.map((row) => row.entry.id === entryId && row.analysisState !== "unavailable"
      ? { ...row, selected: !row.selected, rejection: null }
      : row));
  }

  function toggleAll() {
    const selectable = rows.filter((row) => row.analysisState !== "unavailable");
    const allSelected = selectable.length > 0 && selectable.every((row) => row.selected);
    updateRows((current) => current.map((row) => row.analysisState === "unavailable"
      ? row
      : { ...row, selected: !allSelected, rejection: null }));
  }

  function setSelectedRows(selectedIds: Set<string>) {
    updateRows((current) => current.map((row) => row.analysisState === "unavailable"
      ? row
      : { ...row, selected: selectedIds.has(row.entry.id), rejection: null }));
  }

  function setMode(mode: PlaylistDownloadMode) {
    setParams((current) => ({ ...current, mode }));
    setEnqueueResult(null);
  }

  async function chooseDestination() {
    const selected = await api.selectDownloadDir(params.destinationDir).catch(() => null);
    if (selected) setParams((current) => ({ ...current, destinationDir: selected }));
  }

  async function pasteUrl() {
    const text = await readText().catch(() => "");
    if (text.trim()) onUrlChange(text.trim());
  }

  async function prepareBatch() {
    if (!readyForBatch || enqueueing) return;
    const selectedRows = rows.filter((row) => row.selected);
    const candidates: BatchDownloadItem[] = [];
    let warnings = 0;
    for (const row of selectedRows) {
      const resolved = resolvedRows.get(row.entry.id);
      if (!resolved?.available || !resolved.request) continue;
      warnings += resolved.warnings.length;
      candidates.push({ clientId: row.entry.id, request: resolved.request });
    }
    const draft: BatchDraft = {
      items: candidates,
      baselineSkipped: selectedRows.length - candidates.length,
      warningCount: warnings,
    };
    if (!candidates.length) {
      setEnqueueResult({ added: 0, skipped: selectedRows.length });
      return;
    }
    setEnqueueing(true);
    try {
      const duplicates = await api.checkHistoryDuplicates(candidates.map((item) => ({
        clientId: item.clientId,
        request: item.request,
      })));
      if (duplicates.length) {
        setDuplicateDraft({ draft, duplicates });
        return;
      }
      if (warnings > 0) {
        setWarningDraft(draft);
        return;
      }
      await executeBatch(draft);
    } finally {
      setEnqueueing(false);
    }
  }

  function continueAfterDuplicate(downloadAgain: boolean) {
    const pending = duplicateDraft;
    if (!pending) return;
    const duplicateIds = new Set(pending.duplicates.map((item) => item.clientId));
    const draft = downloadAgain
      ? pending.draft
      : {
          ...pending.draft,
          items: pending.draft.items.filter((item) => !duplicateIds.has(item.clientId)),
          baselineSkipped: pending.draft.baselineSkipped + duplicateIds.size,
        };
    setDuplicateDraft(null);
    if (draft.warningCount > 0 && draft.items.length > 0) {
      setWarningDraft(draft);
    } else {
      void executeBatch(draft);
    }
  }

  async function executeBatch(draft: BatchDraft) {
    setWarningDraft(null);
    if (!draft.items.length) {
      setEnqueueResult({ added: 0, skipped: draft.baselineSkipped });
      return;
    }
    setEnqueueing(true);
    try {
      const result = await api.enqueueDownloadBatch(draft.items);
      const jobByClient = new Map(result.queued.map((item) => [item.clientId, item.job]));
      const rejectionByClient = new Map(result.rejected.map((item) => [item.clientId, item.code]));
      updateRows((current) => current.map((row) => {
        const job = jobByClient.get(row.entry.id);
        const rejection = rejectionByClient.get(row.entry.id);
        return job
          ? { ...row, jobId: job.id, rejection: null }
          : rejection
            ? { ...row, rejection }
            : row;
      }));
      onJobsCreated(result.queued.map((item) => item.job));
      setEnqueueResult({
        added: result.queued.length,
        skipped: draft.baselineSkipped + result.rejected.length,
      });
    } catch {
      setEnqueueResult({ added: 0, skipped: draft.baselineSkipped + draft.items.length });
    } finally {
      setEnqueueing(false);
    }
  }

  const parameterPanel = (
    <PlaylistParametersPanel
      params={params}
      setParams={setParams}
      media={analyzedMedia}
      options={formatOptions}
      selectedCount={downloadableSelectedCount}
      dense={layout === "stacked"}
      sizeSummary={sizeSummary}
      readyForBatch={readyForBatch}
      selectedAnalysisPending={selectedCount > 0 && !selectedAnalysisComplete}
      enqueueing={enqueueing}
      enqueueResult={enqueueResult}
      onModeChange={setMode}
      onDestination={chooseDestination}
      onEnqueue={() => void prepareBatch()}
      onOpenQueue={onOpenQueue}
    />
  );

  return (
    <section className="playlist-view section-view" aria-label={t("playlist.label")}>
      <div className="playlist-url-card">
        <UrlInput
          id="playlist-url"
          label={t("playlist.url")}
          value={url}
          placeholder={t("playlist.urlPlaceholder")}
          pasteLabel={t("media.paste")}
          pasteTooltip={t("media.pasteTooltip")}
          clearLabel={t("media.clear")}
          onChange={onUrlChange}
          onPaste={() => void pasteUrl()}
          onClear={() => onUrlChange("")}
        />
      </div>

      {!sourceIsPlaylist ? (
        <div className="section-empty playlist-empty">
          <PlaylistDownloadIcon />
          <strong>{t("playlist.emptyTitle")}</strong>
          <span>{t("playlist.emptyText")}</span>
        </div>
      ) : loadingPlaylist ? (
        <div className="section-empty playlist-empty" role="status">
          <span className="analysis-spinner" />
          <strong>{t("playlist.loading")}</strong>
        </div>
      ) : playlistError ? (
        <div className="section-empty playlist-empty error-state">
          <strong>{t("playlist.loadErrorTitle")}</strong>
          <span>{playlistError}</span>
        </div>
      ) : playlist ? (
        <>
          {rateLimited ? (
            <div className="inline-notice warning-notice" role="status">
              <div><strong>{t("playlist.rateLimitedTitle")}</strong><span>{t("playlist.rateLimitedText")}</span></div>
              <button type="button" className="secondary" disabled={analysisRunning} onClick={resumeAnalysis}>{t("playlist.continueLater")}</button>
            </div>
          ) : null}
          {layout === "wide" ? (
            <div className="playlist-wide-layout">
              <div className="playlist-list-card">
                <PlaylistHeader playlist={playlist} rows={rows} selected={selectedCount} selectedSize={selectedSizeText} diskSpace={diskSpaceText} matchSummary={matchSummary} layout={layout} showThumbnails={showThumbnails} onLayout={() => setLayout("stacked")} />
                <PlaylistAnalysisBar
                  analyzed={analyzedCount}
                  total={rows.length}
                  running={analysisRunning}
                  stopped={analysisStopped}
                  onStop={stopAnalysis}
                  onResume={resumeAnalysis}
                />
                <PlaylistTable
                  rows={rows}
                  resolved={resolvedRows}
                  jobs={jobs}
                  finishedMediaSignatures={finishedMediaSignatures}
                  columnWidths={activeColumnWidths}
                  resizable
                  autoFit={!fittedColumnLayoutsRef.current.has(layout)}
                  locale={locale}
                  showThumbnails={showThumbnails}
                  onInitialFit={fitColumns}
                  onResize={resizeColumns}
                  onToggle={toggleRow}
                  onSelectionChange={setSelectedRows}
                  onToggleAll={toggleAll}
                />
              </div>
              <div className="playlist-parameters-card">{parameterPanel}</div>
            </div>
          ) : (
            <div className="playlist-stacked-layout">
              <div className="playlist-list-card">
                <PlaylistHeader playlist={playlist} rows={rows} selected={selectedCount} selectedSize={selectedSizeText} diskSpace={diskSpaceText} matchSummary={matchSummary} layout={layout} showThumbnails={showThumbnails} onLayout={() => setLayout("wide")} />
                <PlaylistAnalysisBar
                  analyzed={analyzedCount}
                  total={rows.length}
                  running={analysisRunning}
                  stopped={analysisStopped}
                  onStop={stopAnalysis}
                  onResume={resumeAnalysis}
                />
                <PlaylistTable
                  rows={rows}
                  resolved={resolvedRows}
                  jobs={jobs}
                  finishedMediaSignatures={finishedMediaSignatures}
                  columnWidths={activeColumnWidths}
                  resizable
                  compact
                  autoFit={!fittedColumnLayoutsRef.current.has(layout)}
                  locale={locale}
                  showThumbnails={showThumbnails}
                  onInitialFit={fitColumns}
                  onResize={resizeColumns}
                  onToggle={toggleRow}
                  onSelectionChange={setSelectedRows}
                  onToggleAll={toggleAll}
                />
              </div>
              <div className="playlist-parameters-card">{parameterPanel}</div>
            </div>
          )}
        </>
      ) : null}

      {largePlaylistWarning ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="compact-dialog" role="dialog" aria-modal="true" aria-labelledby="large-playlist-title">
            <h3 id="large-playlist-title">{t("playlist.largeTitle")}</h3>
            <p>{t("playlist.largeText", { count: rows.length })}</p>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setLargePlaylistWarning(false)}>{t("playlist.keepStopped")}</button>
              <button type="button" className="primary" onClick={continueLargePlaylist}>{t("playlist.startAnalysis")}</button>
            </div>
          </section>
        </div>
      ) : null}

      {duplicateDraft ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="compact-dialog playlist-duplicates-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-duplicates-title">
            <h3 id="playlist-duplicates-title">{t("playlist.historyDuplicatesTitle")}</h3>
            <p>{t("playlist.historyDuplicatesText", { count: duplicateDraft.duplicates.length })}</p>
            <div className="dialog-actions three-actions">
              <button type="button" className="secondary" onClick={() => setDuplicateDraft(null)}>{t("common.cancel")}</button>
              <button type="button" className="secondary" onClick={() => continueAfterDuplicate(true)}>{t("playlist.downloadAgain")}</button>
              <button type="button" className="primary" onClick={() => continueAfterDuplicate(false)}>{t("playlist.skipDuplicates")}</button>
            </div>
          </section>
        </div>
      ) : null}

      {warningDraft ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="compact-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-fallback-title">
            <h3 id="playlist-fallback-title">{t("playlist.fallbackTitle")}</h3>
            <p>{t("playlist.fallbackText", { count: warningDraft.warningCount })}</p>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setWarningDraft(null)}>{t("common.cancel")}</button>
              <button type="button" className="primary" onClick={() => void executeBatch(warningDraft)}>{t("playlist.confirmBatch")}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function PlaylistHeader({ playlist, rows, selected, selectedSize, diskSpace, matchSummary, layout, showThumbnails, onLayout }: { playlist: PlaylistInfo; rows: PlaylistRow[]; selected: number; selectedSize: string; diskSpace: string; matchSummary: string | null; layout: Layout; showThumbnails: boolean; onLayout: () => void }) {
  const { t } = useI18n();
  const fallbackThumbnail = rows.find((row) => row.media?.thumbnail || row.entry.thumbnail);
  return (
    <div className="playlist-header-card">
      {showThumbnails ? <MediaThumbnail
        src={playlist.thumbnail ?? fallbackThumbnail?.media?.thumbnail ?? fallbackThumbnail?.entry.thumbnail}
        mediaUrl={fallbackThumbnail?.entry.url}
        alt={playlist.title}
        className="playlist-cover"
        placeholderClassName="playlist-cover-placeholder"
      /> : null}
      <div className="playlist-header-copy">
        <strong title={playlist.title}>{playlist.title}</strong>
        {playlist.uploader ? <span>{playlist.uploader}</span> : null}
        <span>{t("playlist.itemCount", { count: playlist.entries.length })}{playlist.totalDuration ? ` · ${formatDuration(playlist.totalDuration)}` : ""}</span>
        <span>{t("playlist.selectedSummary", { selected, total: playlist.entries.length, size: selectedSize, space: diskSpace })}</span>
        {matchSummary ? <span className="playlist-match-summary">{matchSummary}</span> : null}
      </div>
      <button type="button" className="layout-switch" title={layout === "wide" ? t("playlist.layoutStacked") : t("playlist.layoutWide")} aria-label={layout === "wide" ? t("playlist.layoutStacked") : t("playlist.layoutWide")} onClick={onLayout}>
        {layout === "wide" ? <StackedLayoutIcon /> : <WideLayoutIcon />}
      </button>
    </div>
  );
}

function PlaylistAnalysisBar({ analyzed, total, running, stopped, onStop, onResume }: { analyzed: number; total: number; running: boolean; stopped: boolean; onStop: () => void; onResume: () => void }) {
  const { t } = useI18n();
  const percent = total > 0 ? Math.round(analyzed / total * 100) : 0;
  return (
    <div className="playlist-analysis-bar">
      <div className="playlist-analysis-copy">
        <span>{t("playlist.analysisProgress", { analyzed, total })}</span>
        <strong>{percent}%</strong>
      </div>
      <div className="playlist-analysis-track"><span style={{ width: `${percent}%` }} /></div>
      {running ? <button type="button" className="text-button" onClick={onStop}>{t("playlist.stopAnalysis")}</button>
        : stopped && analyzed < total ? <button type="button" className="text-button" onClick={onResume}>{t("playlist.resumeAnalysis")}</button> : null}
    </div>
  );
}

function PlaylistTable({
  rows,
  resolved,
  jobs,
  finishedMediaSignatures,
  columnWidths,
  resizable,
  autoFit = false,
  compact = false,
  locale,
  showThumbnails,
  onInitialFit,
  onResize,
  onToggle,
  onSelectionChange,
  onToggleAll,
}: {
  rows: PlaylistRow[];
  resolved: Map<string, ResolvedPlaylistItem | null>;
  jobs: Job[];
  finishedMediaSignatures: Set<string>;
  columnWidths: PlaylistColumnWidths;
  resizable: boolean;
  autoFit?: boolean;
  compact?: boolean;
  locale: "ru" | "en";
  showThumbnails: boolean;
  onInitialFit?: (widths: PlaylistColumnWidths) => void;
  onResize: (widths: PlaylistColumnWidths) => void;
  onToggle: (id: string) => void;
  onSelectionChange: (selectedIds: Set<string>) => void;
  onToggleAll: () => void;
}) {
  const { t } = useI18n();
  const selectable = rows.filter((row) => row.analysisState !== "unavailable");
  const allSelected = selectable.length > 0 && selectable.every((row) => row.selected);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragActionRef = useRef<"check" | "uncheck">("check");
  const pivotIndexRef = useRef(-1);
  const traversedAwayRef = useRef(false);
  const originalSelectionRef = useRef<Map<string, boolean>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const scrollSpeedRef = useRef(0);
  const cursorPositionRef = useRef({ x: 0, y: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const minimumWidths: PlaylistColumnWidths = { title: 150, duration: 60, size: 70, status: 90 };
  const gridColumns = `42px ${columnWidths.title}px ${columnWidths.duration}px ${columnWidths.size}px ${columnWidths.status}px`;
  const tableWidth = 42 + Object.values(columnWidths).reduce((total, width) => total + width, 0);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  useLayoutEffect(() => {
    if (!autoFit || !onInitialFit) return;
    const availableWidth = containerRef.current?.clientWidth ?? 0;
    if (availableWidth <= 0) return;
    const fixedWidth = 42 + columnWidths.duration + columnWidths.size + columnWidths.status;
    onInitialFit({ ...columnWidths, title: Math.max(minimumWidths.title, availableWidth - fixedWidth) });
  }, [autoFit, columnWidths, onInitialFit]);

  function startResize(column: PlaylistColumn, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    let startX = event.clientX;
    let width = columnWidths[column];
    const move = (moveEvent: MouseEvent) => {
      width = Math.max(minimumWidths[column], width + moveEvent.clientX - startX);
      startX = moveEvent.clientX;
      onResize({ ...columnWidths, [column]: width });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function applyDragRange(currentIndex: number) {
    if (currentIndex < 0 || currentIndex >= rows.length || pivotIndexRef.current < 0) return;
    if (currentIndex !== pivotIndexRef.current) traversedAwayRef.current = true;
    const first = Math.min(pivotIndexRef.current, currentIndex);
    const last = Math.max(pivotIndexRef.current, currentIndex);
    const selectedIds = new Set<string>();
    for (const row of rows) {
      if (originalSelectionRef.current.get(row.entry.id)) selectedIds.add(row.entry.id);
    }
    if (currentIndex === pivotIndexRef.current && traversedAwayRef.current) {
      onSelectionChange(selectedIds);
      return;
    }
    for (let index = first; index <= last; index += 1) {
      const row = rows[index];
      if (row.analysisState === "unavailable") continue;
      if (dragActionRef.current === "check") selectedIds.add(row.entry.id);
      else selectedIds.delete(row.entry.id);
    }
    onSelectionChange(selectedIds);
  }

  function rowIndexAt(x: number, y: number) {
    if (typeof document.elementFromPoint !== "function") return -1;
    const element = document.elementFromPoint(x, y);
    const row = element?.closest<HTMLElement>("[data-drag-row]");
    return row ? Number(row.dataset.dragRow ?? -1) : -1;
  }

  function stopAutoScroll() {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    scrollSpeedRef.current = 0;
  }

  function startAutoScroll() {
    if (animationFrameRef.current !== null) return;
    const tick = () => {
      const container = containerRef.current;
      if (!container || !isDraggingRef.current) {
        animationFrameRef.current = null;
        return;
      }
      if (scrollSpeedRef.current !== 0) {
        container.scrollTop += scrollSpeedRef.current;
        const index = rowIndexAt(cursorPositionRef.current.x, cursorPositionRef.current.y);
        applyDragRange(index >= 0 ? index : scrollSpeedRef.current > 0 ? rows.length - 1 : 0);
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    animationFrameRef.current = window.requestAnimationFrame(tick);
  }

  function startDrag(index: number, event: React.MouseEvent) {
    if (event.button !== 0 || rows[index].analysisState === "unavailable") return;
    if ((event.target as HTMLElement).closest("[data-resize]")) return;
    event.preventDefault();
    isDraggingRef.current = true;
    dragActionRef.current = rows[index].selected ? "uncheck" : "check";
    pivotIndexRef.current = index;
    traversedAwayRef.current = false;
    originalSelectionRef.current = new Map(rows.map((row) => [row.entry.id, row.selected]));
    document.body.classList.add("playlist-drag-selecting");
    applyDragRange(index);

    const move = (moveEvent: MouseEvent) => {
      cursorPositionRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
      const container = containerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const zone = 60;
      const maximumSpeed = 10;
      if (moveEvent.clientY < bounds.top + zone) {
        const proximity = 1 - (moveEvent.clientY - bounds.top) / zone;
        scrollSpeedRef.current = -Math.max(1, Math.round(proximity * maximumSpeed));
        startAutoScroll();
      } else if (moveEvent.clientY > bounds.bottom - zone) {
        const proximity = 1 - (bounds.bottom - moveEvent.clientY) / zone;
        scrollSpeedRef.current = Math.max(1, Math.round(proximity * maximumSpeed));
        startAutoScroll();
      } else {
        scrollSpeedRef.current = 0;
      }
    };
    const up = () => {
      isDraggingRef.current = false;
      stopAutoScroll();
      document.body.classList.remove("playlist-drag-selecting");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = up;
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  return (
    <div ref={containerRef} className={`playlist-table-wrap${compact ? " compact" : ""}${resizable ? " resizable" : ""}`}>
      <div className="playlist-table" style={resizable ? { width: tableWidth, minWidth: tableWidth } : undefined}>
        <div className="playlist-table-head" style={resizable ? { gridTemplateColumns: gridColumns } : undefined}>
          <button type="button" className="playlist-checkbox-button" onClick={onToggleAll} aria-label={allSelected ? t("playlist.selectNone") : t("playlist.selectAll")}><Checkbox checked={allSelected} /></button>
          <span className="playlist-title-column">{t("playlist.columnTitle")}{resizable ? <span className="column-resizer" data-resize="true" onMouseDown={(event) => startResize("title", event)} /> : null}</span>
          <span>{t("playlist.columnDuration")}{resizable ? <span className="column-resizer" data-resize="true" onMouseDown={(event) => startResize("duration", event)} /> : null}</span>
          <span>{t("playlist.columnSize")}{resizable ? <span className="column-resizer" data-resize="true" onMouseDown={(event) => startResize("size", event)} /> : null}</span>
          <span>{t("playlist.columnStatus")}{resizable ? <span className="column-resizer" data-resize="true" onMouseDown={(event) => startResize("status", event)} /> : null}</span>
        </div>
        <div className="playlist-table-body">
          {rows.map((row, index) => {
            const result = resolved.get(row.entry.id);
            const currentSignature = result?.request ? mediaSignatureForRequest(result.request) : null;
            const job = currentSignature
              ? jobs.find((item) => mediaSignatureForRequest(item.request) === currentSignature)
                ?? (row.jobId ? jobs.find((item) => item.id === row.jobId && !item.mediaSignature) : null)
              : null;
            const status = visibleRowStatus(row, result, job, currentSignature, finishedMediaSignatures);
            const disabled = row.analysisState === "unavailable";
            const detail = rowDetail(row, result, job, t);
            return (
              <div
                key={row.entry.id}
                className="playlist-table-row"
                role="checkbox"
                tabIndex={disabled ? -1 : 0}
                aria-checked={row.selected}
                aria-disabled={disabled || undefined}
                aria-label={row.selected ? t("playlist.unselectItem", { title: row.entry.title }) : t("playlist.selectItem", { title: row.entry.title })}
                data-drag-row={index}
                data-selected={row.selected || undefined}
                data-disabled={disabled || undefined}
                style={resizable ? { gridTemplateColumns: gridColumns } : undefined}
                onMouseDown={(event) => startDrag(index, event)}
                onMouseEnter={() => {
                  if (isDraggingRef.current) applyDragRange(index);
                }}
                onKeyDown={(event) => {
                  if (!disabled && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onToggle(row.entry.id);
                  }
                }}
              >
                <span className="playlist-checkbox-cell"><Checkbox checked={row.selected} disabled={disabled} /></span>
                <div className="playlist-row-title">
                  {showThumbnails ? <MediaThumbnail
                    src={row.entry.thumbnail ?? row.media?.thumbnail}
                    mediaUrl={row.media?.webpageUrl ?? row.entry.url}
                    alt={row.entry.title}
                    className="playlist-row-thumbnail"
                    placeholderClassName="playlist-row-thumb-placeholder"
                  /> : null}
                  <span><strong title={row.entry.title}>{row.entry.title}</strong><small>{row.entry.index}</small></span>
                </div>
                <span className="playlist-cell-muted">{row.entry.duration ? formatDuration(row.entry.duration) : "-"}</span>
                <span className="playlist-cell-muted">{formatEstimatedSize(result?.estimatedBytes, locale)}</span>
                <div className="playlist-status-cell" title={detail?.tooltip}><StatusBadge status={status} tooltip={detail?.tooltip} />{detail ? <small title={detail.tooltip}>{detail.text}</small> : null}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlaylistParametersPanel({
  params,
  setParams,
  media,
  options,
  selectedCount,
  dense,
  sizeSummary,
  readyForBatch,
  selectedAnalysisPending,
  enqueueing,
  enqueueResult,
  onModeChange,
  onDestination,
  onEnqueue,
  onOpenQueue,
}: {
  params: PlaylistParameters;
  setParams: React.Dispatch<React.SetStateAction<PlaylistParameters>>;
  media: MediaInfo[];
  options: ReturnType<typeof aggregatePlaylistFormats>;
  selectedCount: number;
  dense: boolean;
  sizeSummary: ReturnType<typeof summarizePlaylistSize>;
  readyForBatch: boolean;
  selectedAnalysisPending: boolean;
  enqueueing: boolean;
  enqueueResult: { added: number; skipped: number } | null;
  onModeChange: (mode: PlaylistDownloadMode) => void;
  onDestination: () => void;
  onEnqueue: () => void;
  onOpenQueue: () => void;
}) {
  const { locale, t } = useI18n();
  const [videoAdvancedOpen, setVideoAdvancedOpen] = useState(false);
  const profileOptions = createVideoProfileOptions(t);
  const languages = countSubtitleOptions(media, (subtitle) => subtitle.language);
  const subtitleFormats = countSubtitleOptions(media, (subtitle) => subtitle.formats).flatMap((item) => item.value.map((value) => ({ value, count: item.count })));
  const distinctSubtitleFormats = mergeCounts(subtitleFormats);
  const formattedSize = formatSizeSummary(sizeSummary, locale, t);
  const profileHeight = qualityProfileHeight(params.videoProfile);
  const displayedContainer = profileHeight == null ? params.container?.toUpperCase() ?? t("common.auto") : "MP4";
  const displayedResolution = profileHeight == null
    ? params.resolution === "best" ? t("video.best") : `${params.resolution}p`
    : `${profileHeight}p`;
  const summaryFacts = params.mode === "video"
    ? [
        [t("video.container"), displayedContainer],
        [t("video.resolution"), displayedResolution],
        [t("video.fps"), params.fps == null ? t("common.auto") : `${params.fps} fps`],
        [t("playlist.estimatedSize"), formattedSize],
      ]
    : params.mode === "audio"
      ? [
          [t("audio.codec"), params.audioPreset.replace("audio", "").toUpperCase()],
          [t("audio.bitrate"), params.audioBitrate.replace("K", " kbps")],
          [t("audio.channels"), params.audioChannels === "source" ? t("audio.sourceChannels") : params.audioChannels === "mono" ? "Mono" : "Stereo"],
          [t("playlist.estimatedSize"), formattedSize],
        ]
      : [
          [t("subtitles.format"), params.subtitleFormat.toUpperCase()],
          [t("subtitles.language"), params.subtitleLanguage ?? t("common.auto")],
          [t("subtitles.type"), params.allowAutomaticSubtitles ? t("playlist.subtitlesManualAndAutomatic") : t("playlist.subtitlesManualOnly")],
          [t("playlist.estimatedSize"), formattedSize],
        ];

  return (
    <div className={`playlist-parameters${dense ? " dense" : ""}`}>
      <div className="playlist-parameter-controls">
        <DownloadModeTabs mode={params.mode} onChange={onModeChange} />
        <h3 className="download-parameters-heading">{t("playlist.parameters")}</h3>

        {params.mode === "video" ? (
        <div className="options-stack playlist-options-stack">
          <section className="video-profile-select" aria-label={t("video.profile")}>
            <div className="playlist-param playlist-profile-field"><ParameterSelect label={t("video.profile")} value={params.videoProfile} options={profileOptions} selectedOption={params.videoProfile === "custom" ? { value: "custom", label: t("video.custom"), description: t("video.customDescription") } : undefined} onChange={(value) => setParams((current) => ({
              ...current,
              videoProfile: value as VideoDownloadProfile,
              resolution: "best",
              fps: null,
              container: null,
              codec: null,
            }))} /></div>
          </section>
          <section className="advanced-settings video-advanced-settings playlist-advanced-settings" aria-label={t("video.advancedLabel")}>
            <button type="button" className="settings-title" aria-expanded={videoAdvancedOpen} aria-controls="playlist-video-advanced" onClick={() => setVideoAdvancedOpen((open) => !open)}>
              <AdjustmentsIcon />
              <h3>{t("video.advanced")}</h3>
              <ChevronIcon expanded={videoAdvancedOpen} />
            </button>
            {videoAdvancedOpen ? (
              <div id="playlist-video-advanced" className="settings-grid video-settings-grid playlist-video-settings-grid">
                <LabeledParameter label={t("video.resolution")}><ParameterSelect label={t("video.resolution")} value={String(params.resolution)} options={[
                  { value: "best", label: t("common.auto") },
                  ...options.resolutions.map((item) => countedOption(String(item.value), `${item.value}p`, item.count, media.length, t)),
                ]} onChange={(value) => setParams((current) => ({ ...current, videoProfile: "custom", resolution: value === "best" ? "best" : Number(value) }))} /></LabeledParameter>
                <LabeledParameter label={t("video.fps")}><ParameterSelect label={t("video.fps")} value={params.fps == null ? "auto" : String(params.fps)} options={[
                  { value: "auto", label: t("common.auto") },
                  ...options.fps.map((item) => countedOption(String(item.value), `${item.value} fps`, item.count, media.length, t)),
                ]} onChange={(value) => setParams((current) => ({ ...current, videoProfile: "custom", fps: value === "auto" ? null : Number(value) }))} /></LabeledParameter>
                <LabeledParameter label={t("video.container")}><ParameterSelect label={t("video.container")} value={params.container ?? "auto"} options={[
                  { value: "auto", label: t("common.auto") },
                  ...options.containers.map((item) => countedOption(item.value, item.value.toUpperCase(), item.count, media.length, t)),
                ]} onChange={(value) => setParams((current) => ({ ...current, videoProfile: "custom", container: value === "auto" ? null : value }))} /></LabeledParameter>
                <LabeledParameter label={t("video.codec")}><ParameterSelect label={t("video.codec")} value={params.codec ?? "auto"} options={[
                  { value: "auto", label: t("common.auto") },
                  ...options.codecs.map((item) => countedOption(item.value, item.value, item.count, media.length, t)),
                ]} onChange={(value) => setParams((current) => ({ ...current, videoProfile: "custom", codec: value === "auto" ? null : value }))} /></LabeledParameter>
              </div>
            ) : null}
          </section>
        </div>
        ) : params.mode === "audio" ? (
        <section className="advanced-settings audio-advanced-settings playlist-audio-settings" aria-label={t("audio.settings")}>
          <div className="settings-title audio-title"><AudioWaveIcon /><h3>{t("audio.settings")}</h3></div>
          <div className="settings-grid audio-settings-grid playlist-audio-settings-grid">
            <LabeledParameter label={t("audio.bitrate")}><ParameterSelect label={t("audio.bitrate")} value={params.audioBitrate} options={["320K", "256K", "192K", "128K"].map((value) => ({ value, label: value.replace("K", " kbps") }))} onChange={(audioBitrate) => setParams((current) => ({ ...current, audioBitrate }))} /></LabeledParameter>
            <LabeledParameter label={t("audio.codec")}><ParameterSelect label={t("audio.codec")} value={params.audioPreset} options={[
              { value: "audioMp3", label: "MP3" }, { value: "audioM4a", label: "M4A" }, { value: "audioOpus", label: "OPUS" },
            ]} onChange={(value) => setParams((current) => ({ ...current, audioPreset: value as PlaylistParameters["audioPreset"] }))} /></LabeledParameter>
            <LabeledParameter label={t("audio.channels")}><ParameterSelect label={t("audio.channels")} value={params.audioChannels} options={[
              { value: "stereo", label: "Stereo" }, { value: "mono", label: "Mono" }, { value: "source", label: t("audio.sourceChannels") },
            ]} onChange={(value) => setParams((current) => ({ ...current, audioChannels: value as PlaylistParameters["audioChannels"] }))} /></LabeledParameter>
          </div>
          <div className="toggle-list playlist-toggle-list">
            <label className="switch-row"><span>{t("audio.metadata")}</span><input aria-label={t("audio.metadata")} type="checkbox" checked={params.embedMetadata} onChange={(event) => setParams((current) => ({ ...current, embedMetadata: event.target.checked }))} /></label>
            <label className="switch-row"><span>{t("audio.thumbnail")}</span><input aria-label={t("audio.thumbnail")} type="checkbox" checked={params.embedThumbnail} onChange={(event) => setParams((current) => ({ ...current, embedThumbnail: event.target.checked }))} /></label>
          </div>
        </section>
        ) : (
        <section className="advanced-settings subtitle-advanced-settings playlist-subtitle-settings" aria-label={t("subtitles.settings")}>
          <div className="settings-title subtitle-title"><ModeIcon mode="subtitles" /><h3>{t("subtitles.settings")}</h3></div>
          <div className="settings-grid subtitle-settings-grid playlist-subtitle-settings-grid">
            <LabeledParameter label={t("subtitles.language")}><ParameterSelect label={t("subtitles.language")} value={params.subtitleLanguage ?? "auto"} options={[
              { value: "auto", label: t("common.auto") },
              ...languages.map((item) => countedOption(item.value, item.value, item.count, media.length, t)),
            ]} onChange={(value) => setParams((current) => ({ ...current, subtitleLanguage: value === "auto" ? null : value }))} /></LabeledParameter>
            <LabeledParameter label={t("subtitles.format")}><ParameterSelect label={t("subtitles.format")} value={params.subtitleFormat} options={(distinctSubtitleFormats.length ? distinctSubtitleFormats : [{ value: "srt", count: 0 }]).map((item) => countedOption(item.value, item.value.toUpperCase(), item.count, media.length, t))} onChange={(subtitleFormat) => setParams((current) => ({ ...current, subtitleFormat }))} /></LabeledParameter>
          </div>
          <div className="toggle-list playlist-toggle-list">
            <label className="switch-row"><span>{t("playlist.allowAutomaticSubtitles")}</span><input aria-label={t("playlist.allowAutomaticSubtitles")} type="checkbox" checked={params.allowAutomaticSubtitles} onChange={(event) => setParams((current) => ({ ...current, allowAutomaticSubtitles: event.target.checked }))} /></label>
          </div>
        </section>
        )}
      </div>

      <section className="playlist-summary-card" aria-label={t("common.finalFile")}>
        <header><h3>{t("common.finalFile")}</h3></header>
        <dl className="playlist-summary-facts">
          {summaryFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {sizeSummary.calculatingCount > 0 ? <small className="playlist-size-progress">{t("playlist.sizeCalculating", { count: sizeSummary.calculatingCount })}</small> : null}
        <div className="playlist-destination">
          <label htmlFor="playlist-destination">{t("downloader.destination")}</label>
          <div><input id="playlist-destination" value={params.destinationDir} onChange={(event) => setParams((current) => ({ ...current, destinationDir: event.target.value }))} /><button type="button" className="secondary" onClick={onDestination}>{t("downloader.browse")}</button></div>
        </div>
        <DownloadActionButton
          ariaLabel={enqueueing ? t("playlist.enqueueing") : t("playlist.enqueueSelected", { count: selectedCount })}
          busy={enqueueing}
          analyzed
          className="playlist-enqueue-button"
          disabled={!readyForBatch || enqueueing || !params.destinationDir.trim()}
          label={enqueueing ? t("playlist.enqueueing") : t("playlist.enqueueSelected", { count: selectedCount })}
          onClick={onEnqueue}
          type="button"
        />
        {selectedAnalysisPending ? <small className="playlist-readiness-note">{t("playlist.waitSelectedAnalysis")}</small> : null}
        {enqueueResult ? (
          <div className={`playlist-batch-feedback${enqueueResult.skipped > 0 ? " has-skips" : " all-added"}`} role={enqueueResult.skipped > 0 ? "alert" : "status"}>
            <div><strong>{enqueueResult.skipped > 0 ? t("playlist.batchPartialTitle") : t("playlist.batchResultTitle")}</strong><span>{t("playlist.batchResult", enqueueResult)}</span></div>
            <button type="button" className="secondary" onClick={onOpenQueue}>{t("playlist.openQueue")}</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function LabeledParameter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="playlist-param"><span>{label}</span>{children}</label>;
}

function ModeIcon({ mode }: { mode: PlaylistDownloadMode }) {
  if (mode === "video") return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 10 6-3v10l-6-3" /></svg>;
  if (mode === "audio") return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15h4M13 15h4M7 11h2M11 11h6" /></svg>;
}

function AdjustmentsIcon() {
  return <svg className="outline-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h5M15 7h5" /><circle cx="12" cy="7" r="2.25" /><path d="M4 17h9M19 17h1" /><circle cx="16" cy="17" r="2.25" /></svg>;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return <svg className={expanded ? "chevron-icon expanded" : "chevron-icon"} aria-hidden="true" viewBox="0 0 20 20"><path d="m6.5 8 3.5 3.5L13.5 8" /></svg>;
}

function StatusBadge({ status, tooltip }: { status: RowVisibleStatus; tooltip?: string }) {
  const { t } = useI18n();
  const icon = statusIcon(status);
  return (
    <span className={`playlist-status status-${status}`}>
      <span aria-hidden="true">{icon}</span>
      {t(`playlist.status.${status}` as TranslationKey)}
      {status === "availableWithFallback" && tooltip ? (
        <span
          className="playlist-status-info"
          tabIndex={0}
          role="img"
          aria-label={tooltip}
          title={tooltip}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >i</span>
      ) : null}
    </span>
  );
}

type RowVisibleStatus = "pendingAnalysis" | "analyzing" | "available" | "availableWithFallback" | "requiresAuth" | "unavailable" | "temporaryError" | "analysisError" | "queued" | "downloading" | "paused" | "downloadFailed" | "cancelled" | "downloaded";

function visibleRowStatus(
  row: PlaylistRow,
  resolved: ResolvedPlaylistItem | null | undefined,
  job: Job | null | undefined,
  currentSignature: string | null,
  finishedMediaSignatures: Set<string>,
): RowVisibleStatus {
  if (job) {
    if (job.state === "Pending") return "queued";
    if (job.state === "Running") return "downloading";
    if (job.state === "Paused") return "paused";
    if (job.state === "Failed") return "downloadFailed";
    if (job.state === "Cancelled") return "cancelled";
    if (job.state === "Completed") return "downloaded";
  }
  if (currentSignature && finishedMediaSignatures.has(currentSignature)) return "downloaded";
  if (row.analysisState === "pending") return "pendingAnalysis";
  if (row.analysisState === "analyzing") return "analyzing";
  if (row.analysisState === "requiresAuth") return "requiresAuth";
  if (row.analysisState === "unavailable") return "unavailable";
  if (row.analysisState === "temporaryError") return "temporaryError";
  if (row.analysisState === "error") return "analysisError";
  if (resolved?.available && resolved.replacements?.length) return "availableWithFallback";
  return resolved?.available ? "available" : "unavailable";
}

function rowDetail(row: PlaylistRow, resolved: ResolvedPlaylistItem | null | undefined, job: Job | null | undefined, t: ReturnType<typeof useI18n>["t"]) {
  if (job?.error) return detailText(t("playlist.downloadErrorDetail"));
  if (!job && row.rejection) return detailText(duplicateRejectionLabel(row.rejection, t));
  if (row.issue) {
    if (isAnalysisTimeout(row.issue.message)) return detailText(t("error.analysisTimeout"));
    return detailText(t(`playlist.issue.${row.issue.code}` as TranslationKey));
  }
  if (resolved && !resolved.available && resolved.reason) return detailText(t(`playlist.reason.${resolved.reason}` as TranslationKey));
  if (resolved?.warnings.length) {
    const replacements = resolved.replacements?.map((replacement) =>
      `${replacement.requested} → ${replacement.actual}`
    ).join(" · ");
    if (!replacements) {
      return detailText([resolved.request?.formatLabel, `⚠ ${t("playlist.replacements", { count: resolved.warnings.length })}`]
        .filter(Boolean)
        .join(" · "));
    }
    return {
      text: resolved.request?.formatLabel ?? t("playlist.status.availableWithFallback"),
      tooltip: t("playlist.replacementDetails", { details: replacements }),
    };
  }
  if (resolved?.request?.formatLabel) return detailText(resolved.request.formatLabel);
  return null;
}

function detailText(text: string) {
  return { text, tooltip: text };
}

function duplicateRejectionLabel(code: string, t: ReturnType<typeof useI18n>["t"]) {
  if (code.includes("audio")) return t("error.duplicateAudio");
  if (code.includes("subtitles")) return t("error.duplicateSubtitles");
  return t("error.duplicateVideo");
}

function analysisStateFromResult(result: PlaylistItemAnalysis): AnalysisState {
  if (result.state === "ready") return "ready";
  if (result.state === "requiresAuth") return "requiresAuth";
  if (result.state === "unavailable") return "unavailable";
  if (result.state === "temporaryError") return "temporaryError";
  return "error";
}

function countedOption(value: string, label: string, count: number, total: number, t: ReturnType<typeof useI18n>["t"]): ParameterSelectOption {
  return { value, label, description: t("playlist.optionAvailability", { count, total }) };
}

function countSubtitleOptions<T>(media: MediaInfo[], read: (subtitle: NonNullable<MediaInfo["subtitles"]>[number]) => T) {
  const counts = new Map<string, { value: T; count: number }>();
  for (const item of media) {
    const seen = new Set<string>();
    for (const subtitle of item.subtitles ?? []) {
      const value = read(subtitle);
      const key = JSON.stringify(value);
      if (seen.has(key)) continue;
      seen.add(key);
      const current = counts.get(key);
      counts.set(key, { value, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()];
}

function mergeCounts(items: Array<{ value: string; count: number }>) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.value.toLowerCase(), Math.max(counts.get(item.value.toLowerCase()) ?? 0, item.count));
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatEstimatedSize(bytes: number | null | undefined, locale: "ru" | "en") {
  if (bytes == null) return "-";
  const gb = bytes >= 1024 ** 3;
  const value = bytes / (gb ? 1024 ** 3 : 1024 ** 2);
  return `≈ ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${gb ? (locale === "ru" ? "ГБ" : "GB") : (locale === "ru" ? "МБ" : "MB")}`;
}

function formatSizeSummary(summary: ReturnType<typeof summarizePlaylistSize>, locale: "ru" | "en", t: ReturnType<typeof useI18n>["t"]) {
  const known = formatEstimatedSize(summary.bytes, locale).replace("-", `≈ 0 ${locale === "ru" ? "МБ" : "MB"}`);
  return summary.unknownCount > 0 ? t("playlist.sizeWithUnknown", { size: known, count: summary.unknownCount }) : known;
}

function formatHeaderSize(summary: ReturnType<typeof summarizePlaylistSize>, locale: "ru" | "en", t: ReturnType<typeof useI18n>["t"]) {
  if (summary.calculatingCount === 0) return formatSizeSummary(summary, locale, t);
  if (summary.bytes === 0 && summary.unknownCount === 0) return t("playlist.sizePending");
  return t("playlist.sizeWithPending", { size: formatSizeSummary(summary, locale, t) });
}

function formatStorageSize(bytes: number, locale: "ru" | "en") {
  const units = locale === "ru" ? ["Б", "КБ", "МБ", "ГБ", "ТБ"] : ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

function statusIcon(status: RowVisibleStatus) {
  if (status === "analyzing" || status === "downloading") return "↻";
  if (status === "available" || status === "downloaded") return "✓";
  if (status === "queued") return "≡";
  if (status === "paused" || status === "requiresAuth") return "!";
  if (status === "unavailable" || status === "temporaryError" || status === "analysisError" || status === "downloadFailed") return "×";
  if (status === "cancelled") return "−";
  return "·";
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function isAnalysisTimeout(error: unknown) {
  return String(error).toLowerCase().includes("analysis-error:timeout");
}

function Checkbox({ checked, disabled = false }: { checked: boolean; disabled?: boolean }) {
  return <span className="playlist-checkbox" data-checked={checked || undefined} data-disabled={disabled || undefined} aria-hidden="true" />;
}

function StackedLayoutIcon() {
  return <svg aria-hidden="true" viewBox="0 0 15 15"><rect x="1" y="2" width="13" height="4.5" rx="1.5" /><rect x="1" y="8.5" width="13" height="4.5" rx="1.5" /></svg>;
}

function WideLayoutIcon() {
  return <svg aria-hidden="true" viewBox="0 0 15 15"><rect x="1" y="1" width="5.5" height="13" rx="1.5" /><rect x="8.5" y="1" width="5.5" height="13" rx="1.5" /></svg>;
}
