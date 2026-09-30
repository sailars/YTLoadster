import { useEffect, useId, useLayoutEffect, useState } from "react";
import packageMetadata from "../../package.json";
import { useI18n, type AppLocale, type Translate, type TranslationKey } from "../lib/i18n";
import { api } from "../lib/api";
import type { ThemePreference } from "../lib/theme";
import type {
  AppSettings,
  ComponentId,
  ComponentUpdateCheckState,
  BrowserAuthSettings,
  PlaylistFormatSelectionMode,
  SettingsPatch,
  UpdateCheckState,
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
  theme: ThemePreference;
  defaultDestinationDir: string | null;
  youtubeAuthStatus: YoutubeAuthStatus;
  youtubeAuthPhase: YoutubeAuthPhase;
  youtubeAuthBrowser: string | null;
  youtubeAuthError: string | null;
  onChange: (settings: BrowserAuthSettings) => void;
  onDownloadSettingsChange: (patch: SettingsPatch) => Promise<boolean>;
  onThemeChange: (theme: ThemePreference, trigger: HTMLElement) => void;
  onLocaleChange: (locale: AppLocale) => void;
  onYoutubeLogin: () => void;
  onYoutubeWebviewLogin: () => void;
  onYoutubeLogout: () => void;
  onYoutubeClear: () => void;
  updateCheck: UpdateCheckState;
  componentUpdates: ComponentUpdateCheckState;
  automaticUpdateChecksEnabled: boolean;
  onCheckForUpdates: () => void;
  onCheckComponentUpdates: () => void;
  onInstallComponentUpdate: (id: ComponentId) => void;
  onAutomaticUpdateChecksChange: (enabled: boolean) => void;
  onOpenExternalUrl: (url: string) => void;
  onClose: () => void;
};

type SettingsTab = "main" | "downloads" | "network" | "authorization" | "appearance" | "about";
const settingsCategories: Array<{ key: SettingsTab; label: TranslationKey }> = [
  { key: "main", label: "settings.main" },
  { key: "downloads", label: "settings.downloads" },
  { key: "network", label: "settings.network" },
  { key: "authorization", label: "settings.authorization" },
  { key: "appearance", label: "settings.appearance" },
  { key: "about", label: "settings.about" },
];
type ConnectionRiskKind = "downloads" | "fragments";

const concurrencyOptions = [1, 2, 4, 6, 8];
const fragmentConcurrencyOptions = [1, 2, 4, 8];
const defaultRetrySettings = {
  downloadRetries: 3,
  fileAccessRetries: 3,
  fragmentRetries: 3,
};
const projectUrl = "https://github.com/sailars/YTLoadster";
const openSourceComponents = [
  { name: "yt-dlp", url: "https://github.com/yt-dlp/yt-dlp" },
  { name: "Deno", url: "https://github.com/denoland/deno" },
  { name: "FFmpeg", url: "https://ffmpeg.org/" },
];
const componentNames: Record<ComponentId, string> = {
  ytdlp: "yt-dlp",
  deno: "Deno",
  ffmpeg: "FFmpeg / FFprobe",
};
const appIconUrl = new URL("../assets/app-icon.png", import.meta.url).href;

