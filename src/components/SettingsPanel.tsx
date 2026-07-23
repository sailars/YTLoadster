import { useLayoutEffect, useState } from "react";
import packageMetadata from "../../package.json";
import { useI18n, type AppLocale, type Translate } from "../lib/i18n";
import type {
  AppSettings,
  BrowserAuthSettings,
  SettingsPatch,
  YoutubeAuthPhase,
  YoutubeAuthStatus,
} from "../lib/types";
import { ParameterSelect } from "./ParameterSelect";
import { RiskSlider, type RiskLevel } from "./RiskSlider";

type Props = {
  isOpen: boolean;
  settings: BrowserAuthSettings;
  downloadSettings: AppSettings;
  platform: string;
  locale: AppLocale;
  youtubeAuthStatus: YoutubeAuthStatus;
  youtubeAuthPhase: YoutubeAuthPhase;
  youtubeAuthBrowser: string | null;
  youtubeAuthError: string | null;
  onChange: (settings: BrowserAuthSettings) => void;
  onDownloadSettingsChange: (patch: SettingsPatch) => void;
  onLocaleChange: (locale: AppLocale) => void;
  onYoutubeLogin: () => void;
  onYoutubeWebviewLogin: () => void;
  onYoutubeLogout: () => void;
  onYoutubeClear: () => void;
  onOpenExternalUrl: (url: string) => void;
  onClose: () => void;
};

type SettingsTab = "main" | "downloads" | "about";
type ConnectionRiskKind = "downloads" | "fragments";

const concurrencyOptions = [1, 2, 4, 6, 8];
const fragmentConcurrencyOptions = [1, 2, 4, 8];
const projectUrl = "https://github.com/";
const openSourceComponents = [
  { name: "yt-dlp", url: "https://github.com/yt-dlp/yt-dlp" },
  { name: "Deno", url: "https://github.com/denoland/deno" },
  { name: "FFmpeg", url: "https://ffmpeg.org/" },
];
const appIconUrl = new URL("../assets/app-icon.png", import.meta.url).href;

