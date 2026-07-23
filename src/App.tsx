import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Downloader } from "./components/Downloader";
import { Queue } from "./components/Queue";
import { SettingsPanel } from "./components/SettingsPanel";
import { api } from "./lib/api";
import {
  getInitialLocale,
  I18nProvider,
  saveLocale,
  useI18n,
  type AppLocale,
} from "./lib/i18n";
import {
  getInitialNotificationsEnabled,
  requestNotificationAccess,
  saveNotificationsEnabled,
  showDownloadCompletedNotification,
  showNotificationsEnabledNotification,
} from "./lib/notifications";
import { applyTheme, getInitialTheme, saveTheme, type AppTheme } from "./lib/theme";
import type {
  AppSettings,
  BrowserAuthSettings,
  Job,
  SettingsPatch,
  YoutubeAuthPhase,
  YoutubeAuthStart,
  YoutubeAuthStatus,
} from "./lib/types";
import {
  closeYoutubeAuthBrowser,
  hasAuthenticatedYoutubeCookies,
  readYoutubeAuthCookies,
} from "./lib/youtubeAuth";
import { getInitialBrowserAuthSettings, saveBrowserAuthSettings } from "./lib/browserAuth";

type ThemeTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

const fallbackThemeTransitionMs = 850;
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
    return priority === 0 ? left.id - right.id : priority;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [platform, setPlatform] = useState("unknown");
  const [theme, setTheme] = useState<AppTheme>(getInitialTheme);
  const [notificationsEnabled, setNotificationsEnabled] = useState(getInitialNotificationsEnabled);
  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false);
  const themeTransitionTimer = useRef<number | null>(null);
  const youtubeAuthPollTimer = useRef<number | null>(null);
  const notificationsEnabledRef = useRef(notificationsEnabled);
  const localeRef = useRef(locale);
  const notifiedJobs = useRef(new Set<number>());
  const [appSettings, setAppSettings] = useState<AppSettings>({
    concurrency: 2,
    fragmentConcurrency: 1,
    includeVideoTechnicalDetailsInFilename: false,
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
    applyTheme(theme);
    api
      .getAppStatus()
      .then((status) => setPlatform(status.platform))
      .catch(() => setPlatform("unknown"));
    api
      .getSettings()
      .then(setAppSettings)
      .catch(() => setAppSettings({
        concurrency: 2,
        fragmentConcurrency: 1,
        includeVideoTechnicalDetailsInFilename: false,
      }));
    api
      .getYoutubeAuthStatus()
      .then((status) => {
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
    api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs))).catch(() => setJobs([]));
    const unlisten = api.onDownloadUpdated((updatedJob) => {
      setJobs((current) => upsertJob(current, updatedJob));
      if (
        updatedJob.state === "Completed" &&
        notificationsEnabledRef.current &&
        !notifiedJobs.current.has(updatedJob.id)
      ) {
        notifiedJobs.current.add(updatedJob.id);
        void showDownloadCompletedNotification(updatedJob.request.title, localeRef.current).then((shown) => {
          if (!shown) {
            notificationsEnabledRef.current = false;
            saveNotificationsEnabled(false);
            setNotificationsEnabled(false);
          }
        });
      }
    });

    return () => {
      if (themeTransitionTimer.current !== null) {
        window.clearTimeout(themeTransitionTimer.current);
      }
      if (youtubeAuthPollTimer.current !== null) {
        window.clearTimeout(youtubeAuthPollTimer.current);
      }
      document.documentElement.classList.remove("theme-transitioning");
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    localeRef.current = locale;
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);

  const toggleTheme = () => {
    const nextTheme: AppTheme = theme === "light" ? "dark" : "light";
    const root = document.documentElement;
    const transitionDocument = document as ThemeTransitionDocument;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const commitTheme = () => {
      applyTheme(nextTheme);
      saveTheme(nextTheme);
      flushSync(() => setTheme(nextTheme));
    };

    if (themeTransitionTimer.current !== null) {
      window.clearTimeout(themeTransitionTimer.current);
      themeTransitionTimer.current = null;
    }

    if (!prefersReducedMotion && transitionDocument.startViewTransition) {
      const transition = transitionDocument.startViewTransition(commitTheme);
      void transition.finished.finally(() => root.classList.remove("theme-transitioning"));
      return;
    }

    root.classList.add("theme-transitioning");
    commitTheme();
    themeTransitionTimer.current = window.setTimeout(() => {
      root.classList.remove("theme-transitioning");
      themeTransitionTimer.current = null;
    }, prefersReducedMotion ? 0 : fallbackThemeTransitionMs);
  };

  const updateAppSettings = (patch: SettingsPatch) => {
    void api
      .updateSettings(patch)
      .then(setAppSettings)
      .catch(() => undefined);
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

  async function finishYoutubeAuthCapture(browser: string) {
    setYoutubeAuthPhase("capturing");
    setYoutubeAuthError(null);
    let websocketUrl: string | null = null;
    try {
      const capture = await api.prepareYoutubeAuthCapture();
      websocketUrl = capture.websocketUrl ?? null;
      if (!websocketUrl) throw new Error(t("settings.youtubeAuthFailed"));
      const cookies = await readYoutubeAuthCookies(websocketUrl);
      if (!hasAuthenticatedYoutubeCookies(cookies)) {
        await closeYoutubeAuthBrowser(websocketUrl);
        const status = await api.cancelYoutubeAuth();
        setYoutubeAuthStatus(status);
        setYoutubeAuthPhase("error");
        setYoutubeAuthError(t("settings.youtubeAuthCancelled"));
        return;
      }

      await closeYoutubeAuthBrowser(websocketUrl);
      const status = await api.completeYoutubeAuth(browser, cookies);
      setYoutubeAuthStatus(status);
      setYoutubeAuthBrowser(status.browser ?? browser);
      setYoutubeAuthPhase("success");
      setYoutubeAuthError(null);
      setYoutubeSessionUsage(true);
    } catch (error) {
      if (websocketUrl) await closeYoutubeAuthBrowser(websocketUrl);
      const status = await api.cancelYoutubeAuth().catch(() => null);
      if (status) setYoutubeAuthStatus(status);
      setYoutubeAuthPhase("error");
      setYoutubeAuthError(String(error));
    }
  }

  const scheduleYoutubeAuthPoll = (browser: string, startedAt: number) => {
    const poll = async () => {
      if (Date.now() - startedAt > 3 * 60_000) {
        youtubeAuthPollTimer.current = null;
        const status = await api.cancelYoutubeAuth().catch(() => null);
        if (status) setYoutubeAuthStatus(status);
        setYoutubeAuthPhase("error");
        setYoutubeAuthError(t("settings.youtubeAuthTimeout"));
        return;
      }
      try {
        const windowState = await api.getYoutubeAuthWindowState();
        if (windowState.sessionDetected) {
          setYoutubeAuthPhase("finishing");
          setYoutubeAuthError(null);
        }
        if (!windowState.open) {
          youtubeAuthPollTimer.current = null;
          await finishYoutubeAuthCapture(browser);
          return;
        }
      } catch {
        youtubeAuthPollTimer.current = null;
        const status = await api.cancelYoutubeAuth().catch(() => null);
        if (status) setYoutubeAuthStatus(status);
        setYoutubeAuthPhase("error");
        setYoutubeAuthError(t("settings.youtubeAuthCancelled"));
        return;
      }
      youtubeAuthPollTimer.current = window.setTimeout(poll, 1_500);
    };
    youtubeAuthPollTimer.current = window.setTimeout(poll, 500);
  };

  const startYoutubeLogin = async () => {
    if (youtubeAuthPollTimer.current !== null) {
      window.clearTimeout(youtubeAuthPollTimer.current);
      youtubeAuthPollTimer.current = null;
    }
    setYoutubeAuthPhase("opening");
    setYoutubeAuthError(null);
    try {
      const session = await api.startYoutubeAuth(authSettings.browser);
      setYoutubeAuthBrowser(session.browser);
      setYoutubeAuthPhase("waiting");
      scheduleYoutubeAuthPoll(session.browser, Date.now());
    } catch (error) {
      setYoutubeAuthPhase("error");
      setYoutubeAuthError(String(error));
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
    if (youtubeAuthPollTimer.current !== null) {
      window.clearTimeout(youtubeAuthPollTimer.current);
      youtubeAuthPollTimer.current = null;
    }
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
    if (youtubeAuthPollTimer.current !== null) {
      window.clearTimeout(youtubeAuthPollTimer.current);
      youtubeAuthPollTimer.current = null;
    }
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

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      saveNotificationsEnabled(false);
      setNotificationsEnabled(false);
      return;
    }

    setNotificationPermissionPending(true);
    try {
      const granted = await requestNotificationAccess();
      const enabled = granted && await showNotificationsEnabledNotification(locale);
      saveNotificationsEnabled(enabled);
      setNotificationsEnabled(enabled);
    } catch {
      saveNotificationsEnabled(false);
      setNotificationsEnabled(false);
    } finally {
      setNotificationPermissionPending(false);
    }
  };

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
            <div className="header-utilities" aria-label={t("app.utilities")}>
              <button
                type="button"
                className="secondary theme-button notification-button"
                aria-label={notificationsEnabled ? t("notifications.disable") : t("notifications.enable")}
                aria-pressed={notificationsEnabled}
                title={notificationsEnabled ? t("notifications.disable") : t("notifications.enable")}
                disabled={notificationPermissionPending}
                onClick={() => void toggleNotifications()}
              >
                <NotificationIcon enabled={notificationsEnabled} />
              </button>
              <button
                type="button"
                className="secondary theme-button"
                aria-label={theme === "light" ? t("theme.enableDark") : t("theme.enableLight")}
                aria-pressed={theme === "dark"}
                title={theme === "light" ? t("theme.enableDark") : t("theme.enableLight")}
                onClick={toggleTheme}
              >
                <ThemeIcon theme={theme} />
              </button>
              <button type="button" className="secondary settings-button" onClick={() => setSettingsOpen(true)}>
                <HeaderSettingsIcon />
                {t("app.settings")}
              </button>
            </div>
          </div>
        </header>

        <Downloader
          authSettings={authSettings}
          includeVideoTechnicalDetailsInFilename={appSettings.includeVideoTechnicalDetailsInFilename}
          onJobCreated={(job) => setJobs((current) => upsertJob(current, job))}
        />
        <Queue
          jobs={jobs}
          onCancel={(id) => {
            void api.cancelJob(id).then(() =>
              api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs))),
            );
          }}
          onPause={(id) => {
            void api.pauseJob(id).then(() =>
              api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs))),
            );
          }}
          onResume={(id) => {
            void api.resumeJob(id).then(() =>
              api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs))),
            );
          }}
          onPauseAll={() => {
            void api.pauseAllJobs().then(() =>
              api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs))),
            );
          }}
          onResumeAll={() => {
            void api.resumeAllJobs().then(() =>
              api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs))),
            );
          }}
          onCancelAll={() => {
            void api.cancelAllJobs().then(() =>
              api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs))),
            );
          }}
          onClear={() => {
            void api.clearJobs().then(() =>
              api.getJobs().then((loadedJobs) => setJobs(sortJobs(loadedJobs))),
            );
          }}
          onRemove={(id) => {
            void api.removeJob(id).then(() =>
              setJobs((current) => current.filter((job) => job.id !== id)),
            );
          }}
          onOpenFolder={(path) => {
            void api.openDownloadFolder(path);
          }}
          onRetry={(id) => {
            void api
              .retryJob(id)
              .then((job) =>
                setJobs((current) => upsertJob(current.filter((item) => item.id !== id), job)),
              );
          }}
        />
      </section>
      <SettingsPanel
        isOpen={settingsOpen}
        settings={authSettings}
        downloadSettings={appSettings}
        platform={platform}
        locale={locale}
        youtubeAuthStatus={youtubeAuthStatus}
        youtubeAuthPhase={youtubeAuthPhase}
        youtubeAuthBrowser={youtubeAuthBrowser}
        youtubeAuthError={youtubeAuthError}
        onChange={(nextSettings) =>
          updateBrowserAuthSettings(nextSettings)
        }
        onYoutubeLogin={() => void startYoutubeLogin()}
        onYoutubeWebviewLogin={() => void startYoutubeWebviewLogin()}
        onYoutubeLogout={() => void signOutYoutube()}
        onYoutubeClear={() => void clearYoutubeAuth()}
        onDownloadSettingsChange={updateAppSettings}
        onLocaleChange={onLocaleChange}
        onOpenExternalUrl={(url) => {
          void api.openExternalUrl(url).catch(() => undefined);
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </main>
  );
}

