import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import packageMetadata from "../package.json";
import { Downloader } from "./components/Downloader";
import { History } from "./components/History";
import { Playlist } from "./components/Playlist";
import { YouTubeMusic } from "./components/YouTubeMusic";
import { Queue } from "./components/Queue";
import { Sidebar, sidebarPinnedStorageKey, type AppSection } from "./components/Sidebar";
import { videoProfileStorageKey } from "./components/downloader/videoProfiles";
import { SettingsPanel } from "./components/SettingsPanel";
import { api } from "./lib/api";
import {
  getInitialLocale,
  getSystemLocale,
  localeStorageKey,
  I18nProvider,
  saveLocale,
  useI18n,
  type AppLocale,
} from "./lib/i18n";
import { classifyYoutubeSource, isYoutubeMusicUrl, videoUrlFromMixedSource } from "./lib/sourceUrl";
import { historyKeysFromItems } from "./lib/historyModel";
import {
  getInitialNotificationsEnabled,
  notificationsStorageKey,
  requestNotificationAccess,
  saveNotificationsEnabled,
  showDownloadCompletedNotification,
  showNotificationsEnabledNotification,
} from "./lib/notifications";
import { applyTheme, getInitialTheme, nextThemePreference, saveTheme, systemThemeQuery, themeStorageKey, type ThemePreference } from "./lib/theme";
import type {
  AppSettings,
  BrowserAuthSettings,
  HistoryItem,
  Job,
  SettingsPatch,
  YoutubeAuthPhase,
  YoutubeAuthStart,
  YoutubeAuthStatus,
  UpdateCheckState,
  ComponentId,
  ComponentUpdateCheckState,
} from "./lib/types";
import {
  dismissUpdateNotice,
  getInitialAutomaticUpdateChecksEnabled,
  isCachedUpdateCheckFresh,
  isUpdateNoticeDismissed,
  loadCachedUpdateCheck,
  saveCachedUpdateCheck,
  saveAutomaticUpdateChecksEnabled,
  updateStateFromResult,
  automaticUpdateChecksStorageKey,
  updateCheckStorageKey,
  dismissedUpdateStorageKey,
} from "./lib/updates";
import { localizedYoutubeAuthError } from "./lib/youtubeAuth";
import { browserAuthStorageKey, getInitialBrowserAuthSettings, saveBrowserAuthSettings } from "./lib/browserAuth";
import { clearWorkspace, emptyWorkspace, loadWorkspace, saveWorkspace, workspaceStorageKey, type Workspace, type WorkspaceKey, type WorkspaceView } from "./lib/workspace";

type ThemeTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

const themeTransitionDuration = "1600ms";
const appIconUrl = new URL("./assets/app-icon.png", import.meta.url).href;

const jobStatePriority: Record<Job["state"], number> = {
  Running: 0,
  Completed: 1,
  Pending: 2,
  Paused: 3,
  Failed: 4,
  Cancelled: 5,
};

function sortJobs(jobs: Job[]) {
  return [...jobs].sort((left, right) => {
    const priority = jobStatePriority[left.state] - jobStatePriority[right.state];
    if (priority !== 0) {
      return priority;
    }

    return left.state === "Completed" ? right.id - left.id : left.id - right.id;
  });
}

function upsertJob(current: Job[], incoming: Job) {
  const exists = current.some((job) => job.id === incoming.id);
  if (!exists) {
    return sortJobs([...current, incoming]);
  }

  return sortJobs(current.map((job) => (job.id === incoming.id ? { ...job, ...incoming } : job)));
}

export default function App() {
  const [locale, setLocale] = useState<AppLocale>(getInitialLocale);

  const changeLocale = (nextLocale: AppLocale) => {
    saveLocale(nextLocale);
    setLocale(nextLocale);
  };

  return (
    <I18nProvider locale={locale}>
      <Application locale={locale} onLocaleChange={changeLocale} />
    </I18nProvider>
  );
}