export function SettingsPanel({
  isOpen,
  settings,
  downloadSettings,
  platform,
  locale,
  youtubeAuthStatus,
  youtubeAuthPhase,
  youtubeAuthBrowser,
  youtubeAuthError,
  onChange,
  onDownloadSettingsChange,
  onLocaleChange,
  onYoutubeLogin,
  onYoutubeWebviewLogin,
  onYoutubeLogout,
  onYoutubeClear,
  onOpenExternalUrl,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>("main");
  const [youtubeAuthWarningOpen, setYoutubeAuthWarningOpen] = useState(false);

  useLayoutEffect(() => {
    if (isOpen) {
      setActiveTab("main");
    } else {
      setYoutubeAuthWarningOpen(false);
    }
  }, [isOpen]);

  const browserOptions = [
    { value: "chrome", label: "Chrome" },
    { value: "firefox", label: "Firefox" },
    { value: "librewolf", label: "LibreWolf" },
    { value: "brave", label: "Brave" },
    { value: "vivaldi", label: "Vivaldi" },
    { value: "opera", label: "Opera" },
    ...(platform === "macos" ? [{ value: "safari", label: "Safari" }] : []),
  ];
  const youtubeAuthBusy = ["opening", "waiting", "finishing", "capturing"].includes(
    youtubeAuthPhase,
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div className="settings-backdrop">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.dialog")}
      >
        <div className="settings-heading">
          <div className="settings-heading-copy">
            <SettingsIcon />
            <div>
              <h2>{t("settings.dialog")}</h2>
              <p>{t("settings.subtitle")}</p>
            </div>
          </div>
          <button type="button" className="icon-button secondary settings-close-button" aria-label={t("settings.close")} title={t("settings.close")} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="settings-tabs" role="tablist" aria-label={t("settings.sections")}>
          <button
            id="settings-main-tab"
            type="button"
            role="tab"
            aria-controls="settings-main-panel"
            aria-selected={activeTab === "main"}
            tabIndex={activeTab === "main" ? 0 : -1}
            className={`settings-tab${activeTab === "main" ? " selected" : ""}`}
            onClick={() => setActiveTab("main")}
          >
            {t("settings.main")}
          </button>
          <button
            id="settings-downloads-tab"
            type="button"
            role="tab"
            aria-controls="settings-downloads-panel"
            aria-selected={activeTab === "downloads"}
            tabIndex={activeTab === "downloads" ? 0 : -1}
            className={`settings-tab${activeTab === "downloads" ? " selected" : ""}`}
            onClick={() => setActiveTab("downloads")}
          >
            {t("settings.downloads")}
          </button>
          <button
            id="settings-about-tab"
            type="button"
            role="tab"
            aria-controls="settings-about-panel"
            aria-selected={activeTab === "about"}
            tabIndex={activeTab === "about" ? 0 : -1}
            className={`settings-tab${activeTab === "about" ? " selected" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            {t("settings.about")}
          </button>
        </div>

        {activeTab === "main" ? (
          <div
            id="settings-main-panel"
            className="settings-panel"
            role="tabpanel"
            aria-labelledby="settings-main-tab"
          >
            <section className="settings-section" aria-labelledby="auth-settings-title">
              <h3 id="auth-settings-title">{t("settings.authorization")}</h3>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.useBrowserCookies}
                  onChange={(event) =>
                    onChange({ ...settings, useBrowserCookies: event.target.checked })
                  }
                />
                <span>{t("settings.browserLogin")}</span>
              </label>

              <label className="settings-field">
                <span>{t("settings.browser")}</span>
                <ParameterSelect
                  label={t("settings.browser")}
                  value={settings.browser}
                  onChange={(browser) => onChange({ ...settings, browser })}
                  disabled={!settings.useBrowserCookies}
                  options={browserOptions}
                />
                <small className="settings-hint">
                  {platform === "macos" ? t("settings.browserMacHint") : t("settings.browserHint")}
                </small>
              </label>

              <div className="youtube-auth-block">
                <div className="youtube-auth-heading">
                  <span>{t("settings.youtubeAuth")}</span>
                  <span
                    className="auth-help-icon"
                    tabIndex={0}
                    role="img"
                    aria-label={t("settings.youtubeAuthHelp")}
                    data-tooltip={t("settings.youtubeAuthHelp")}
                  >
                    ?
                  </span>
                </div>
                <p className={`youtube-auth-status ${youtubeAuthPhase}`} aria-live="polite">
                  {youtubeAuthStatus.authenticated
                    ? t("settings.youtubeAuthSignedIn", {
                        browser: youtubeAuthStatus.browser ?? youtubeAuthBrowser ?? t("settings.youtubeAuthBrowser"),
                      })
                    : youtubeAuthPhase === "opening"
                      ? t("settings.youtubeAuthOpening")
                      : youtubeAuthPhase === "waiting"
                        ? youtubeAuthBrowser === "WebView2"
                          ? t("settings.youtubeAuthWebviewWaiting")
                          : t("settings.youtubeAuthWaiting", {
                              browser: youtubeAuthBrowser ?? t("settings.youtubeAuthBrowser"),
                            })
                        : youtubeAuthPhase === "finishing"
                          ? t("settings.youtubeAuthFinishing")
                        : youtubeAuthPhase === "capturing"
                          ? t("settings.youtubeAuthCapturing")
                        : youtubeAuthPhase === "success"
                          ? t("settings.youtubeAuthSuccess")
                          : youtubeAuthPhase === "cleared"
                            ? t("settings.youtubeAuthCleared")
                          : youtubeAuthPhase === "error"
                            ? youtubeAuthError ?? t("settings.youtubeAuthFailed")
                            : !youtubeAuthStatus.supported
                              ? t("settings.youtubeAuthUnsupported")
                              : t("settings.youtubeAuthDescription")}
                </p>
                <div className="youtube-auth-actions">
                  {!youtubeAuthStatus.authenticated ? (
                    <button
                      type="button"
                      className="secondary youtube-auth-button youtube-auth-webview-button"
                      hidden
                      disabled={!youtubeAuthStatus.supported || youtubeAuthBusy}
                      onClick={onYoutubeWebviewLogin}
                    >
                      {t("settings.youtubeAuthWebviewLogin")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary youtube-auth-button"
                    disabled={!youtubeAuthStatus.supported || youtubeAuthBusy}
                    onClick={
                      youtubeAuthStatus.authenticated
                        ? onYoutubeLogout
                        : () => setYoutubeAuthWarningOpen(true)
                    }
                  >
                    {youtubeAuthStatus.authenticated
                      ? t("settings.youtubeAuthLogout")
                      : t("settings.youtubeAuthLogin")}
                  </button>
                  {!youtubeAuthStatus.authenticated ? (
                    <button
                      type="button"
                      className="secondary youtube-auth-clear-button"
                      disabled={!youtubeAuthStatus.supported || youtubeAuthBusy}
                      onClick={onYoutubeClear}
                    >
                      {t("settings.youtubeAuthClear")}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="settings-section" aria-labelledby="interface-settings-title">
              <h3 id="interface-settings-title">{t("settings.interface")}</h3>
              <label className="settings-field settings-language-field">
                <span>{t("settings.language")}</span>
                <ParameterSelect
                  label={t("settings.language")}
                  value={locale}
                  onChange={(value) => onLocaleChange(value as AppLocale)}
                  options={[
                    { value: "ru", label: t("settings.languageRussian") },
                    { value: "en", label: t("settings.languageEnglish") },
                  ]}
                />
              </label>
            </section>
          </div>
        ) : activeTab === "downloads" ? (
          <div
            id="settings-downloads-panel"
            className="settings-panel"
            role="tabpanel"
            aria-labelledby="settings-downloads-tab"
          >
            <section className="settings-section settings-downloads-section" aria-labelledby="download-settings-title">
              <h3 id="download-settings-title">{t("settings.downloads")}</h3>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={downloadSettings.includeVideoTechnicalDetailsInFilename}
                  onChange={(event) => onDownloadSettingsChange({
                    includeVideoTechnicalDetailsInFilename: event.target.checked,
                  })}
                />
                <span>{t("settings.videoTechnicalFilename")}</span>
              </label>
              <div className="settings-field-grid">
                <div className="settings-field">
                  <span>{t("settings.concurrent")}</span>
                  <RiskSlider
                    label={t("settings.concurrent")}
                    value={downloadSettings.concurrency}
                    options={concurrencyOptions}
                    riskLevel={connectionRisk(downloadSettings.concurrency, "downloads", t).level}
                    riskLabel={connectionRisk(downloadSettings.concurrency, "downloads", t).label}
                    onChange={(concurrency) => onDownloadSettingsChange({ concurrency })}
                  />
                  <ConnectionRisk value={downloadSettings.concurrency} kind="downloads" />
                </div>

                <div className="settings-field">
                  <span>{t("settings.fragments")}</span>
                  <RiskSlider
                    label={t("settings.fragments")}
                    value={downloadSettings.fragmentConcurrency}
                    options={fragmentConcurrencyOptions}
                    riskLevel={connectionRisk(downloadSettings.fragmentConcurrency, "fragments", t).level}
                    riskLabel={connectionRisk(downloadSettings.fragmentConcurrency, "fragments", t).label}
                    onChange={(fragmentConcurrency) => onDownloadSettingsChange({ fragmentConcurrency })}
                  />
                  <ConnectionRisk value={downloadSettings.fragmentConcurrency} kind="fragments" />
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div
            id="settings-about-panel"
            className="settings-panel about-panel"
            role="tabpanel"
            aria-labelledby="settings-about-tab"
          >
            <div className="about-program">
              <img className="about-program-icon" src={appIconUrl} alt="" />
              <div className="about-program-copy">
                <h3>YTLoadster</h3>
                <p>{t("settings.aboutDescription")}</p>
              </div>
            </div>
            <dl className="about-details">
              <div>
                <dt>{t("settings.version")}</dt>
                <dd>{packageMetadata.version}</dd>
              </div>
              <div>
                <dt>{t("settings.project")}</dt>
                <dd>
                  <a href={projectUrl} onClick={(event) => openExternalLink(event, projectUrl, onOpenExternalUrl)}>
                    GitHub
                  </a>
                </dd>
              </div>
            </dl>
            <section className="about-components" aria-labelledby="about-components-title">
              <h3 id="about-components-title">{t("settings.openSource")}</h3>
              <p>{t("settings.openSourceText")}</p>
              <ul>
                {openSourceComponents.map((component) => (
                  <li key={component.name}>
                    <a
                      href={component.url}
                      onClick={(event) => openExternalLink(event, component.url, onOpenExternalUrl)}
                    >
                      {component.name}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </section>

      {youtubeAuthWarningOpen ? (
        <div className="youtube-auth-warning-backdrop">
          <section
            className="youtube-auth-warning-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="youtube-auth-warning-title"
            aria-describedby="youtube-auth-warning-description"
            onKeyDown={(event) => {
              if (event.key === "Escape") setYoutubeAuthWarningOpen(false);
            }}
          >
            <div className="youtube-auth-warning-heading">
              <YoutubeAuthNoticeIcon />
              <div>
                <h3 id="youtube-auth-warning-title">{t("settings.youtubeAuthNoticeTitle")}</h3>
                <p id="youtube-auth-warning-description">{t("settings.youtubeAuthNoticeIntro")}</p>
              </div>
            </div>
            <ol className="youtube-auth-warning-steps">
              <li>{t("settings.youtubeAuthNoticeSignIn")}</li>
              <li>{t("settings.youtubeAuthNoticeWait")}</li>
              <li>{t("settings.youtubeAuthNoticeClose")}</li>
            </ol>
            <div className="youtube-auth-warning-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setYoutubeAuthWarningOpen(false)}
              >
                {t("settings.youtubeAuthNoticeCancel")}
              </button>
              <button
                type="button"
                className="primary youtube-auth-warning-continue"
                autoFocus
                onClick={() => {
                  setYoutubeAuthWarningOpen(false);
                  onYoutubeLogin();
                }}
              >
                {t("settings.youtubeAuthNoticeContinue")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function openExternalLink(
  event: React.MouseEvent<HTMLAnchorElement>,
  url: string,
  onOpenExternalUrl: (url: string) => void,
) {
  event.preventDefault();
  onOpenExternalUrl(url);
}

function ConnectionRisk({ value, kind }: { value: number; kind: ConnectionRiskKind }) {
  const { t } = useI18n();
  const risk = connectionRisk(value, kind, t);

  return (
    <output className="connection-risk" data-risk={risk.level} aria-label={t("risk.label", { risk: risk.label })}>
      <i className="connection-risk-dot" aria-hidden="true" />
      <span>{t("risk.label", { risk: risk.label })}</span>
    </output>
  );
}

function connectionRisk(value: number, kind: ConnectionRiskKind, t: Translate): { level: RiskLevel; label: string } {
  if (value <= 1) {
    return { level: "low", label: t("risk.low") };
  }

  if (value <= 2) {
    return { level: "guarded", label: t("risk.guarded") };
  }

  if (value <= 4) {
    return { level: "medium", label: t("risk.medium") };
  }

  if (kind === "downloads" && value >= 8) {
    return { level: "critical", label: t("risk.critical") };
  }

  return { level: "high", label: t("risk.high") };
}

function SettingsIcon() {
  return (
    <svg className="outline-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4" width="17" height="16" rx="2.25" />
      <path d="M7 9h3" />
      <path d="M14 9h3" />
      <path d="M7 15h3" />
      <path d="M14 15h3" />
      <circle cx="11.75" cy="9" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12.25" cy="15" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M7 7l10 10M17 7 7 17" />
    </svg>
  );
}

function YoutubeAuthNoticeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8v5.3" />
      <path d="M12 7.4h.01" />
    </svg>
  );
}