function NotificationIcon({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return (
      <svg className="theme-icon notification-icon notification-off-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.1 4.5A4.8 4.8 0 0 1 16.8 8.4v3.1c0 1.15.35 2.27 1 3.22L19 16.5H8.9" />
        <path d="M5.2 16.5 6.4 14.7a5.75 5.75 0 0 0 1-3.22V9.8" />
        <path d="M10 19.2a2.35 2.35 0 0 0 4 0" />
        <path d="M4 4 20 20" />
      </svg>
    );
  }

  return (
    <svg className="theme-icon notification-icon bell-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.8 16.5H5.2l1.2-1.78a5.75 5.75 0 0 0 1-3.22V8.8a4.6 4.6 0 1 1 9.2 0v2.7c0 1.15.35 2.27 1 3.22l1.2 1.78Z" />
      <path d="M10 19.2a2.35 2.35 0 0 0 4 0" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: AppTheme }) {
  if (theme === "dark") {
    return (
      <svg className="theme-icon moon-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.2 15.1A8.4 8.4 0 0 1 8.9 3.8 8.7 8.7 0 1 0 20.2 15.1Z" />
      </svg>
    );
  }

  return (
    <svg className="theme-icon sun-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 2.4v2M12 19.6v2M4.1 4.1l1.4 1.4M18.5 18.5l1.4 1.4M2.4 12h2M19.6 12h2M4.1 19.9l1.4-1.4M18.5 5.5l1.4-1.4" />
    </svg>
  );
}

function HeaderSettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="-1 -1 26 26" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