function Application({ locale, onLocaleChange }: { locale: AppLocale; onLocaleChange: (locale: AppLocale) => void }) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [section, setSection] = useState<AppSection>("new");
  const [newDownloadUrl, setNewDownloadUrl] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [musicVisited, setMusicVisited] = useState(false);
  useEffect(() => { if (section === "music") setMusicVisited(true); }, [section]);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"main" | "authorization">("main");
  const [settingsResetVersion, setSettingsResetVersion] = useState(0);
  const [restoredWorkspace, setRestoredWorkspace] = useState<Workspace | null>(null);
  const workspaceRef = useRef<Workspace>(emptyWorkspace());
  const workspaceEnabled = useRef(false);
  const workspaceTimer = useRef<number | null>(null);
  const scheduleWorkspaceSave = useCallback(() => {
    if (!workspaceEnabled.current) return;
    if (workspaceTimer.current !== null) window.clearTimeout(workspaceTimer.current);
    workspaceTimer.current = window.setTimeout(() => {
      workspaceTimer.current = null;
      if (workspaceEnabled.current) saveWorkspace(workspaceRef.current);
    }, 120);
  }, []);
  const workspaceChanged = useCallback((key: WorkspaceKey, view: WorkspaceView) => {
    if (!workspaceEnabled.current) return;
    // The startup snapshot passed to restored forms must keep a stable identity.
    workspaceRef.current = { ...workspaceRef.current, views: { ...workspaceRef.current.views, [key]: view } };
    scheduleWorkspaceSave();
  }, [scheduleWorkspaceSave]);
  const [mixedSourcePrompt, setMixedSourcePrompt] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const downloadedHistoryKeys = useMemo(() => historyKeysFromItems(history), [history]);
  const [repeatDraft, setRepeatDraft] = useState<{ id: string; request?: HistoryItem["request"] } | null>(null);
  const [historyWriteFailurePath, setHistoryWriteFailurePath] = useState<string | null>(null);
  const [defaultDestinationDir, setDefaultDestinationDir] = useState<string | null>(null);
  const [platform, setPlatform] = useState("unknown");
  const [theme, setTheme] = useState<ThemePreference>(getInitialTheme);
  const [notificationsEnabled, setNotificationsEnabled] = useState(getInitialNotificationsEnabled);
  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false);
  const [automaticUpdateChecksEnabled, setAutomaticUpdateChecksEnabled] = useState(
    getInitialAutomaticUpdateChecksEnabled,
  );
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>(() => {
    const cached = loadCachedUpdateCheck(packageMetadata.version);
    return cached ? updateStateFromResult(cached) : { status: "idle" };
  });
  const [componentUpdates, setComponentUpdates] = useState<ComponentUpdateCheckState>({
    status: "idle",
    results: [],
    installingId: null,
    installErrorId: null,
  });
  const [updateNoticeDismissed, setUpdateNoticeDismissed] = useState(() => {
    const cached = loadCachedUpdateCheck(packageMetadata.version);
    return Boolean(
      cached?.updateAvailable && isUpdateNoticeDismissed(cached.latestVersion),
    );
  });
  const youtubeAuthPollTimer = useRef<number | null>(null);
  const youtubeAuthAttempt = useRef(0);
  const automaticUpdateCheckStarted = useRef(false);
  const notificationsEnabledRef = useRef(notificationsEnabled);
  const notificationChangePending = useRef(false);
  const notificationPreferenceVersion = useRef(0);
  const themeTransitionId = useRef(0);
  const localeRef = useRef(locale);
  const notifiedJobs = useRef(new Set<number>());
  const [appSettings, setAppSettings] = useState<AppSettings>({
    concurrency: 2,
    fragmentConcurrency: 1,
    downloadRetries: 3,
    fileAccessRetries: 3,
    fragmentRetries: 3,
    customUserAgentEnabled: false,
    customUserAgent: "",
    includeVideoTechnicalDetailsInFilename: false,
    filenameTemplate: "title",
    filenameCollisionPolicy: "rename",
    playlistFormatSelectionMode: "strict",
    preventSystemSleepWhileDownloading: false,
    minimizeToTray: true,
    completionSoundEnabled: notificationsEnabled,
    showThumbnails: true,
    musicAlbumFolder: true,
    restoreWorkspace: false,
    accentColor: "blue",
    proxyMode: "system",
    proxyHost: "",
    proxyPort: 0,
    proxyUsername: "",
    proxyPasswordSet: false,
  });
  const [authSettings, setAuthSettings] = useState<BrowserAuthSettings>(getInitialBrowserAuthSettings);
  const [youtubeAuthStatus, setYoutubeAuthStatus] = useState<YoutubeAuthStatus>({
    supported: false,
    authenticated: false,
  });
  const [youtubeAuthPhase, setYoutubeAuthPhase] = useState<YoutubeAuthPhase>("idle");
  const [youtubeAuthBrowser, setYoutubeAuthBrowser] = useState<string | null>(null);
  const [youtubeAuthError, setYoutubeAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceEnabled.current) return;
    workspaceRef.current = {
      ...workspaceRef.current,
      urls: { new: newDownloadUrl, playlist: playlistUrl, music: musicUrl },
      activeSection: section === "new" || section === "playlist" || section === "music" ? section : workspaceRef.current.activeSection,
    };
    scheduleWorkspaceSave();
  }, [newDownloadUrl, playlistUrl, musicUrl, section, appSettings.restoreWorkspace, scheduleWorkspaceSave]);

  useEffect(() => {
    const flush = () => {
      if (workspaceTimer.current !== null) window.clearTimeout(workspaceTimer.current);
      workspaceTimer.current = null;
      if (workspaceEnabled.current) saveWorkspace(workspaceRef.current);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", flush); flush(); };
  }, []);

  useEffect(() => {
    let current = true;
    applyTheme(theme);
    const authStatusPromise = api.getYoutubeAuthStatus();
    const cachedUpdate = loadCachedUpdateCheck(packageMetadata.version);
    if (
      !automaticUpdateCheckStarted.current &&
      automaticUpdateChecksEnabled &&
      (!cachedUpdate || !isCachedUpdateCheckFresh(cachedUpdate))
    ) {
      automaticUpdateCheckStarted.current = true;
      void checkForUpdates();
    }
    api
      .getAppStatus()
      .then((status) => setPlatform(status.platform))
      .catch(() => setPlatform("unknown"));
    api
      .getSettings()
      .then(async (settings) => {
        await authStatusPromise.catch(() => undefined);
        if (!current) return;
        setAppSettings({ ...settings, completionSoundEnabled: notificationsEnabledRef.current });
        const saved = settings.restoreWorkspace ? loadWorkspace() : null;
        workspaceRef.current = saved ?? emptyWorkspace();
        workspaceEnabled.current = settings.restoreWorkspace ?? false;
        if (saved) {
          setRestoredWorkspace(saved);
          setNewDownloadUrl((current) => current || saved.urls.new);
          setPlaylistUrl((current) => current || saved.urls.playlist);
          setMusicUrl((current) => current || saved.urls.music);
          setMusicVisited(Boolean(saved.urls.music));
          setSection((current) => current === "new" ? saved.activeSection : current);
        } else if (!settings.restoreWorkspace) clearWorkspace();
      })
      .catch(() => {
        if (!current) return;
        setAppSettings({
          concurrency: 2,
          fragmentConcurrency: 1,
          downloadRetries: 3,
          fileAccessRetries: 3,
          fragmentRetries: 3,
          customUserAgentEnabled: false,
          customUserAgent: "",
          includeVideoTechnicalDetailsInFilename: false,
          filenameTemplate: "title",
          filenameCollisionPolicy: "rename",
          playlistFormatSelectionMode: "strict",
          preventSystemSleepWhileDownloading: false,
          minimizeToTray: true,
          completionSoundEnabled: notificationsEnabledRef.current,
          showThumbnails: true,
          musicAlbumFolder: true,
          accentColor: "blue",
          proxyMode: "system",
          proxyHost: "",
          proxyPort: 0,
          proxyUsername: "",
          proxyPasswordSet: false,
        });
      });
    api.getDefaultDownloadDir()
      .then(setDefaultDestinationDir)
      .catch(() => setDefaultDestinationDir("Downloads"));
    authStatusPromise
      .then((status) => {
        if (!current) return;
        setYoutubeAuthStatus(status);
        setYoutubeAuthBrowser(status.browser ?? null);
        if (status.authenticated) {
          setAuthSettings((current) => {
            const next = {
              ...current,
              useBrowserCookies: false,
              useYoutubeSession: true,
            };
            saveBrowserAuthSettings(next);
            return next;
          });
        }
      })
      .catch(() => undefined);
    api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs.filter((job) => job.state !== "Completed")))).catch(() => setJobs([]));
    api.getHistory().then(setHistory).catch(() => setHistory([]));
    const unlisten = api.onDownloadUpdated((updatedJob) => {
      setJobs((current) => updatedJob.state === "Completed"
        ? current.filter((job) => job.id !== updatedJob.id)
        : upsertJob(current, updatedJob));
      if (updatedJob.state === "Completed") notifyDownloadCompleted(updatedJob);
    });
    const unlistenFinished = api.onDownloadFinished((event) => {
      setJobs((current) => current.filter((job) => job.id !== event.job.id));
      if (event.history) {
        setHistory((current) => [event.history!, ...current.filter((item) => item.id !== event.history!.id)]);
      }
      if (event.historyError) setHistoryWriteFailurePath(event.outputPath);
      notifyDownloadCompleted(event.job);
    });

    return () => {
      current = false;
      youtubeAuthAttempt.current += 1;
      if (youtubeAuthPollTimer.current !== null) {
        window.clearTimeout(youtubeAuthPollTimer.current);
      }
      void unlisten.then((dispose) => dispose());
      void unlistenFinished.then((dispose) => dispose());
    };
  }, []);

  async function checkForUpdates() {
    setUpdateCheck({ status: "checking" });
    try {
      const result = await api.checkForUpdates();
      saveCachedUpdateCheck(result);
      setUpdateCheck(updateStateFromResult(result));
      setUpdateNoticeDismissed(
        result.updateAvailable && isUpdateNoticeDismissed(result.latestVersion),
      );
    } catch {
      setUpdateCheck({ status: "error" });
    }
  }

  async function checkComponentUpdates() {
    setComponentUpdates((current) => ({ ...current, status: "checking", installErrorId: null }));
    try {
      const results = await api.checkComponentUpdates();
      setComponentUpdates((current) => ({ ...current, status: "ready", results }));
    } catch {
      setComponentUpdates((current) => ({ ...current, status: "error" }));
    }
  }

  async function installComponentUpdate(id: ComponentId) {
    setComponentUpdates((current) => ({ ...current, installingId: id, installErrorId: null }));
    try {
      await api.installComponentUpdate(id);
      const results = await api.checkComponentUpdates();
      setComponentUpdates((current) => ({ ...current, status: "ready", results, installingId: null }));
    } catch {
      setComponentUpdates((current) => ({ ...current, installingId: null, installErrorId: id }));
    }
  }

  function changeAutomaticUpdateChecks(enabled: boolean) {
    saveAutomaticUpdateChecksEnabled(enabled);
    setAutomaticUpdateChecksEnabled(enabled);
    if (enabled) {
      void checkForUpdates();
    }
  }

  useEffect(() => {
    localeRef.current = locale;
    document.documentElement.lang = locale;
    void api.setTrayLocale(locale).catch(() => undefined);
  }, [locale]);

  useEffect(() => {
    document.documentElement.dataset.accent = appSettings.accentColor;
  }, [appSettings.accentColor]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia?.(systemThemeQuery);
    if (!media) return;
    const applySystemTheme = () => {
      const themeToggle = document.querySelector<HTMLElement>("[data-theme-toggle]");
      startThemeTransition(() => applyTheme("system"), themeToggle);
    };
    media.addEventListener?.("change", applySystemTheme);
    return () => media.removeEventListener?.("change", applySystemTheme);
  }, [theme]);

  function startThemeTransition(commitTheme: () => void, trigger: HTMLElement | null) {
    const transitionDocument = document as ThemeTransitionDocument;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    if (!transitionDocument.startViewTransition || prefersReducedMotion) {
      commitTheme();
      return;
    }

    const rect = trigger?.getBoundingClientRect();
    const cx = rect && rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect && rect.height > 0 ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const radius = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(window.innerWidth - cx, cy),
      Math.hypot(cx, window.innerHeight - cy),
      Math.hypot(window.innerWidth - cx, window.innerHeight - cy),
    );
    const root = document.documentElement;
    root.style.setProperty("--tt-x", `${cx}px`);
    root.style.setProperty("--tt-y", `${cy}px`);
    root.style.setProperty("--tt-r", `${radius}px`);
    root.style.setProperty("--tt-dur", themeTransitionDuration);
    root.classList.remove("theme-transition-interactive");
    const transitionId = ++themeTransitionId.current;
    const transition = transitionDocument.startViewTransition(commitTheme);
    const unlockTimer = window.setTimeout(() => {
      if (themeTransitionId.current === transitionId) {
        root.classList.add("theme-transition-interactive");
      }
    }, 1000);
    const finish = () => {
      window.clearTimeout(unlockTimer);
      if (themeTransitionId.current === transitionId) {
        root.classList.remove("theme-transition-interactive");
      }
    };
    void transition.finished.then(finish, finish);
  }

  const changeTheme = (nextTheme: ThemePreference, trigger: HTMLElement | null) => {
    const commitTheme = () => {
      applyTheme(nextTheme);
      saveTheme(nextTheme);
      flushSync(() => setTheme(nextTheme));
    };
    startThemeTransition(commitTheme, trigger);
  };

  const toggleTheme = (event: MouseEvent<HTMLButtonElement>) => {
    changeTheme(nextThemePreference(theme), event.currentTarget);
  };

  const resetAppSettings = async (): Promise<boolean> => {
    try {
      const result = await api.resetSettings();
      workspaceEnabled.current = false;
      if (workspaceTimer.current !== null) window.clearTimeout(workspaceTimer.current);
      workspaceTimer.current = null;
      workspaceRef.current = emptyWorkspace();
      // Remove only application preferences, never unrelated WebView storage.
      for (const key of [themeStorageKey, localeStorageKey, browserAuthStorageKey,
        notificationsStorageKey, sidebarPinnedStorageKey, videoProfileStorageKey,
        automaticUpdateChecksStorageKey, updateCheckStorageKey, dismissedUpdateStorageKey, workspaceStorageKey]) {
        window.localStorage.removeItem(key);
      }
      applyNotificationsEnabled(false);
      setAppSettings(result.settings);
      setDefaultDestinationDir(result.defaultDestinationDir);
      setTheme("system");
      onLocaleChange(getSystemLocale());
      const authDefaults = { ...getInitialBrowserAuthSettings(), useYoutubeSession: youtubeAuthStatus.authenticated };
      saveBrowserAuthSettings(authDefaults);
      setAuthSettings(authDefaults);
      setAutomaticUpdateChecksEnabled(true);
      setUpdateNoticeDismissed(false);
      setSettingsResetVersion((version) => version + 1);
      return true;
    } catch {
      return false;
    }
  };

  const updateAppSettings = (patch: SettingsPatch) => {
    if (patch.completionSoundEnabled !== undefined) {
      return changeNotifications(patch.completionSoundEnabled);
    }
    return api
      .updateSettings(patch)
      .then((settings) => {
        if (patch.restoreWorkspace !== undefined) {
          workspaceEnabled.current = settings.restoreWorkspace ?? false;
          if (!workspaceEnabled.current) {
            if (workspaceTimer.current !== null) window.clearTimeout(workspaceTimer.current);
            workspaceTimer.current = null;
            workspaceRef.current = emptyWorkspace();
            clearWorkspace();
          }
        }
        setAppSettings({ ...settings, completionSoundEnabled: notificationsEnabledRef.current });
        if (patch.defaultDownloadDir !== undefined) {
          setDefaultDestinationDir(settings.defaultDownloadDir ?? "Downloads");
        }
        return true;
      })
      .catch(() => false);
  };

  const updateBrowserAuthSettings = (nextSettings: BrowserAuthSettings) => {
    const normalized = {
      ...nextSettings,
      useYoutubeSession: nextSettings.useBrowserCookies ? false : nextSettings.useYoutubeSession,
    };
    setAuthSettings(normalized);
    saveBrowserAuthSettings(normalized);
  };

  const setYoutubeSessionUsage = (enabled: boolean) => {
    setAuthSettings((current) => {
      const next = {
        ...current,
        useBrowserCookies: enabled ? false : current.useBrowserCookies,
        useYoutubeSession: enabled,
      };
      saveBrowserAuthSettings(next);
      return next;
    });
  };

  const stopYoutubeAuthPolling = () => {
    youtubeAuthAttempt.current += 1;
    if (youtubeAuthPollTimer.current !== null) {
      window.clearTimeout(youtubeAuthPollTimer.current);
      youtubeAuthPollTimer.current = null;
    }
  };

  const scheduleYoutubeAuthPoll = (browser: string, startedAt: number) => {
    const attempt = youtubeAuthAttempt.current;
    let everAuthenticated = false;
    let lastAuthenticated = false;
    let consecutiveErrors = 0;
    const isCurrent = () => youtubeAuthAttempt.current === attempt;
    const poll = async () => {
      if (!isCurrent()) return;
      try {
        const state = await api.getYoutubeAuthWindowState();
        if (!isCurrent()) return;
        consecutiveErrors = 0;
        setYoutubeAuthStatus(state.status);
        setYoutubeAuthError(null);
        if (state.sessionDetected) {
          everAuthenticated = true;
          setYoutubeAuthBrowser(state.status.browser ?? browser);
          setYoutubeAuthPhase("success");
          if (!lastAuthenticated) setYoutubeSessionUsage(true);
        } else if (state.open) {
          setYoutubeAuthPhase("waiting");
          if (lastAuthenticated) setYoutubeSessionUsage(false);
        }
        lastAuthenticated = state.sessionDetected;
        if (!state.open) {
          youtubeAuthPollTimer.current = null;
          if (everAuthenticated && state.status.authenticated) {
            setYoutubeAuthPhase("success");
          } else {
            setYoutubeAuthPhase("error");
            setYoutubeAuthError(t("settings.youtubeAuthCancelled"));
          }
          return;
        }
      } catch (error) {
        if (!isCurrent()) return;
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) {
          setYoutubeAuthPhase("error");
          setYoutubeAuthError(localizedYoutubeAuthError(String(error), t) ?? String(error));
        }
      }
      if (!everAuthenticated && Date.now() - startedAt > 3 * 60_000) {
        youtubeAuthPollTimer.current = null;
        const status = await api.cancelYoutubeAuth().catch(() => null);
        if (!isCurrent()) return;
        if (status) setYoutubeAuthStatus(status);
        setYoutubeAuthPhase("error");
        setYoutubeAuthError(t("settings.youtubeAuthTimeout"));
        return;
      }
      if (isCurrent()) youtubeAuthPollTimer.current = window.setTimeout(poll, 500);
    };
    youtubeAuthPollTimer.current = window.setTimeout(poll, 500);
  };

  const startYoutubeLogin = async () => {
    stopYoutubeAuthPolling();
    const attempt = youtubeAuthAttempt.current;
    setYoutubeAuthPhase("opening");
    setYoutubeAuthError(null);
    try {
      const session = await api.startYoutubeAuth(authSettings.browser);
      if (youtubeAuthAttempt.current !== attempt) return;
      setYoutubeAuthBrowser(session.browser);
      setYoutubeAuthPhase("waiting");
      scheduleYoutubeAuthPoll(session.browser, Date.now());
    } catch (error) {
      if (youtubeAuthAttempt.current !== attempt) return;
      setYoutubeAuthPhase("error");
      const message = String(error);
      setYoutubeAuthError(localizedYoutubeAuthError(message, t) ?? message);
    }
  };

  const scheduleYoutubeWebviewAuthPoll = (startedAt: number) => {
    let consecutiveErrors = 0;
    const poll = async () => {
      if (Date.now() - startedAt > 5 * 60_000) {
        youtubeAuthPollTimer.current = null;
        const status = await api.cancelYoutubeWebviewAuth().catch(() => null);
        if (status) setYoutubeAuthStatus(status);
        setYoutubeAuthPhase("error");
        setYoutubeAuthError(t("settings.youtubeAuthTimeout"));
        return;
      }

      try {
        const state = await api.getYoutubeWebviewAuthState();
        consecutiveErrors = 0;
        if (state.authenticated) {
          youtubeAuthPollTimer.current = null;
          const status = await api.getYoutubeAuthStatus();
          setYoutubeAuthStatus(status);
          setYoutubeAuthBrowser(status.browser ?? "WebView2");
          setYoutubeAuthPhase("success");
          setYoutubeAuthError(null);
          setYoutubeSessionUsage(true);
          return;
        }
        if (!state.open) {
          youtubeAuthPollTimer.current = null;
          const status = await api.cancelYoutubeWebviewAuth().catch(() => null);
          if (status) setYoutubeAuthStatus(status);
          setYoutubeAuthPhase("error");
          setYoutubeAuthError(t("settings.youtubeAuthWebviewCancelled"));
          return;
        }
      } catch (error) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) {
          youtubeAuthPollTimer.current = null;
          const status = await api.cancelYoutubeWebviewAuth().catch(() => null);
          if (status) setYoutubeAuthStatus(status);
          setYoutubeAuthPhase("error");
          setYoutubeAuthError(String(error));
          return;
        }
      }
      youtubeAuthPollTimer.current = window.setTimeout(poll, 1_000);
    };
    youtubeAuthPollTimer.current = window.setTimeout(poll, 700);
  };

  const startYoutubeWebviewLogin = async () => {
    stopYoutubeAuthPolling();
    setYoutubeAuthPhase("opening");
    setYoutubeAuthError(null);
    try {
      const session = await api.startYoutubeWebviewAuth();
      setYoutubeAuthBrowser(session.browser);
      setYoutubeAuthPhase("waiting");
      scheduleYoutubeWebviewAuthPoll(Date.now());
    } catch (error) {
      setYoutubeAuthPhase("error");
      setYoutubeAuthError(String(error));
    }
  };

  const signOutYoutube = async () => {
    stopYoutubeAuthPolling();
    try {
      const status = await api.signOutYoutube();
      setYoutubeAuthStatus(status);
      setYoutubeAuthBrowser(null);
      setYoutubeAuthPhase("idle");
      setYoutubeAuthError(null);
      setYoutubeSessionUsage(false);
    } catch (error) {
      setYoutubeAuthPhase("error");
      setYoutubeAuthError(String(error));
    }
  };

  const clearYoutubeAuth = async () => {
    stopYoutubeAuthPolling();
    try {
      const status = await api.clearYoutubeAuth();
      setYoutubeAuthStatus(status);
      setYoutubeAuthBrowser(null);
      setYoutubeAuthPhase("cleared");
      setYoutubeAuthError(null);
      setYoutubeSessionUsage(false);
    } catch (error) {
      setYoutubeAuthPhase("error");
      setYoutubeAuthError(String(error));
    }
  };

  function applyNotificationsEnabled(enabled: boolean) {
    notificationPreferenceVersion.current += 1;
    notificationsEnabledRef.current = enabled;
    saveNotificationsEnabled(enabled);
    setNotificationsEnabled(enabled);
    setAppSettings((current) => ({ ...current, completionSoundEnabled: enabled }));
  }

  function persistCompletionPreference(enabled: boolean) {
    return api.updateSettings({ completionSoundEnabled: enabled }).then((settings) => {
      setAppSettings({ ...settings, completionSoundEnabled: notificationsEnabledRef.current });
    }).catch(() => undefined);
  }

  function notifyDownloadCompleted(job: Job) {
    if (!notificationsEnabledRef.current || notifiedJobs.current.has(job.id)) return;
    notifiedJobs.current.add(job.id);
    const preferenceVersion = notificationPreferenceVersion.current;
    void showDownloadCompletedNotification(job.request.title, localeRef.current).then((shown) => {
      if (preferenceVersion !== notificationPreferenceVersion.current || !notificationsEnabledRef.current) return;
      if (!shown) {
        applyNotificationsEnabled(false);
        void persistCompletionPreference(false);
        return;
      }
    });
  }

  async function changeNotifications(requestedEnabled: boolean): Promise<boolean> {
    if (notificationChangePending.current) return false;
    notificationChangePending.current = true;
    setNotificationPermissionPending(true);
    try {
      if (!requestedEnabled) {
        applyNotificationsEnabled(false);
        await persistCompletionPreference(false);
        return true;
      }
      const granted = await requestNotificationAccess();
      const enabled = granted && await showNotificationsEnabledNotification(localeRef.current);
      applyNotificationsEnabled(enabled);
      await persistCompletionPreference(enabled);
      return enabled;
    } catch {
      applyNotificationsEnabled(false);
      await persistCompletionPreference(false);
      return false;
    } finally {
      notificationChangePending.current = false;
      setNotificationPermissionPending(false);
    }
  }

  const toggleNotifications = () => changeNotifications(!notificationsEnabledRef.current);

  const playlistSourceKind = classifyYoutubeSource(playlistUrl);
  const newDownloadSourceKind = classifyYoutubeSource(newDownloadUrl);
  const sourceIsPlaylist = playlistSourceKind === "playlist" || playlistSourceKind === "mixed";
  const sourceIsVideo = newDownloadSourceKind !== "playlist" && newDownloadSourceKind !== "mixed";
  const activeQueueCount = jobs.filter((job) => ["Pending", "Running", "Paused"].includes(job.state)).length;

  function changeNewDownloadUrl(nextUrl: string) {
    const normalizedNextUrl = nextUrl.trim();
    if (isYoutubeMusicUrl(normalizedNextUrl)) { changeMusicUrl(normalizedNextUrl); return; }
    const kind = classifyYoutubeSource(normalizedNextUrl);
    if (kind === "playlist") {
      setPlaylistUrl(normalizedNextUrl);
      setMixedSourcePrompt(null);
      setSection("playlist");
      return;
    }
    if (kind === "mixed") {
      setMixedSourcePrompt(normalizedNextUrl);
      return;
    }
    if (normalizedNextUrl !== newDownloadUrl.trim()) {
      setRepeatDraft(null);
    }
    setMixedSourcePrompt(null);
    setNewDownloadUrl(nextUrl);
  }

  function changePlaylistUrl(nextUrl: string) {
    const normalizedNextUrl = nextUrl.trim();
    if (isYoutubeMusicUrl(normalizedNextUrl)) { changeMusicUrl(normalizedNextUrl); return; }
    const kind = classifyYoutubeSource(normalizedNextUrl);
    if (kind === "video") {
      setNewDownloadUrl(normalizedNextUrl);
      setRepeatDraft(null);
      setMixedSourcePrompt(null);
      setSection("new");
      return;
    }
    if (kind === "mixed") {
      setMixedSourcePrompt(normalizedNextUrl);
      return;
    }
    setMixedSourcePrompt(null);
    setPlaylistUrl(nextUrl);
  }

  function changeMusicUrl(nextUrl: string) {
    const normalized = nextUrl.trim();
    if (normalized && !isYoutubeMusicUrl(normalized) && classifyYoutubeSource(normalized) !== "invalid") {
      if (classifyYoutubeSource(normalized) === "playlist") changePlaylistUrl(normalized);
      else changeNewDownloadUrl(normalized);
      return;
    }
    setRepeatDraft(null);
    setSection("music");
    if (classifyYoutubeSource(normalized) === "mixed") { setMixedSourcePrompt(normalized); return; }
    setMixedSourcePrompt(null);
    setMusicUrl(nextUrl);
  }

  function chooseMixedSource(kind: "video" | "playlist") {
    const url = mixedSourcePrompt;
    if (!url) return;
    const selectedUrl = kind === "video" ? videoUrlFromMixedSource(url) : url;
    if (isYoutubeMusicUrl(selectedUrl)) {
      setMusicUrl(kind === "playlist" ? (() => { const parsed = new URL(selectedUrl); parsed.searchParams.delete("v"); parsed.pathname = "/playlist"; return parsed.toString(); })() : selectedUrl);
      setMixedSourcePrompt(null); setSection("music"); return;
    }
    if (kind === "video") {
      setNewDownloadUrl(selectedUrl);
      setRepeatDraft(null);
    } else {
      setPlaylistUrl(selectedUrl);
    }
    setMixedSourcePrompt(null);
    setSection(kind === "playlist" ? "playlist" : "new");
  }

  function repeatHistoryItem(item: HistoryItem) {
    if (item.request?.music || isYoutubeMusicUrl(item.url)) {
      setMusicUrl(videoUrlFromMixedSource(item.request?.url ?? item.url));
      setRepeatDraft({ id: item.id, request: item.request }); setSection("music"); return;
    }
    const targetUrl = item.canonicalSource ?? item.url;
    const normalizedTarget = classifyYoutubeSource(targetUrl) === "mixed"
      ? videoUrlFromMixedSource(targetUrl)
      : targetUrl;
    setNewDownloadUrl(normalizedTarget);
    setRepeatDraft({ id: item.id, request: item.request });
    setSection("new");
  }

  function refreshJobs() {
    return api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs.filter((job) => job.state !== "Completed"))));
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar app-header">
          <div className="header-main">
            <div className="brand-block">
              <img className="brand-mark" src={appIconUrl} alt="" aria-hidden="true" />
              <div>
                <h1>YTLoadster</h1>
                <p className="eyebrow">{t("app.tagline")}</p>
              </div>
            </div>
          </div>
        </header>
        <div className="application-body">
          <Sidebar
            key={settingsResetVersion}
            active={section}
            queueCount={activeQueueCount}
            notificationsEnabled={notificationsEnabled}
            notificationPending={notificationPermissionPending}
            theme={theme}
            onSectionChange={setSection}
            onNotifications={() => void toggleNotifications()}
            onTheme={toggleTheme}
            onSettings={() => { setSettingsInitialTab("main"); setSection("settings"); }}
          />
          <div className="application-content">
            {updateCheck.status === "available" && updateCheck.result && automaticUpdateChecksEnabled && !updateNoticeDismissed ? (
              <aside className="update-notice" role="status" aria-live="polite">
                <div className="update-notice-copy"><strong>{t("updates.noticeTitle")}</strong><span>{t("updates.noticeBody", { version: updateCheck.result.latestVersion })}</span></div>
                <button type="button" className="secondary update-notice-open" onClick={() => void api.openExternalUrl(updateCheck.result!.releaseUrl)}>{t("updates.openRelease")}</button>
                <button type="button" className="icon-button secondary update-notice-close" aria-label={t("updates.dismiss")} title={t("updates.dismiss")} onClick={() => { dismissUpdateNotice(updateCheck.result!.latestVersion); setUpdateNoticeDismissed(true); }}><span aria-hidden="true">×</span></button>
              </aside>
            ) : null}
            {historyWriteFailurePath ? (
              <aside className="inline-notice warning-notice" role="status"><span>{t("history.writeFailed", { path: historyWriteFailurePath })}</span><button type="button" className="icon-button" aria-label={t("updates.dismiss")} onClick={() => setHistoryWriteFailurePath(null)}>×</button></aside>
            ) : null}
            <div className="app-section-host" hidden={section !== "new"}>
              <Downloader
                initialWorkspace={restoredWorkspace?.views.new?.kind === "single" ? restoredWorkspace.views.new : undefined}
                workspacePersistenceEnabled={appSettings.restoreWorkspace}
                workspaceKey="new" onWorkspaceChange={workspaceChanged}
                settingsResetVersion={settingsResetVersion}
                authSettings={authSettings}
                defaultDestinationDir={defaultDestinationDir}
                includeVideoTechnicalDetailsInFilename={appSettings.includeVideoTechnicalDetailsInFilename}
                url={newDownloadUrl}
                sourceIsVideo={sourceIsVideo}
                repeatDraft={repeatDraft?.request?.music ? null : repeatDraft}
                onUrlChange={changeNewDownloadUrl}
                onOpenQueue={() => setSection("queue")}
                onRepeatConsumed={() => setRepeatDraft(null)}
                onJobCreated={(job) => setJobs((current) => upsertJob(current, job))}
              />
            </div>
            <div className="app-section-host" hidden={section !== "playlist"}>
              <Playlist
                initialWorkspace={restoredWorkspace?.views.playlist?.kind === "collection" ? restoredWorkspace.views.playlist : undefined}
                workspacePersistenceEnabled={appSettings.restoreWorkspace}
                workspaceKey="playlist" onWorkspaceChange={workspaceChanged}
                settingsResetVersion={settingsResetVersion}
                url={playlistUrl}
                defaultDestinationDir={defaultDestinationDir}
                sourceIsPlaylist={sourceIsPlaylist}
                authSettings={authSettings}
                authenticated={youtubeAuthStatus.authenticated}
                includeVideoTechnicalDetailsInFilename={appSettings.includeVideoTechnicalDetailsInFilename}
                formatSelectionMode={appSettings.playlistFormatSelectionMode}
                showThumbnails={appSettings.showThumbnails}
                jobs={jobs}
                downloadedHistoryKeys={downloadedHistoryKeys}
                onUrlChange={changePlaylistUrl}
                onJobsCreated={(created) => setJobs((current) => created.reduce(upsertJob, current))}
                onOpenQueue={() => setSection("queue")}
              />
            </div>
            <div className="app-section-host" hidden={section !== "music"}>
              {section === "music" || musicVisited ? <YouTubeMusic initialWorkspace={restoredWorkspace} workspacePersistenceEnabled={appSettings.restoreWorkspace} onWorkspaceChange={workspaceChanged} settingsResetVersion={settingsResetVersion} musicAlbumFolder={appSettings.musicAlbumFolder ?? true} onMusicAlbumFolderChange={(enabled) => updateAppSettings({ musicAlbumFolder: enabled })} active={section === "music"} url={musicUrl} authSettings={authSettings} authenticated={youtubeAuthStatus.authenticated} defaultDestinationDir={defaultDestinationDir} formatSelectionMode={appSettings.playlistFormatSelectionMode} showThumbnails={appSettings.showThumbnails} jobs={jobs} downloadedHistoryKeys={downloadedHistoryKeys} repeatDraft={repeatDraft?.request?.music ? repeatDraft : null} onUrlChange={changeMusicUrl} onOpenQueue={() => setSection("queue")} onOpenAuth={() => { setSettingsInitialTab("authorization"); setSection("settings"); }} onJobsCreated={(created) => setJobs((current) => created.reduce(upsertJob, current))} onRepeatConsumed={() => setRepeatDraft(null)} /> : null}
            </div>
            {section === "queue" ? (
              <Queue
                jobs={jobs}
                showThumbnails={appSettings.showThumbnails}
                onCancel={(id) => { void api.cancelJob(id).then(refreshJobs); }}
                onPause={(id) => { void api.pauseJob(id).then(refreshJobs); }}
                onResume={(id) => { void api.resumeJob(id).then(refreshJobs); }}
                onPauseAll={() => { void api.pauseAllJobs().then(refreshJobs); }}
                onResumeAll={() => { void api.resumeAllJobs().then(refreshJobs); }}
                onCancelAll={() => { void api.cancelAllJobs().then(refreshJobs); }}
                onClear={() => { void api.clearJobs().then(refreshJobs); }}
                onRemove={(id) => { void api.removeJob(id).then(() => setJobs((current) => current.filter((job) => job.id !== id))); }}
                onOpenFolder={(path) => { void api.openDownloadFolder(path); }}
                onRetry={(id) => { void api.retryJob(id).then((job) => setJobs((current) => upsertJob(current.filter((item) => item.id !== id), job))); }}
              />
            ) : null}
            {section === "history" ? (
              <History
                items={history}
                showThumbnails={appSettings.showThumbnails}
                onOpenFolder={(path) => { void api.openDownloadFolder(path); }}
                onRepeat={repeatHistoryItem}
                onRemove={async (id) => { await api.removeHistoryItem(id); setHistory((current) => current.filter((item) => item.id !== id)); }}
                onClear={async () => { await api.clearHistory(); setHistory([]); }}
              />
            ) : null}
            {section === "settings" ? (
              <SettingsPanel
                initialTab={settingsInitialTab}
                isOpen
                settings={authSettings}
                downloadSettings={appSettings}
                notificationPending={notificationPermissionPending}
                platform={platform}
                locale={locale}
                theme={theme}
                defaultDestinationDir={defaultDestinationDir}
                onThemeChange={changeTheme}
                youtubeAuthStatus={youtubeAuthStatus}
                youtubeAuthPhase={youtubeAuthPhase}
                youtubeAuthBrowser={youtubeAuthBrowser}
                youtubeAuthError={youtubeAuthError}
                updateCheck={updateCheck}
                componentUpdates={componentUpdates}
                automaticUpdateChecksEnabled={automaticUpdateChecksEnabled}
                onChange={updateBrowserAuthSettings}
                onYoutubeLogin={() => void startYoutubeLogin()}
                onYoutubeWebviewLogin={() => void startYoutubeWebviewLogin()}
                onYoutubeLogout={() => void signOutYoutube()}
                onYoutubeClear={() => void clearYoutubeAuth()}
                onCheckForUpdates={() => void checkForUpdates()}
                onCheckComponentUpdates={() => void checkComponentUpdates()}
                onInstallComponentUpdate={(id) => void installComponentUpdate(id)}
                onAutomaticUpdateChecksChange={changeAutomaticUpdateChecks}
                onDownloadSettingsChange={updateAppSettings}
                onResetSettings={resetAppSettings}
                onLocaleChange={onLocaleChange}
                onOpenExternalUrl={(url) => { void api.openExternalUrl(url).catch(() => undefined); }}
                onClose={() => setSection("new")}
              />
            ) : null}
          </div>
        </div>
      </section>
      {mixedSourcePrompt ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="compact-dialog" role="dialog" aria-modal="true" aria-labelledby="mixed-source-title">
            <h3 id="mixed-source-title">{t("sourceChoice.title")}</h3>
            <p>{t("sourceChoice.text")}</p>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => chooseMixedSource("video")}>{t("sourceChoice.video")}</button>
              <button type="button" className="primary" onClick={() => chooseMixedSource("playlist")}>{t("sourceChoice.playlist")}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