export function SettingsPanel({
  isOpen,
  settings,
  downloadSettings,
  platform,
  locale,
  theme,
  defaultDestinationDir,
  youtubeAuthStatus,
  youtubeAuthPhase,
  youtubeAuthBrowser,
  youtubeAuthError,
  onChange,
  onDownloadSettingsChange,
  onThemeChange,
  onLocaleChange,
  onYoutubeLogin,
  onYoutubeWebviewLogin,
  onYoutubeLogout,
  onYoutubeClear,
  updateCheck,
  componentUpdates,
  automaticUpdateChecksEnabled,
  onCheckForUpdates,
  onCheckComponentUpdates,
  onInstallComponentUpdate,
  onAutomaticUpdateChecksChange,
  onOpenExternalUrl,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>("main");
  const [youtubeAuthWarningOpen, setYoutubeAuthWarningOpen] = useState(false);
  const [customUserAgentDraft, setCustomUserAgentDraft] = useState(downloadSettings.customUserAgent);
  const [proxyDraft, setProxyDraft] = useState(() => ({
    mode: downloadSettings.proxyMode,
    host: downloadSettings.proxyHost,
    port: downloadSettings.proxyPort ? String(downloadSettings.proxyPort) : "",
    username: downloadSettings.proxyUsername,
    password: "",
    clearPassword: false,
  }));
  const [proxySaveState, setProxySaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setCustomUserAgentDraft(downloadSettings.customUserAgent);
  }, [downloadSettings.customUserAgent]);

  useEffect(() => {
    setProxyDraft((current) => ({
      ...current,
      mode: downloadSettings.proxyMode,
      host: downloadSettings.proxyHost,
      port: downloadSettings.proxyPort ? String(downloadSettings.proxyPort) : "",
      username: downloadSettings.proxyUsername,
      password: "",
      clearPassword: false,
    }));
  }, [downloadSettings.proxyMode, downloadSettings.proxyHost, downloadSettings.proxyPort, downloadSettings.proxyUsername]);

  useLayoutEffect(() => {
    if (isOpen) {
      setActiveTab("main");
    } else {
      setYoutubeAuthWarningOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (youtubeAuthWarningOpen) {
        setYoutubeAuthWarningOpen(false);
        return;
      }
      onClose();
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose, youtubeAuthWarningOpen]);

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
  const normalizedCustomUserAgent = customUserAgentDraft.trim();
  const customUserAgentError = validateCustomUserAgent(
    customUserAgentDraft,
    downloadSettings.customUserAgentEnabled,
    t,
  );
  const customUserAgentDirty = normalizedCustomUserAgent !== downloadSettings.customUserAgent;
  const manualProxy = !["system", "none"].includes(proxyDraft.mode);
  const proxyPasswordPresent = Boolean(proxyDraft.password || (downloadSettings.proxyPasswordSet && !proxyDraft.clearPassword));

  if (!isOpen) {
    return null;
  }

  return (
    <div className="settings-page">
      <section
        className="settings-page-shell"
        aria-label={t("settings.dialog")}
      >
        <header className="settings-page-heading"><h2>{t("settings.dialog")}</h2></header>
        <div className="settings-page-layout">
          <nav className="settings-category-nav" role="tablist" aria-label={t("settings.sections")}>
            {settingsCategories.map(({ key, label }) => (
              <button
                key={key}
                id={`settings-${key}-tab`}
                type="button"
                className="settings-category-button"
                data-active={activeTab === key || undefined}
                aria-current={activeTab === key ? "page" : undefined}
                role="tab"
                aria-controls={`settings-${key}-panel`}
                aria-selected={activeTab === key}
                onClick={() => setActiveTab(key)}
              >
                <SettingsCategoryIcon kind={key} />
                <span>{t(label)}</span>
              </button>
            ))}
          </nav>
          <div className="settings-page-content">

        {activeTab === "main" ? (
          <div
            id="settings-main-panel"
            className="settings-panel"
            role="tabpanel"
            aria-labelledby="settings-main-tab"
          >
            <section className="settings-section" aria-labelledby="interface-settings-title">
              <h3 id="interface-settings-title">{t("settings.interface")}</h3>
              <div className="settings-field settings-language-field">
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
              </div>
              <label className="settings-switch-row">
                <span>{t("settings.completionSound")}</span>
                <SettingsSwitch role="switch" checked={downloadSettings.completionSoundEnabled}
                  onChange={(checked) => { void onDownloadSettingsChange({ completionSoundEnabled: checked }); }} />
              </label>
            </section>
            <section className="settings-section" aria-labelledby="behavior-settings-title">
              <h3 id="behavior-settings-title">{t("settings.system")}</h3>
              <div className="settings-toggle-with-help">
                <div className="settings-toggle-copy">
                  <span>{t("settings.preventSleep")}</span>
                  <span className="auth-help-icon" tabIndex={0} role="img"
                    aria-label={t("settings.preventSleepHelp")}
                    data-tooltip={t("settings.preventSleepHelp")}>?</span>
                </div>
                <SettingsSwitch label={t("settings.preventSleep")}
                  checked={downloadSettings.preventSystemSleepWhileDownloading}
                  onChange={(checked) => { void onDownloadSettingsChange({ preventSystemSleepWhileDownloading: checked }); }} />
              </div>
              <div className="settings-toggle-with-help">
                <div className="settings-toggle-copy">
                  <span>{t("settings.minimizeToTray")}</span>
                  <span className="auth-help-icon" tabIndex={0} role="img"
                    aria-label={t("settings.minimizeToTrayHelp")}
                    data-tooltip={t("settings.minimizeToTrayHelp")}>?</span>
                </div>
                <SettingsSwitch label={t("settings.minimizeToTray")}
                  checked={downloadSettings.minimizeToTray}
                  onChange={(checked) => { void onDownloadSettingsChange({ minimizeToTray: checked }); }} />
              </div>
              <label className="settings-switch-row">
                <span>{t("updates.automatic")}</span>
                <SettingsSwitch role="switch" checked={automaticUpdateChecksEnabled}
                  onChange={onAutomaticUpdateChecksChange} />
              </label>
            </section>
          </div>
        ) : activeTab === "authorization" ? (
          <div id="settings-authorization-panel" className="settings-panel" role="tabpanel" aria-labelledby="settings-authorization-tab">
            <section className="settings-section" aria-labelledby="auth-settings-title">
              <h3 id="auth-settings-title">{t("settings.authorization")}</h3>
              <div className="browser-cookie-auth-block">
                <div className="browser-cookie-auth-heading">
                  <div className="settings-toggle-copy">
                    <span>{t("settings.browserLogin")}</span>
                    <span className="auth-help-icon" tabIndex={0} role="img"
                      aria-label={t("settings.browserLoginHelp")}
                      data-tooltip={t("settings.browserLoginHelp")}>?</span>
                  </div>
                  <SettingsSwitch label={t("settings.browserLogin")}
                    checked={settings.useBrowserCookies}
                    onChange={(checked) => onChange({ ...settings, useBrowserCookies: checked })} />
                </div>
                <p className="settings-hint">{t("settings.browserLoginDescription")}</p>

                {settings.useBrowserCookies ? (
                  <div className="settings-field browser-cookie-browser-field">
                    <span>{t("settings.browser")}</span>
                    <ParameterSelect
                      label={t("settings.browser")}
                      value={settings.browser}
                      onChange={(browser) => onChange({ ...settings, browser })}
                      options={browserOptions}
                    />
                    <small className="settings-hint">
                      {platform === "macos" ? t("settings.browserMacHint") : t("settings.browserHint")}
                    </small>
                  </div>
                ) : null}
              </div>

              <div className="youtube-auth-block">
                <div className="youtube-auth-heading">
                  <span>{t("settings.youtubeAuthFallback")}</span>
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

          </div>
        ) : activeTab === "downloads" ? (
          <div
            id="settings-downloads-panel"
            className="settings-panel"
            role="tabpanel"
            aria-labelledby="settings-downloads-tab"
          >
            <section className="settings-section" aria-labelledby="download-location-title">
              <h3 id="download-location-title">{t("settings.location")}</h3>
              <div className="settings-field settings-default-folder">
                <span>{t("settings.defaultFolder")}</span>
                <div className="settings-path-row">
                  <input type="text" readOnly value={defaultDestinationDir ?? ""} aria-label={t("settings.defaultFolder")} />
                  <button type="button" className="secondary" onClick={() => {
                    void api.selectDownloadDir(defaultDestinationDir).then((selected) => {
                      if (selected) void onDownloadSettingsChange({ defaultDownloadDir: selected });
                    });
                  }}>{t("downloader.browse")}</button>
                </div>
              </div>
            </section>
            <section className="settings-section settings-downloads-section" aria-labelledby="download-settings-title">
              <h3 id="download-settings-title">{t("settings.behavior")}</h3>
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

            <section className="settings-section settings-file-names-section" aria-labelledby="file-name-settings-title">
              <h3 id="file-name-settings-title">{t("settings.fileNames")}</h3>
              <div className="settings-field settings-select-row">
                <span>{t("settings.filenameTemplate")}</span>
                <ParameterSelect label={t("settings.filenameTemplate")} value={downloadSettings.filenameTemplate}
                  onChange={(filenameTemplate) => { void onDownloadSettingsChange({ filenameTemplate: filenameTemplate as AppSettings["filenameTemplate"] }); }}
                  options={[
                    { value: "title", label: t("settings.templateTitle") },
                    { value: "title-id", label: t("settings.templateTitleId") },
                    { value: "channel-title", label: t("settings.templateChannelTitle") },
                    { value: "date-title", label: t("settings.templateDateTitle") },
                  ]} />
              </div>
              <div className="settings-field settings-select-row">
                <span>{t("settings.filenameCollision")}</span>
                <ParameterSelect label={t("settings.filenameCollision")} value={downloadSettings.filenameCollisionPolicy}
                  onChange={(filenameCollisionPolicy) => { void onDownloadSettingsChange({ filenameCollisionPolicy: filenameCollisionPolicy as AppSettings["filenameCollisionPolicy"] }); }}
                  options={[
                    { value: "rename", label: t("settings.collisionRename") },
                    { value: "replace", label: t("settings.collisionReplace") },
                  ]} />
              </div>
              <label className="checkbox-label">
                <SettingsSwitch
                  checked={downloadSettings.includeVideoTechnicalDetailsInFilename}
                  onChange={(checked) => onDownloadSettingsChange({
                    includeVideoTechnicalDetailsInFilename: checked,
                  })}
                />
                <span>{t("settings.videoTechnicalFilename")}</span>
              </label>
            </section>

            <section className="settings-section settings-playlist-format-section" aria-labelledby="playlist-format-settings-title">
              <h3 id="playlist-format-settings-title">{t("settings.playlists")}</h3>
              <div className="settings-field settings-playlist-format-mode">
                <div className="settings-field-label-with-help">
                  <span>{t("settings.playlistFormatSelectionMode")}</span>
                  <span
                    className="auth-help-icon"
                    tabIndex={0}
                    role="img"
                    aria-label={t("settings.playlistFormatSelectionHelp")}
                    data-tooltip={t("settings.playlistFormatSelectionHelp")}
                  >
                    ?
                  </span>
                </div>
                <ParameterSelect
                  label={t("settings.playlistFormatSelectionMode")}
                  value={downloadSettings.playlistFormatSelectionMode}
                  options={[
                    { value: "strict", label: t("settings.playlistFormatStrict"), description: t("settings.playlistFormatStrictDescription") },
                    { value: "adaptive", label: t("settings.playlistFormatAdaptive"), description: t("settings.playlistFormatAdaptiveDescription") },
                  ]}
                  onChange={(playlistFormatSelectionMode) => onDownloadSettingsChange({
                    playlistFormatSelectionMode: playlistFormatSelectionMode as PlaylistFormatSelectionMode,
                  })}
                />
              </div>
            </section>

            <section className="settings-section settings-retries-section" aria-labelledby="retry-settings-title">
              <div className="settings-section-heading">
                <div>
                  <h3 id="retry-settings-title">{t("settings.retries")}</h3>
                  <p className="settings-hint">{t("settings.retriesHint")}</p>
                </div>
                <button
                  type="button"
                  className="secondary settings-reset-button"
                  aria-label={t("settings.restoreDefaults")}
                  title={t("settings.restoreDefaults")}
                  onClick={() => onDownloadSettingsChange(defaultRetrySettings)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 10a9 9 0 1 1 2.6 8.4" />
                    <path d="M3 4v6h6" />
                  </svg>
                </button>
              </div>
              <div className="settings-field-grid settings-retry-grid">
                <RetryNumberField
                  label={t("settings.downloadRetries")}
                  description={t("settings.downloadRetriesHint")}
                  max={30}
                  value={downloadSettings.downloadRetries}
                  onChange={(downloadRetries) => onDownloadSettingsChange({ downloadRetries })}
                />
                <RetryNumberField
                  label={t("settings.fileAccessRetries")}
                  description={t("settings.fileAccessRetriesHint")}
                  max={10}
                  value={downloadSettings.fileAccessRetries}
                  onChange={(fileAccessRetries) => onDownloadSettingsChange({ fileAccessRetries })}
                />
                <RetryNumberField
                  label={t("settings.fragmentRetries")}
                  description={t("settings.fragmentRetriesHint")}
                  max={30}
                  value={downloadSettings.fragmentRetries}
                  onChange={(fragmentRetries) => onDownloadSettingsChange({ fragmentRetries })}
                />
              </div>
            </section>

          </div>
        ) : activeTab === "network" ? (
          <div id="settings-network-panel" className="settings-panel" role="tabpanel" aria-labelledby="settings-network-tab">
            <section className="settings-section" aria-labelledby="proxy-settings-title">
              <h3 id="proxy-settings-title">{t("settings.proxy")}</h3>
              <div className="settings-field settings-proxy-mode">
                <ParameterSelect label={t("settings.proxy")} value={proxyDraft.mode}
                  onChange={(mode) => {
                    const proxyMode = mode as AppSettings["proxyMode"];
                    setProxyDraft((current) => ({ ...current, mode: proxyMode }));
                    setProxySaveState("idle");
                    if (proxyMode === "system" || proxyMode === "none") {
                      void onDownloadSettingsChange({ proxyMode }).then((saved) => {
                        if (!saved) {
                          setProxyDraft((current) => ({ ...current, mode: downloadSettings.proxyMode }));
                          setProxySaveState("error");
                        }
                      });
                    }
                  }}
                  options={[
                    { value: "system", label: t("settings.proxySystem") },
                    { value: "none", label: t("settings.proxyNone") },
                    { value: "http", label: "HTTP" },
                    { value: "https", label: "HTTPS" },
                    { value: "socks5", label: "SOCKS5" },
                  ]} />
              </div>
              {manualProxy ? (
                <div className="settings-proxy-fields">
                  <label className="settings-field"><span>{t("settings.proxyHost")}</span>
                    <input type="text" value={proxyDraft.host} autoComplete="off" onChange={(event) => setProxyDraft((current) => ({ ...current, host: event.target.value }))} /></label>
                  <label className="settings-field"><span>{t("settings.proxyPort")}</span>
                    <input type="number" min={1} max={65535} value={proxyDraft.port} onChange={(event) => setProxyDraft((current) => ({ ...current, port: event.target.value }))} /></label>
                  <label className="settings-field"><span>{t("settings.proxyUsername")}</span>
                    <input type="text" value={proxyDraft.username} autoComplete="off" onChange={(event) => setProxyDraft((current) => ({ ...current, username: event.target.value }))} /></label>
                  <label className="settings-field"><span>{t("settings.proxyPassword")}</span>
                    <input type="password" value={proxyDraft.password} autoComplete="new-password"
                      placeholder={downloadSettings.proxyPasswordSet && !proxyDraft.clearPassword ? t("settings.proxyPasswordSaved") : ""}
                      onChange={(event) => setProxyDraft((current) => ({ ...current, password: event.target.value, clearPassword: false }))} /></label>
                  {downloadSettings.proxyPasswordSet ? <button type="button" className="secondary settings-proxy-clear"
                    onClick={() => setProxyDraft((current) => ({ ...current, password: "", clearPassword: true }))}>
                    {t("settings.proxyClearPassword")}
                  </button> : null}
                </div>
              ) : null}
              {manualProxy ? <div className="settings-proxy-actions">
                <button type="button" className="primary" disabled={proxySaveState === "saving" ||
                  !proxyDraft.host.trim() || !Number.isInteger(Number(proxyDraft.port)) || Number(proxyDraft.port) < 1 || Number(proxyDraft.port) > 65535 || (proxyPasswordPresent && !proxyDraft.username.trim())}
                  onClick={() => {
                    setProxySaveState("saving");
                    void onDownloadSettingsChange({
                      proxyMode: proxyDraft.mode,
                      proxyHost: proxyDraft.host.trim(),
                      proxyPort: Number(proxyDraft.port) || 0,
                      proxyUsername: proxyDraft.username.trim(),
                      ...(proxyDraft.password || proxyDraft.clearPassword ? { proxyPassword: proxyDraft.password } : {}),
                    }).then((saved) => setProxySaveState(saved ? "saved" : "error"));
                  }}>{t("common.save")}</button>
                <span role="status" className="settings-proxy-status">
                  {proxySaveState === "saved" ? t("settings.proxySaved") : proxySaveState === "error" ? t("settings.proxySaveError") : ""}
                </span>
              </div> : proxySaveState === "error" ? (
                <p className="settings-proxy-error" role="alert">{t("settings.proxySaveError")}</p>
              ) : null}
            </section>
            <section className="settings-section settings-user-agent-section" aria-labelledby="user-agent-settings-title">
              <h3 id="user-agent-settings-title">{t("settings.userAgent")}</h3>
              <label className="checkbox-label">
                <SettingsSwitch
                  checked={downloadSettings.customUserAgentEnabled}
                  disabled={!downloadSettings.customUserAgentEnabled && Boolean(validateCustomUserAgent(customUserAgentDraft, true, t))}
                  onChange={(checked) => {
                    if (checked) {
                      onDownloadSettingsChange({
                        customUserAgentEnabled: true,
                        customUserAgent: normalizedCustomUserAgent,
                      });
                    } else {
                      onDownloadSettingsChange({ customUserAgentEnabled: false });
                    }
                  }}
                />
                <span>{t("settings.useCustomUserAgent")}</span>
              </label>
              <p className="settings-hint" id="custom-user-agent-hint">{t("settings.userAgentHint")}</p>
              <div className="settings-user-agent-row">
                <label className="settings-field">
                  <span>User-Agent</span>
                  <input
                    type="text"
                    value={customUserAgentDraft}
                    maxLength={1024}
                    placeholder="Mozilla/5.0 ..."
                    aria-describedby="custom-user-agent-hint custom-user-agent-error"
                    aria-invalid={Boolean(customUserAgentError)}
                    onChange={(event) => setCustomUserAgentDraft(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="secondary settings-user-agent-save"
                  disabled={!customUserAgentDirty || Boolean(customUserAgentError)}
                  onClick={() => onDownloadSettingsChange({ customUserAgent: normalizedCustomUserAgent })}
                >
                  {t("common.save")}
                </button>
              </div>
              <p
                id="custom-user-agent-error"
                className={`settings-validation${customUserAgentError ? " visible" : ""}`}
                role={customUserAgentError ? "alert" : undefined}
              >
                {customUserAgentError ?? "\u00a0"}
              </p>
            </section>
          </div>
        ) : activeTab === "appearance" ? (
          <div id="settings-appearance-panel" className="settings-panel" role="tabpanel" aria-labelledby="settings-appearance-tab">
            <section className="settings-section" aria-labelledby="appearance-theme-title">
              <h3 id="appearance-theme-title">{t("settings.appearance")}</h3>
              <div className="settings-theme-field">
                <span>{t("settings.theme")}</span>
                <div className="settings-theme-choices" role="group" aria-label={t("settings.theme")}>
                  {(["light", "dark", "system"] as const).map((option) => (
                    <button key={option} type="button" aria-pressed={theme === option}
                      onClick={(event) => onThemeChange(option, event.currentTarget)}>
                      <SettingsThemeIcon theme={option} />
                      <span>{t(option === "light" ? "settings.themeLight" : option === "dark" ? "settings.themeDark" : "settings.themeSystem")}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-accent-row">
                <span>{t("settings.accentColor")}</span>
                <div className="settings-accent-options" role="group" aria-label={t("settings.accentColor")}>
                  {(["blue", "purple", "cyan", "green", "orange", "pink"] as const).map((color) => (
                    <button key={color} type="button" className="settings-accent-swatch" data-color={color}
                      aria-label={t(`settings.accent.${color}`)} aria-pressed={downloadSettings.accentColor === color}
                      onClick={() => { void onDownloadSettingsChange({ accentColor: color }); }} />
                  ))}
                </div>
              </div>
              <label className="settings-switch-row">
                <span>{t("settings.showThumbnails")}</span>
                <SettingsSwitch role="switch" checked={downloadSettings.showThumbnails}
                  onChange={(checked) => { void onDownloadSettingsChange({ showThumbnails: checked }); }} />
              </label>
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
            <section className="about-update" aria-labelledby="about-update-title">
              <div className="about-update-heading">
                <h3 id="about-update-title">{t("updates.title")}</h3>
                <button
                  type="button"
                  className="secondary about-update-check"
                  disabled={updateCheck.status === "checking"}
                  onClick={onCheckForUpdates}
                >
                  {updateCheck.status === "checking"
                    ? t("updates.checkingAction")
                    : t("updates.checkAction")}
                </button>
              </div>
              <p
                className="about-update-status"
                data-state={updateCheck.status}
                role="status"
                aria-live="polite"
              >
                {updateStatusText(updateCheck, t)}
              </p>
              {updateCheck.status === "available" && updateCheck.result ? (
                <button
                  type="button"
                  className="primary about-update-open"
                  onClick={() => onOpenExternalUrl(updateCheck.result!.releaseUrl)}
                >
                  {t("updates.openRelease")}
                </button>
              ) : null}
            </section>
            <section className="about-update component-updates" aria-labelledby="component-updates-title">
              <div className="about-update-heading">
                <h3 id="component-updates-title">{t("components.title")}</h3>
                <button
                  type="button"
                  className="secondary about-update-check"
                  disabled={componentUpdates.status === "checking" || componentUpdates.installingId !== null}
                  onClick={onCheckComponentUpdates}
                >
                  {componentUpdates.status === "checking" ? t("components.checkingAction") : t("components.checkAction")}
                </button>
              </div>
              {componentUpdates.status !== "ready" ? (
                <p className="about-update-status" role="status" aria-live="polite">
                  {componentUpdates.status === "checking" ? t("components.checking")
                    : componentUpdates.status === "error" ? t("components.checkError")
                      : t("components.notChecked")}
                </p>
              ) : (
                <ul className="component-update-list">
                  {componentUpdates.results.map((component) => (
                    <li key={component.id} className="component-update-row">
                      <div className="component-update-copy">
                        <strong>{componentNames[component.id]}</strong>
                        <span>{component.currentVersion
                          ? t("components.current", { version: component.currentVersion })
                          : t("components.missing")}</span>
                        <span>
                          {component.state === "unavailable" ? t("components.unavailable")
                            : component.state === "upToDate" ? t("components.upToDate")
                              : t("components.available", { latest: component.latestVersion ?? "" })}
                        </span>
                        {component.sourceUrl ? (
                          <a
                            className="component-update-source"
                            href={component.sourceUrl}
                            onClick={(event) => openExternalLink(event, component.sourceUrl!, onOpenExternalUrl)}
                          >
                            {t("components.releasePage")}
                          </a>
                        ) : null}
                        {componentUpdates.installErrorId === component.id ? (
                          <span className="component-update-error" role="alert">{t("components.installError")}</span>
                        ) : null}
                      </div>
                      {component.state === "available" ? (
                        <button
                          type="button"
                          className="secondary component-update-install"
                          disabled={componentUpdates.installingId !== null}
                          onClick={() => onInstallComponentUpdate(component.id)}
                        >
                          {componentUpdates.installingId === component.id ? t("components.installing") : t("components.install")}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
          </div>
        </div>
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

function RetryNumberField({
  label,
  description,
  max,
  value,
  onChange,
}: {
  label: string;
  description: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const tooltipId = useId();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    const normalized = Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : value;
    setDraft(String(normalized));
    if (normalized !== value) onChange(normalized);
  };

  return (
    <label className="settings-field settings-retry-field">
      <span className="settings-retry-label-wrap">
        <span className="settings-retry-label" tabIndex={0} aria-describedby={tooltipId}>
          {label}
        </span>
        <span id={tooltipId} className="settings-retry-tooltip" role="tooltip">
          {description}
        </span>
      </span>
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function validateCustomUserAgent(value: string, required: boolean, t: Translate) {
  const normalized = value.trim();
  if (required && !normalized) return t("settings.userAgentRequired");
  if (normalized.length > 1024) return t("settings.userAgentTooLong");
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return t("settings.userAgentInvalid");
  return null;
}

function updateStatusText(updateCheck: UpdateCheckState, t: Translate) {
  switch (updateCheck.status) {
    case "checking":
      return t("updates.checking");
    case "upToDate":
      return t("updates.upToDate");
    case "available":
      return t("updates.available", {
        version: updateCheck.result?.latestVersion ?? "",
      });
    case "error":
      return t("updates.error");
    default:
      return t("updates.notChecked");
  }
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

function SettingsSwitch({ checked, onChange, disabled = false, label, role }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  role?: "switch";
}) {
  return (
    <span className="settings-switch-control">
      <input type="checkbox" role={role} aria-label={label} checked={checked} disabled={disabled}
        onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-switch-track" aria-hidden="true" />
    </span>
  );
}

function SettingsIcon() {
  return (
    <svg className="outline-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h7m4 0h7M3 12h3m4 0h11M3 19h11m4 0h3" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="19" r="2" />
    </svg>
  );
}

function SettingsCategoryIcon({ kind }: { kind: SettingsTab }) {
  if (kind === "main") return <SettingsIcon />;
  if (kind === "appearance") return (
    <svg className="outline-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 1 0 0 18h1.4a2.2 2.2 0 0 0 1.7-3.6 2.2 2.2 0 0 1 1.7-3.6H19a2 2 0 0 0 2-2A9 9 0 0 0 12 3Z" />
      <circle cx="7.5" cy="12" r=".8" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="8" r=".8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="7.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10.5" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
  const paths: Record<Exclude<SettingsTab, "main" | "appearance">, string> = {
    downloads: "M12 3v11m0 0 4-4m-4 4-4-4M4 17v3h16v-3",
    network: "M3 12h18M12 3a16 16 0 0 1 0 18M12 3a16 16 0 0 0 0 18M12 3a9 9 0 0 0 0 18M3 12a9 9 0 0 1 18 0 9 9 0 0 1-18 0",
    authorization: "M5 10V7a7 7 0 0 1 14 0v3M4 10h16v11H4zM12 14v3",
    about: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-9h.01",
  };
  return <svg className="outline-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}

function SettingsThemeIcon({ theme }: { theme: ThemePreference }) {
  const path = theme === "light"
    ? "M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
    : theme === "dark"
      ? "M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"
      : "M3 5h18v12H3zM8 21h8m-4-4v4";
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
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
