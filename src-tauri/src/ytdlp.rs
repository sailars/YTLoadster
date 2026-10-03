use crate::tools::{discover_tools, ToolConfig, ToolInventory, ToolState};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

const ANALYSIS_TIMEOUT: Duration = Duration::from_secs(60);
const ANALYSIS_TIMEOUT_CODE: &str = "analysis-error:timeout";
const ANALYSIS_CANCELLED_CODE: &str = "analysis-error:cancelled";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AnalysisScope {
    Single,
    Playlist,
}

#[derive(Default)]
struct AnalysisSession {
    id: String,
    processes: HashMap<String, u32>,
}

#[derive(Default)]
pub struct AnalysisProcessManager {
    sessions: Mutex<HashMap<AnalysisScope, AnalysisSession>>,
}

impl AnalysisProcessManager {
    fn begin_session(&self, scope: AnalysisScope, session_id: &str) {
        let stale_processes = {
            let mut sessions = self
                .sessions
                .lock()
                .expect("analysis process mutex poisoned");
            if sessions
                .get(&scope)
                .is_some_and(|session| session.id == session_id)
            {
                return;
            }
            let stale = sessions
                .remove(&scope)
                .map(|session| session.processes.into_values().collect::<HashSet<_>>())
                .unwrap_or_default();
            sessions.insert(
                scope,
                AnalysisSession {
                    id: session_id.to_string(),
                    processes: HashMap::new(),
                },
            );
            stale
        };
        terminate_analysis_processes(stale_processes);
    }

    fn register_process(
        &self,
        scope: AnalysisScope,
        session_id: &str,
        request_id: &str,
        pid: u32,
    ) -> Result<(), String> {
        let replaced = {
            let mut sessions = self
                .sessions
                .lock()
                .expect("analysis process mutex poisoned");
            let Some(session) = sessions.get_mut(&scope) else {
                return Err(ANALYSIS_CANCELLED_CODE.to_string());
            };
            if session.id != session_id {
                return Err(ANALYSIS_CANCELLED_CODE.to_string());
            }
            session.processes.insert(request_id.to_string(), pid)
        };
        if let Some(replaced) = replaced.filter(|replaced| *replaced != pid) {
            terminate_analysis_process_tree(replaced);
        }
        Ok(())
    }

    fn unregister_process(
        &self,
        scope: AnalysisScope,
        session_id: &str,
        request_id: &str,
        pid: u32,
    ) {
        let mut sessions = self
            .sessions
            .lock()
            .expect("analysis process mutex poisoned");
        let Some(session) = sessions.get_mut(&scope) else {
            return;
        };
        if session.id == session_id && session.processes.get(request_id).copied() == Some(pid) {
            session.processes.remove(request_id);
        }
    }

    fn cancel_session(&self, scope: AnalysisScope, session_id: &str) {
        let processes = {
            let mut sessions = self
                .sessions
                .lock()
                .expect("analysis process mutex poisoned");
            if !sessions
                .get(&scope)
                .is_some_and(|session| session.id == session_id)
            {
                return;
            }
            sessions
                .remove(&scope)
                .map(|session| session.processes.into_values().collect::<HashSet<_>>())
                .unwrap_or_default()
        };
        terminate_analysis_processes(processes);
    }
}

#[derive(Clone, Default)]
pub struct YtdlpRuntimeSettings {
    custom_user_agent: Arc<Mutex<Option<String>>>,
    proxy_url: Arc<Mutex<Option<String>>>,
}

impl YtdlpRuntimeSettings {
    pub fn new(custom_user_agent: Option<String>, proxy_url: Option<String>) -> Self {
        Self {
            custom_user_agent: Arc::new(Mutex::new(custom_user_agent)),
            proxy_url: Arc::new(Mutex::new(proxy_url)),
        }
    }

    pub fn custom_user_agent(&self) -> Option<String> {
        self.custom_user_agent
            .lock()
            .expect("yt-dlp runtime settings mutex poisoned")
            .clone()
    }

    pub fn set_custom_user_agent(&self, custom_user_agent: Option<String>) {
        *self
            .custom_user_agent
            .lock()
            .expect("yt-dlp runtime settings mutex poisoned") = custom_user_agent;
    }

    pub fn proxy_url(&self) -> Option<String> {
        self.proxy_url
            .lock()
            .expect("yt-dlp runtime settings mutex poisoned")
            .clone()
    }

    pub fn set_proxy_url(&self, proxy_url: Option<String>) {
        *self
            .proxy_url
            .lock()
            .expect("yt-dlp runtime settings mutex poisoned") = proxy_url;
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub uploader: Option<String>,
    pub original_language: Option<String>,
    pub duration: Option<u64>,
    pub webpage_url: Option<String>,
    pub thumbnail: Option<String>,
    pub description: Option<String>,
    pub upload_date: Option<String>,
    pub view_count: Option<u64>,
    pub video_formats: Vec<FormatOption>,
    pub audio_formats: Vec<FormatOption>,
    pub subtitles: Vec<SubtitleOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleOption {
    pub language: String,
    pub name: String,
    pub formats: Vec<String>,
    pub automatic: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub format_id: String,
    pub quality_label: String,
    pub kind: FormatKind,
    pub ext: Option<String>,
    pub codec: Option<String>,
    pub filesize: Option<u64>,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub fps: Option<u64>,
    pub dynamic_range: Option<String>,
    pub audio_channels: Option<u8>,
    pub bitrate_kbps: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormatKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistInfo {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub webpage_url: Option<String>,
    pub thumbnail: Option<String>,
    pub total_duration: Option<u64>,
    pub entries: Vec<PlaylistEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub id: String,
    pub index: usize,
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<u64>,
    pub availability: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaylistItemState {
    Ready,
    RequiresAuth,
    Unavailable,
    TemporaryError,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProbeIssueCode {
    AuthenticationRequired,
    AgeRestricted,
    PrivateVideo,
    RemovedVideo,
    MembershipRequired,
    GeoRestricted,
    Forbidden,
    RateLimited,
    Network,
    MissingTool,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeIssue {
    pub code: ProbeIssueCode,
    pub message: String,
    pub retryable: bool,
    pub requires_auth: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItemAnalysis {
    pub entry_id: String,
    pub state: PlaylistItemState,
    pub media: Option<MediaInfo>,
    pub issue: Option<ProbeIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadPreset {
    BestVideo,
    Mp4Video,
    AudioMp3,
    AudioM4a,
    AudioOpus,
    Subtitles,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VideoDownloadProfile {
    Best,
    Mp4_1080,
    Mp4_720,
    Mp4_480,
    Mp4_360,
    Universal,
    #[serde(alias = "phone-tablet")]
    Phone,
    #[serde(alias = "iphone-ipad", alias = "android")]
    Tablet,
    SmartTv,
    Legacy,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleSelection {
    pub language: String,
    pub format: String,
    pub automatic: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTechnicalDetails {
    pub height: Option<u64>,
    pub fps: Option<u64>,
    pub codec: Option<String>,
    pub dynamic_range: Option<String>,
    pub requested_container: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum CookieSource {
    File(PathBuf),
    Browser {
        browser: String,
        profile: Option<String>,
    },
    YoutubeSession,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    #[serde(default)]
    pub canonical_source: Option<String>,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub preset: DownloadPreset,
    pub format_id: Option<String>,
    #[serde(default)]
    pub audio_format_id: Option<String>,
    #[serde(default)]
    pub video_profile: Option<VideoDownloadProfile>,
    pub format_label: Option<String>,
    #[serde(default)]
    pub include_video_technical_details_in_filename: bool,
    #[serde(default)]
    pub video_technical_details: Option<VideoTechnicalDetails>,
    pub destination_dir: PathBuf,
    pub cookie_source: Option<CookieSource>,
    pub audio_bitrate: Option<String>,
    pub audio_channels: Option<String>,
    pub embed_metadata: Option<bool>,
    pub embed_thumbnail: Option<bool>,
    pub subtitle: Option<SubtitleSelection>,
}

#[derive(Debug)]
pub enum YtdlpError {
    Json(String),
    MissingTool(String),
    Process(String),
}

impl std::fmt::Display for YtdlpError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Json(message) | Self::MissingTool(message) | Self::Process(message) => {
                formatter.write_str(message)
            }
        }
    }
}

impl std::error::Error for YtdlpError {}

#[derive(Debug, Deserialize)]
struct RawMediaInfo {
    title: Option<String>,
    uploader: Option<String>,
    language: Option<String>,
    duration: Option<u64>,
    webpage_url: Option<String>,
    thumbnail: Option<String>,
    description: Option<String>,
    upload_date: Option<String>,
    view_count: Option<u64>,
    formats: Option<Vec<RawFormat>>,
    subtitles: Option<HashMap<String, Vec<RawSubtitleFormat>>>,
    automatic_captions: Option<HashMap<String, Vec<RawSubtitleFormat>>>,
}

#[derive(Debug, Deserialize)]
struct RawSubtitleFormat {
    ext: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawFormat {
    format_id: Option<String>,
    ext: Option<String>,
    width: Option<u64>,
    height: Option<u64>,
    fps: Option<f64>,
    vcodec: Option<String>,
    acodec: Option<String>,
    abr: Option<f64>,
    tbr: Option<f64>,
    vbr: Option<f64>,
    filesize: Option<u64>,
    filesize_approx: Option<u64>,
    dynamic_range: Option<String>,
    format_note: Option<String>,
    audio_channels: Option<u8>,
}

#[derive(Debug, Deserialize)]
struct RawPlaylistInfo {
    id: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    webpage_url: Option<String>,
    thumbnail: Option<String>,
    entries: Option<Vec<Option<RawPlaylistEntry>>>,
}

#[derive(Debug, Deserialize)]
struct RawPlaylistEntry {
    id: Option<String>,
    url: Option<String>,
    webpage_url: Option<String>,
    title: Option<String>,
    thumbnail: Option<String>,
    duration: Option<u64>,
    playlist_index: Option<usize>,
    availability: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum ProbeMode {
    Single,
    Playlist,
}

#[derive(Debug)]
struct ProbeFailure {
    message: String,
    browser: Option<String>,
    missing_tool: bool,
}

impl ProbeFailure {
    fn user_message(&self) -> String {
        if self.missing_tool {
            return "Не удалось запустить загрузку. Проверьте целостность установки программы."
                .to_string();
        }
        humanize_ytdlp_error_for_browser(&self.message, self.browser.as_deref())
    }
}

#[tauri::command]
pub async fn probe_url(
    url: String,
    cookie_source: Option<CookieSource>,
    analysis_id: String,
    app: tauri::AppHandle,
    runtime_settings: tauri::State<'_, YtdlpRuntimeSettings>,
    analysis_manager: tauri::State<'_, AnalysisProcessManager>,
) -> Result<MediaInfo, String> {
    analysis_manager.begin_session(AnalysisScope::Single, &analysis_id);
    let json = run_json_probe(
        url,
        cookie_source,
        runtime_settings.custom_user_agent(),
        runtime_settings.proxy_url(),
        &app,
        ProbeMode::Single,
        &analysis_manager,
        AnalysisScope::Single,
        &analysis_id,
        "single",
    )
    .await
    .map_err(|error| error.user_message())?;
    parse_media_info(&json).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn probe_playlist(
    url: String,
    cookie_source: Option<CookieSource>,
    analysis_id: String,
    app: tauri::AppHandle,
    runtime_settings: tauri::State<'_, YtdlpRuntimeSettings>,
    analysis_manager: tauri::State<'_, AnalysisProcessManager>,
) -> Result<PlaylistInfo, String> {
    analysis_manager.begin_session(AnalysisScope::Playlist, &analysis_id);
    let json = run_json_probe(
        url,
        cookie_source,
        runtime_settings.custom_user_agent(),
        runtime_settings.proxy_url(),
        &app,
        ProbeMode::Playlist,
        &analysis_manager,
        AnalysisScope::Playlist,
        &analysis_id,
        "playlist",
    )
    .await
    .map_err(|error| error.user_message())?;
    parse_playlist_info(&json).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn probe_playlist_item(
    entry_id: String,
    url: String,
    cookie_source: Option<CookieSource>,
    analysis_id: String,
    request_id: String,
    app: tauri::AppHandle,
    runtime_settings: tauri::State<'_, YtdlpRuntimeSettings>,
    analysis_manager: tauri::State<'_, AnalysisProcessManager>,
) -> Result<PlaylistItemAnalysis, String> {
    Ok(
        match run_json_probe(
            url,
            cookie_source,
            runtime_settings.custom_user_agent(),
            runtime_settings.proxy_url(),
            &app,
            ProbeMode::Single,
            &analysis_manager,
            AnalysisScope::Playlist,
            &analysis_id,
            &request_id,
        )
        .await
        {
            Ok(json) => match parse_media_info(&json) {
                Ok(media) => PlaylistItemAnalysis {
                    entry_id,
                    state: PlaylistItemState::Ready,
                    media: Some(media),
                    issue: None,
                },
                Err(error) => {
                    let failure = ProbeFailure {
                        message: error.to_string(),
                        browser: None,
                        missing_tool: false,
                    };
                    failed_playlist_item(entry_id, failure)
                }
            },
            Err(error) => failed_playlist_item(entry_id, error),
        },
    )
}

#[tauri::command]
pub fn begin_playlist_analysis(
    analysis_id: String,
    analysis_manager: tauri::State<'_, AnalysisProcessManager>,
) {
    analysis_manager.begin_session(AnalysisScope::Playlist, &analysis_id);
}

#[tauri::command]
pub fn cancel_url_analysis(
    analysis_id: String,
    analysis_manager: tauri::State<'_, AnalysisProcessManager>,
) {
    analysis_manager.cancel_session(AnalysisScope::Single, &analysis_id);
}

#[tauri::command]
pub fn cancel_playlist_analysis(
    analysis_id: String,
    analysis_manager: tauri::State<'_, AnalysisProcessManager>,
) {
    analysis_manager.cancel_session(AnalysisScope::Playlist, &analysis_id);
}

async fn run_json_probe(
    url: String,
    cookie_source: Option<CookieSource>,
    custom_user_agent: Option<String>,
    proxy_url: Option<String>,
    app: &tauri::AppHandle,
    mode: ProbeMode,
    analysis_manager: &AnalysisProcessManager,
    analysis_scope: AnalysisScope,
    analysis_id: &str,
    request_id: &str,
) -> Result<String, ProbeFailure> {
    let materialized_cookies = if matches!(&cookie_source, Some(CookieSource::YoutubeSession)) {
        Some(
            crate::auth::materialize_youtube_cookies(app)
                .await
                .map_err(|message| ProbeFailure {
                    message,
                    browser: None,
                    missing_tool: false,
                })?,
        )
    } else {
        None
    };
    let effective_cookie_source = materialized_cookies
        .as_ref()
        .map(|cookies| CookieSource::File(cookies.path().to_path_buf()))
        .or(cookie_source);
    let browser = cookie_browser_name(effective_cookie_source.as_ref()).map(str::to_string);
    let inventory = discover_tools(
        ToolConfig::default(),
        crate::tools::ToolEnvironment::current_for_app(app),
    );
    let ytdlp_path = inventory
        .ytdlp
        .path
        .as_ref()
        .filter(|_| inventory.ytdlp.state == ToolState::Found)
        .ok_or_else(|| ProbeFailure {
            message: String::new(),
            browser: browser.clone(),
            missing_tool: true,
        })?;
    let mut args = vec![
        "--encoding".to_string(),
        "utf-8".to_string(),
        "--socket-timeout".to_string(),
        "20".to_string(),
        "-J".to_string(),
    ];
    match mode {
        ProbeMode::Single => args.push("--no-playlist".to_string()),
        ProbeMode::Playlist => {
            args.push("--flat-playlist".to_string());
            args.push("--ignore-errors".to_string());
        }
    }
    append_js_runtime_args(&mut args, &inventory);
    append_cookie_args(&mut args, effective_cookie_source.as_ref());
    append_custom_user_agent_args(&mut args, custom_user_agent.as_deref());
    crate::proxy::add_config_args(&mut args, proxy_url.as_deref());
    args.push(url);

    let mut process = Command::new(ytdlp_path);
    process
        .args(&args)
        .envs(ytdlp_process_env())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if proxy_url.is_some() {
        process.stdin(std::process::Stdio::piped());
    }
    configure_analysis_process_group(&mut process);
    hide_windows_console(&mut process);

    let mut child = process.spawn().map_err(|error| ProbeFailure {
        message: error.to_string(),
        browser: browser.clone(),
        missing_tool: false,
    })?;
    let pid = child.id().ok_or_else(|| ProbeFailure {
        message: "analysis-error:process-id-unavailable".to_string(),
        browser: browser.clone(),
        missing_tool: false,
    })?;
    if let Err(message) =
        analysis_manager.register_process(analysis_scope, analysis_id, request_id, pid)
    {
        terminate_analysis_process_tree(pid);
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Err(ProbeFailure {
            message,
            browser,
            missing_tool: false,
        });
    }
    if let Err(message) = crate::proxy::write_config(&mut child, proxy_url.as_deref()).await {
        analysis_manager.unregister_process(analysis_scope, analysis_id, request_id, pid);
        terminate_analysis_process_tree(pid);
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Err(ProbeFailure {
            message,
            browser,
            missing_tool: false,
        });
    }
    let output = collect_probe_output(child, ANALYSIS_TIMEOUT).await;
    analysis_manager.unregister_process(analysis_scope, analysis_id, request_id, pid);
    let output = output.map_err(|message| ProbeFailure {
        message,
        browser: browser.clone(),
        missing_tool: false,
    })?;
    if !output.status.success() {
        return Err(ProbeFailure {
            message: crate::proxy::redact_error(
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
                proxy_url.as_deref(),
            ),
            browser,
            missing_tool: false,
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[derive(Debug)]
struct ProbeProcessOutput {
    status: std::process::ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

async fn collect_probe_output(
    mut child: tokio::process::Child,
    timeout: Duration,
) -> Result<ProbeProcessOutput, String> {
    let stdout_task = child.stdout.take().map(|mut stdout| {
        tauri::async_runtime::spawn(async move {
            let mut output = Vec::new();
            stdout
                .read_to_end(&mut output)
                .await
                .map(|_| output)
                .map_err(|error| error.to_string())
        })
    });
    let stderr_task = child.stderr.take().map(|mut stderr| {
        tauri::async_runtime::spawn(async move {
            let mut output = Vec::new();
            stderr
                .read_to_end(&mut output)
                .await
                .map(|_| output)
                .map_err(|error| error.to_string())
        })
    });

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(result) => result.map_err(|error| error.to_string())?,
        Err(_) => {
            if let Some(pid) = child.id() {
                terminate_analysis_process_tree(pid);
            }
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            if let Some(task) = stdout_task {
                task.abort();
            }
            if let Some(task) = stderr_task {
                task.abort();
            }
            return Err(ANALYSIS_TIMEOUT_CODE.to_string());
        }
    };

    let stdout = collect_probe_stream(stdout_task).await?;
    let stderr = collect_probe_stream(stderr_task).await?;
    Ok(ProbeProcessOutput {
        status,
        stdout,
        stderr,
    })
}

async fn collect_probe_stream(
    task: Option<tauri::async_runtime::JoinHandle<Result<Vec<u8>, String>>>,
) -> Result<Vec<u8>, String> {
    match task {
        Some(task) => task
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string()),
        None => Ok(Vec::new()),
    }
}

fn configure_analysis_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }

    #[cfg(not(unix))]
    let _ = command;
}

fn terminate_analysis_processes(processes: impl IntoIterator<Item = u32>) {
    for pid in processes {
        terminate_analysis_process_tree(pid);
    }
}

fn terminate_analysis_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let mut process = std::process::Command::new("taskkill");
        process
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000);
        let _ = process.status();
    }

    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

fn failed_playlist_item(entry_id: String, failure: ProbeFailure) -> PlaylistItemAnalysis {
    let issue = classify_probe_issue(&failure);
    let state = if issue.requires_auth {
        PlaylistItemState::RequiresAuth
    } else if issue.retryable {
        PlaylistItemState::TemporaryError
    } else if matches!(
        issue.code,
        ProbeIssueCode::PrivateVideo
            | ProbeIssueCode::RemovedVideo
            | ProbeIssueCode::MembershipRequired
            | ProbeIssueCode::GeoRestricted
    ) {
        PlaylistItemState::Unavailable
    } else {
        PlaylistItemState::Error
    };
    PlaylistItemAnalysis {
        entry_id,
        state,
        media: None,
        issue: Some(issue),
    }
}

fn classify_probe_issue(failure: &ProbeFailure) -> ProbeIssue {
    let normalized = failure.message.to_ascii_lowercase();
    let (code, retryable, requires_auth) = if failure.missing_tool {
        (ProbeIssueCode::MissingTool, false, false)
    } else if normalized.contains("confirm your age") || normalized.contains("age-restricted") {
        (ProbeIssueCode::AgeRestricted, false, true)
    } else if normalized.contains("members-only")
        || normalized.contains("members only")
        || normalized.contains("join this channel")
        || normalized.contains("subscriber-only")
        || normalized.contains("premium-only")
    {
        (ProbeIssueCode::MembershipRequired, false, false)
    } else if normalized.contains("private video") || normalized.contains("this video is private") {
        (ProbeIssueCode::PrivateVideo, false, true)
    } else if normalized.contains("not available in your country")
        || normalized.contains("geo-restricted")
        || normalized.contains("geographic restriction")
    {
        (ProbeIssueCode::GeoRestricted, false, false)
    } else if normalized.contains("video unavailable")
        || normalized.contains("has been removed")
        || normalized.contains("deleted video")
    {
        (ProbeIssueCode::RemovedVideo, false, false)
    } else if normalized.contains("http error 429") || normalized.contains("too many requests") {
        (ProbeIssueCode::RateLimited, true, false)
    } else if normalized.contains("http error 403") || normalized.contains("403: forbidden") {
        (ProbeIssueCode::Forbidden, true, false)
    } else if normalized.contains("sign in")
        || normalized.contains("login required")
        || normalized.contains("cookies")
        || normalized.contains("youtube-auth-session-unavailable")
    {
        (ProbeIssueCode::AuthenticationRequired, false, true)
    } else if normalized.contains(ANALYSIS_TIMEOUT_CODE)
        || normalized.contains("timed out")
        || normalized.contains("timeout")
        || normalized.contains("connection")
        || normalized.contains("network")
        || normalized.contains("name resolution")
        || normalized.contains("dns")
        || normalized.contains("youtube-auth-refresh-failed")
    {
        (ProbeIssueCode::Network, true, false)
    } else {
        (ProbeIssueCode::Unknown, false, false)
    };
    ProbeIssue {
        code,
        message: failure.user_message(),
        retryable,
        requires_auth,
    }
}

pub fn parse_playlist_info(json: &str) -> Result<PlaylistInfo, YtdlpError> {
    let raw: RawPlaylistInfo =
        serde_json::from_str(json).map_err(|error| YtdlpError::Json(error.to_string()))?;
    let entries = raw
        .entries
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(offset, entry)| {
            let id = entry.id.clone().or_else(|| entry.url.clone())?;
            let url = playlist_entry_url(entry.webpage_url.or(entry.url), &id);
            Some(PlaylistEntry {
                id: id.clone(),
                index: entry.playlist_index.unwrap_or(offset + 1),
                url,
                title: entry
                    .title
                    .unwrap_or_else(|| format!("Видео {}", offset + 1)),
                thumbnail: entry.thumbnail,
                duration: entry.duration,
                availability: entry.availability,
            })
        })
        .collect::<Vec<_>>();
    let total_duration = entries
        .iter()
        .map(|entry| entry.duration)
        .collect::<Option<Vec<_>>>()
        .map(|durations| durations.into_iter().sum());
    let thumbnail = raw
        .thumbnail
        .or_else(|| entries.iter().find_map(|entry| entry.thumbnail.clone()));
    Ok(PlaylistInfo {
        id: raw.id.unwrap_or_else(|| "playlist".to_string()),
        title: raw.title.unwrap_or_else(|| "YouTube playlist".to_string()),
        uploader: raw.uploader.or(raw.channel),
        webpage_url: raw.webpage_url,
        thumbnail,
        total_duration,
        entries,
    })
}

fn playlist_entry_url(candidate: Option<String>, id: &str) -> String {
    let candidate = candidate.unwrap_or_else(|| id.to_string());
    if candidate.starts_with("https://") || candidate.starts_with("http://") {
        candidate
    } else {
        format!("https://www.youtube.com/watch?v={candidate}")
    }
}

pub fn parse_media_info(json: &str) -> Result<MediaInfo, YtdlpError> {
    let mut raw: RawMediaInfo =
        serde_json::from_str(json).map_err(|err| YtdlpError::Json(err.to_string()))?;
    let mut video_formats = Vec::new();
    let mut audio_formats = Vec::new();

    for format in raw.formats.take().unwrap_or_default() {
        if let Some(option) = video_format_option(&format) {
            video_formats.push(option);
        }
        if let Some(option) = audio_format_option(&format) {
            audio_formats.push(option);
        }
    }

    let mut subtitles = subtitle_options(raw.subtitles.take(), false);
    subtitles.extend(subtitle_options(raw.automatic_captions.take(), true));

    Ok(MediaInfo {
        title: raw.title.unwrap_or_else(|| "Untitled video".to_string()),
        uploader: raw.uploader,
        original_language: raw.language,
        duration: raw.duration,
        webpage_url: raw.webpage_url,
        thumbnail: raw.thumbnail,
        description: raw.description,
        upload_date: raw.upload_date,
        view_count: raw.view_count,
        video_formats: unique_best_formats(video_formats),
        audio_formats: unique_best_formats(audio_formats),
        subtitles,
    })
}

pub fn humanize_ytdlp_error(message: &str) -> String {
    let normalized = message.to_ascii_lowercase();
    if normalized.contains(ANALYSIS_TIMEOUT_CODE) {
        return ANALYSIS_TIMEOUT_CODE.to_string();
    }
    if normalized.contains(ANALYSIS_CANCELLED_CODE) {
        return ANALYSIS_CANCELLED_CODE.to_string();
    }
    if normalized.contains("sign in to confirm your age")
        || normalized.contains("confirm your age to watch")
    {
        return "Для этого видео YouTube требует войти в аккаунт и подтвердить возраст. Откройте Настройки → Авторизация → Войти в YouTube, выполните вход и повторите попытку. Если вход уже выполнен, убедитесь, что возраст подтверждён в аккаунте.".to_string();
    }

    if normalized.contains("sign in to confirm you're not a bot")
        || normalized.contains("sign in to confirm you’re not a bot")
        || normalized.contains("sign in to confirm you are not a bot")
    {
        return "YouTube просит подтвердить, что вы не робот. Откройте Настройки → Авторизация → Войти в YouTube, выполните вход и повторите попытку.".to_string();
    }

    if normalized.contains("http error 429") || normalized.contains("429: too many requests") {
        return "YouTube временно ограничил количество запросов (ошибка 429). Подождите некоторое время и повторите попытку. Если ошибка возникла при загрузке субтитров, попробуйте выбрать другую дорожку или уменьшить количество одновременных загрузок.".to_string();
    }

    if normalized.contains("http error 403") || normalized.contains("403: forbidden") {
        return "YouTube временно отклонил запрос к видео (ошибка 403). Повторите загрузку чуть позже. Если ошибка повторяется, попробуйте уменьшить число одновременных загрузок или включить Настройки → Авторизация → Использовать вход из браузера.".to_string();
    }

    if normalized.contains("requested format is not available") {
        return "Выбранный поток больше недоступен у YouTube. Повторно проанализируйте ссылку и выберите другое качество или профиль.".to_string();
    }

    if normalized.contains("operation not permitted")
        && normalized.contains("safari")
        && normalized.contains("cookies")
    {
        return "macOS не разрешил программе прочитать cookies Safari. Выберите другой браузер для cookies или продолжите без входа; не отключайте защиту macOS ради этого.".to_string();
    }

    if normalized.contains("could not copy chrome cookie database") {
        return "Не удалось получить доступ к cookies выбранного браузера. Закройте ваш браузер и повторите попытку.".to_string();
    }

    if normalized.contains("failed to decrypt with dpapi")
        || (normalized.contains("dpapi") && normalized.contains("failed to decrypt"))
    {
        return "Не удалось расшифровать cookies выбранного Chromium-браузера через защиту Windows (DPAPI). Некоторые Chromium-браузеры дополнительно защищают cookies, и программа не может их прочитать. Это не ошибка YTLoadster. Используйте Firefox/LibreWolf для авторизации или используйте \"Войти в YouTube\".".to_string();
    }

    if normalized.contains("could not find")
        && normalized.contains("cookies database")
        && normalized.contains("cookies")
    {
        let browser = if normalized.contains("firefox") {
            "Firefox"
        } else if normalized.contains("edge") {
            "Edge"
        } else if normalized.contains("chrome") {
            "Chrome"
        } else {
            "выбранного браузера"
        };
        return format!(
            "Не удалось найти cookies {browser}. Проверьте, что браузер установлен, вы вошли в YouTube в этом браузере и он полностью закрыт перед загрузкой."
        );
    }

    hide_internal_tool_name(message.trim())
}

pub fn humanize_ytdlp_error_for_browser(message: &str, browser: Option<&str>) -> String {
    let normalized = message.to_ascii_lowercase();
    let base_message = humanize_ytdlp_error(message);
    if normalized.contains("could not copy chrome cookie database")
        && !matches!(
            browser.map(str::to_ascii_lowercase).as_deref(),
            Some("firefox" | "librewolf")
        )
    {
        return format!(
            "{base_message} Если ошибка останется, используйте другой браузер для входа (например, Firefox)."
        );
    }
    base_message
}

fn cookie_browser_name(cookie_source: Option<&CookieSource>) -> Option<&str> {
    match cookie_source {
        Some(CookieSource::Browser { browser, .. }) => Some(browser),
        _ => None,
    }
}

fn hide_internal_tool_name(message: &str) -> String {
    let relevant_message = message
        .rfind("ERROR:")
        .map(|index| &message[index..])
        .unwrap_or(message);
    let without_urls = relevant_message
        .split_whitespace()
        .filter(|part| !part.contains("http://") && !part.contains("https://"))
        .collect::<Vec<_>>()
        .join(" ");
    let cleaned = without_urls
        .replace("yt-dlp", "программа")
        .replace("YT-DLP", "программа")
        .replace("Yt-dlp", "программа")
        .replace("yt_dlp", "программа")
        .replace("YT_DLP", "программа")
        .replace("See for more info", "")
        .replace("See for details", "");
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn build_download_args(request: &DownloadRequest, tools: &ToolInventory) -> Vec<String> {
    build_download_args_with_template(request, tools, "title")
}

pub fn build_download_args_with_template(
    request: &DownloadRequest,
    tools: &ToolInventory,
    template: &str,
) -> Vec<String> {
    let mut args = vec![
        "--encoding".to_string(),
        "utf-8".to_string(),
        "--newline".to_string(),
        "--continue".to_string(),
        "--no-playlist".to_string(),
        "--progress-template".to_string(),
        "download:YTLOADSTER_PROGRESS|%(info.vcodec)s|%(info.acodec)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s".to_string(),
        "--paths".to_string(),
        format!("home:{}", request.destination_dir.to_string_lossy()),
        "-o".to_string(),
        filename_output_template(template).to_string(),
    ];

    if let Some(ffmpeg_path) = managed_ffmpeg_location(tools) {
        args.push("--ffmpeg-location".to_string());
        args.push(ffmpeg_path.to_string_lossy().to_string());
    }

    append_js_runtime_args(&mut args, tools);
    append_cookie_args(&mut args, request.cookie_source.as_ref());

    if matches!(request.preset, DownloadPreset::Subtitles) {
        append_subtitle_args(&mut args, request);
    } else if let Some(format_id) = &request.format_id {
        args.push("-f".to_string());
        args.push(selected_format_expression(
            format_id,
            request.audio_format_id.as_deref(),
            &request.preset,
        ));
        if matches!(request.preset, DownloadPreset::Mp4Video) {
            args.push("--merge-output-format".to_string());
            args.push("mp4".to_string());
        }
        if let Some(audio_format) = audio_format_for_preset(&request.preset) {
            append_audio_args(&mut args, audio_format);
        }
    } else {
        append_preset_args(&mut args, &request.preset);
    }
    append_audio_option_args(&mut args, request);

    args.push(request.url.clone());
    args
}

fn filename_output_template(template: &str) -> &'static str {
    match template {
        "title-id" => "%(title).170B [%(id|unknown)s].%(ext)s",
        "channel-title" => "%(channel,uploader&{} - |)s%(title).140B.%(ext)s",
        "date-title" => "%(upload_date>%Y-%m-%d&{} - |)s%(title).170B.%(ext)s",
        _ => "%(title).200B.%(ext)s",
    }
}

#[cfg(test)]
mod filename_template_tests {
    use super::filename_output_template;

    #[test]
    fn maps_supported_filename_modes_and_omits_missing_channel_or_date() {
        assert_eq!(filename_output_template("title"), "%(title).200B.%(ext)s");
        assert!(filename_output_template("title-id").contains("%(id|unknown)s"));
        assert!(filename_output_template("channel-title").contains("%(channel,uploader&{} - |)s"));
        assert!(filename_output_template("date-title").contains("%(upload_date>%Y-%m-%d&{} - |)s"));
        assert_eq!(
            filename_output_template("invalid"),
            filename_output_template("title")
        );
    }
}

pub fn ytdlp_process_env() -> Vec<(&'static str, &'static str)> {
    vec![("PYTHONIOENCODING", "utf-8"), ("PYTHONUTF8", "1")]
}

/// Returns an explicit executable path only when FFmpeg and FFprobe form a
/// single managed pair. yt-dlp then derives the sibling `ffprobe` path from
/// the `ffmpeg` executable instead of resolving an unrelated tool from PATH.
pub fn managed_ffmpeg_location(tools: &ToolInventory) -> Option<&Path> {
    let ffmpeg = tools.ffmpeg.path.as_deref()?;
    let ffprobe = tools.ffprobe.path.as_deref()?;
    (ffmpeg.parent() == ffprobe.parent()).then_some(ffmpeg)
}

/// Adds the discovered FFmpeg and FFprobe directories at the start of PATH
/// for the yt-dlp process. This is a fallback for post-processors that invoke
/// the tools by name rather than through `--ffmpeg-location`.
pub fn ytdlp_process_path(
    tools: &ToolInventory,
    inherited_path: Option<OsString>,
) -> Option<OsString> {
    let mut paths = Vec::new();
    for tool_path in [&tools.ffmpeg.path, &tools.ffprobe.path] {
        let parent = tool_path.as_deref()?.parent()?;
        if !paths.iter().any(|path: &PathBuf| path == parent) {
            paths.push(parent.to_path_buf());
        }
    }
    if let Some(inherited_path) = inherited_path {
        paths.extend(env::split_paths(&inherited_path));
    }
    env::join_paths(paths).ok()
}

pub fn hide_windows_console(command: &mut Command) {
    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000);

    #[cfg(not(target_os = "windows"))]
    let _ = command;
}

fn append_js_runtime_args(args: &mut Vec<String>, tools: &ToolInventory) {
    let Some(path) = tools.js_runtime.path.as_ref() else {
        return;
    };
    let Some(runtime) = js_runtime_name(&tools.js_runtime.name, path) else {
        return;
    };

    args.push("--js-runtimes".to_string());
    args.push(format!("{runtime}:{}", path.to_string_lossy()));
}

fn js_runtime_name(name: &str, path: &PathBuf) -> Option<&'static str> {
    let normalized_name = name.to_ascii_lowercase();
    if normalized_name.contains("deno") {
        return Some("deno");
    }
    if normalized_name.contains("node") {
        return Some("node");
    }

    let file_name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    if file_name.starts_with("deno") {
        Some("deno")
    } else if file_name.starts_with("node") {
        Some("node")
    } else {
        None
    }
}

fn selected_format_expression(
    format_id: &str,
    audio_format_id: Option<&str>,
    preset: &DownloadPreset,
) -> String {
    match preset {
        DownloadPreset::BestVideo | DownloadPreset::Mp4Video if format_id.contains('+') => {
            // Jobs created by older builds may already carry a complete
            // `video+audio` expression. Appending the selected audio stream
            // once more creates an invalid selector such as `137+140+140`.
            format_id.to_string()
        }
        DownloadPreset::BestVideo | DownloadPreset::Mp4Video => audio_format_id
            .map(|audio_format_id| format!("{format_id}+{audio_format_id}"))
            .unwrap_or_else(|| format!("{format_id}+ba/b")),
        DownloadPreset::AudioMp3 | DownloadPreset::AudioM4a | DownloadPreset::AudioOpus => {
            format_id.to_string()
        }
        DownloadPreset::Subtitles => format_id.to_string(),
    }
}

fn append_preset_args(args: &mut Vec<String>, preset: &DownloadPreset) {
    match preset {
        DownloadPreset::BestVideo => {
            args.push("-f".to_string());
            args.push("bv*+ba/b".to_string());
        }
        DownloadPreset::Mp4Video => {
            args.push("-f".to_string());
            args.push("bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b".to_string());
            args.push("--merge-output-format".to_string());
            args.push("mp4".to_string());
        }
        DownloadPreset::AudioMp3 => append_audio_args(args, "mp3"),
        DownloadPreset::AudioM4a => append_audio_args(args, "m4a"),
        DownloadPreset::AudioOpus => append_audio_args(args, "opus"),
        DownloadPreset::Subtitles => {}
    }
}

fn audio_format_for_preset(preset: &DownloadPreset) -> Option<&'static str> {
    match preset {
        DownloadPreset::AudioMp3 => Some("mp3"),
        DownloadPreset::AudioM4a => Some("m4a"),
        DownloadPreset::AudioOpus => Some("opus"),
        DownloadPreset::BestVideo | DownloadPreset::Mp4Video | DownloadPreset::Subtitles => None,
    }
}

fn append_subtitle_args(args: &mut Vec<String>, request: &DownloadRequest) {
    args.push("--skip-download".to_string());
    let Some(subtitle) = request.subtitle.as_ref() else {
        return;
    };

    args.push(if subtitle.automatic {
        "--write-auto-subs".to_string()
    } else {
        "--write-subs".to_string()
    });
    args.push("--sub-langs".to_string());
    args.push(subtitle.language.clone());
    args.push("--sub-format".to_string());
    args.push(subtitle.format.clone());
}

fn append_audio_args(args: &mut Vec<String>, format: &str) {
    args.push("--extract-audio".to_string());
    args.push("--audio-format".to_string());
    args.push(format.to_string());
}

fn append_audio_option_args(args: &mut Vec<String>, request: &DownloadRequest) {
    if !matches!(
        request.preset,
        DownloadPreset::AudioMp3 | DownloadPreset::AudioM4a | DownloadPreset::AudioOpus
    ) {
        return;
    }

    if let Some(bitrate) = request
        .audio_bitrate
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        args.push("--audio-quality".to_string());
        args.push(bitrate.to_string());
    }
    if request.embed_metadata.unwrap_or(false) {
        args.push("--embed-metadata".to_string());
    }
    if request.embed_thumbnail.unwrap_or(false) {
        args.push("--embed-thumbnail".to_string());
    }
    match request.audio_channels.as_deref() {
        Some("mono") => {
            args.push("--postprocessor-args".to_string());
            args.push("ffmpeg:-ac 1".to_string());
        }
        Some("stereo") => {
            args.push("--postprocessor-args".to_string());
            args.push("ffmpeg:-ac 2".to_string());
        }
        _ => {}
    }
}

fn append_cookie_args(args: &mut Vec<String>, cookie_source: Option<&CookieSource>) {
    match cookie_source {
        Some(CookieSource::File(path)) => {
            args.push("--cookies".to_string());
            args.push(path.to_string_lossy().to_string());
        }
        Some(CookieSource::Browser { browser, profile }) => {
            args.push("--cookies-from-browser".to_string());
            args.push(browser_cookie_argument(browser, profile.as_deref()));
        }
        Some(CookieSource::YoutubeSession) => {}
        None => {}
    }
}

pub(crate) fn append_custom_user_agent_args(
    args: &mut Vec<String>,
    custom_user_agent: Option<&str>,
) {
    let Some(custom_user_agent) = custom_user_agent.filter(|value| !value.is_empty()) else {
        return;
    };
    args.push("--user-agent".to_string());
    args.push(custom_user_agent.to_string());
}

fn browser_cookie_argument(browser: &str, profile: Option<&str>) -> String {
    if browser.eq_ignore_ascii_case("librewolf") {
        let profile = profile.map(str::to_string).or_else(|| {
            std::env::var_os("APPDATA").map(|app_data| {
                PathBuf::from(app_data)
                    .join("librewolf")
                    .join("Profiles")
                    .to_string_lossy()
                    .to_string()
            })
        });
        return profile
            .map(|profile| format!("firefox:{profile}"))
            .unwrap_or_else(|| "firefox".to_string());
    }

    profile
        .map(|profile| format!("{browser}:{profile}"))
        .unwrap_or_else(|| browser.to_string())
}

fn subtitle_options(
    tracks: Option<HashMap<String, Vec<RawSubtitleFormat>>>,
    automatic: bool,
) -> Vec<SubtitleOption> {
    let mut options = tracks
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(language, tracks)| {
            let name = tracks
                .iter()
                .find_map(|track| track.name.as_deref().filter(|name| !name.trim().is_empty()))
                .unwrap_or(&language)
                .to_string();
            let mut formats = tracks
                .into_iter()
                .filter_map(|track| track.ext)
                .filter(|ext| !ext.trim().is_empty())
                .collect::<Vec<_>>();
            formats.sort_by_key(|format| subtitle_format_priority(format));
            formats.dedup();
            (!formats.is_empty()).then_some(SubtitleOption {
                language,
                name,
                formats,
                automatic,
            })
        })
        .collect::<Vec<_>>();
    options.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.language.cmp(&right.language))
    });
    options
}

fn subtitle_format_priority(format: &str) -> (u8, String) {
    let normalized = format.to_ascii_lowercase();
    let priority = match normalized.as_str() {
        "srt" => 0,
        "vtt" => 1,
        "ass" => 2,
        "lrc" => 3,
        "ttml" => 4,
        _ => 5,
    };
    (priority, normalized)
}

fn video_format_option(format: &RawFormat) -> Option<FormatOption> {
    let height = format.height?;
    if format.vcodec.as_deref() == Some("none") {
        return None;
    }

    let ext = format.ext.clone();
    let fps = format.fps.map(|value| value.round() as u64);
    let dynamic_range = dynamic_range_label(format);
    let filesize = format.filesize.or(format.filesize_approx);
    let quality_label = video_quality_label(
        height,
        fps,
        ext.as_deref(),
        format.vcodec.as_deref(),
        dynamic_range.as_deref(),
        filesize,
    );

    Some(FormatOption {
        format_id: format.format_id.clone()?,
        quality_label,
        kind: FormatKind::Video,
        ext,
        codec: format.vcodec.clone(),
        filesize,
        width: format.width,
        height: Some(height),
        fps,
        dynamic_range,
        audio_channels: None,
        bitrate_kbps: format
            .vbr
            .or(format.tbr)
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(|value| value.round() as u64),
    })
}

fn audio_format_option(format: &RawFormat) -> Option<FormatOption> {
    if format.acodec.as_deref() == Some("none") || format.vcodec.as_deref() != Some("none") {
        return None;
    }

    let ext = format.ext.clone();
    let filesize = format.filesize.or(format.filesize_approx);
    let quality_label = audio_quality_label(
        format.abr,
        ext.as_deref(),
        format.acodec.as_deref(),
        filesize,
    );

    Some(FormatOption {
        format_id: format.format_id.clone()?,
        quality_label,
        kind: FormatKind::Audio,
        ext,
        codec: format.acodec.clone(),
        filesize,
        width: None,
        height: None,
        fps: None,
        dynamic_range: None,
        audio_channels: format.audio_channels,
        bitrate_kbps: format
            .abr
            .or(format.tbr)
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(|value| value.round() as u64),
    })
}

fn unique_best_formats(formats: Vec<FormatOption>) -> Vec<FormatOption> {
    let mut unique: HashMap<String, FormatOption> = HashMap::new();
    for format in formats {
        unique
            .entry(format_dedup_key(&format))
            .and_modify(|current| {
                if format_is_better(&format, current) {
                    *current = format.clone();
                }
            })
            .or_insert(format);
    }

    let mut formats = unique.into_values().collect::<Vec<_>>();
    formats.sort_by(|left, right| format_sort_score(right).cmp(&format_sort_score(left)));
    formats
}

fn format_dedup_key(format: &FormatOption) -> String {
    [
        format_kind_key(format.kind).to_string(),
        format
            .height
            .map(|value| value.to_string())
            .unwrap_or_default(),
        format
            .fps
            .map(|value| value.to_string())
            .unwrap_or_default(),
        format
            .ext
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        codec_family(format.codec.as_deref()).to_ascii_lowercase(),
        format
            .dynamic_range
            .as_deref()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        leading_number(&format.quality_label).to_string(),
    ]
    .join("|")
}

fn format_kind_key(kind: FormatKind) -> &'static str {
    match kind {
        FormatKind::Video => "video",
        FormatKind::Audio => "audio",
    }
}

fn video_quality_label(
    height: u64,
    fps: Option<u64>,
    ext: Option<&str>,
    codec: Option<&str>,
    dynamic_range: Option<&str>,
    filesize: Option<u64>,
) -> String {
    let mut parts = vec![format!("{height}p")];
    if let Some(fps) = fps {
        parts.push(format!("{fps}fps"));
    }
    if let Some(container) = container_label(ext) {
        parts.push(container);
    }
    if let Some(codec) = codec_label(codec) {
        parts.push(codec);
    }
    if dynamic_range == Some("HDR") {
        parts.push("HDR".to_string());
    }
    if let Some(size) = filesize_label(filesize) {
        parts.push(size);
    }
    parts.join(" ")
}

fn audio_quality_label(
    abr: Option<f64>,
    ext: Option<&str>,
    codec: Option<&str>,
    filesize: Option<u64>,
) -> String {
    let mut parts = Vec::new();
    if let Some(abr) = abr {
        parts.push(format!("{}kbps", format_number(abr)));
    }
    if let Some(container) = container_label(ext) {
        parts.push(container);
    }
    if let Some(codec) = codec_label(codec) {
        parts.push(codec);
    }
    if let Some(size) = filesize_label(filesize) {
        parts.push(size);
    }
    if parts.is_empty() {
        "audio".to_string()
    } else {
        parts.join(" ")
    }
}

fn container_label(ext: Option<&str>) -> Option<String> {
    let ext = ext?;
    let normalized = ext.to_ascii_lowercase();
    Some(match normalized.as_str() {
        "mp4" => "MP4".to_string(),
        "webm" => "WebM".to_string(),
        "m4a" => "M4A".to_string(),
        "opus" => "OPUS".to_string(),
        other => other.to_ascii_uppercase(),
    })
}

fn codec_label(codec: Option<&str>) -> Option<String> {
    let family = codec_family(codec);
    if family.is_empty() {
        None
    } else {
        Some(family)
    }
}

fn codec_family(codec: Option<&str>) -> String {
    let codec = codec.unwrap_or_default().to_ascii_lowercase();
    if codec.starts_with("av01") {
        "AV1".to_string()
    } else if codec.starts_with("avc") || codec.starts_with("h264") {
        "H.264".to_string()
    } else if codec.starts_with("vp09") || codec.starts_with("vp9") {
        "VP9".to_string()
    } else if codec.starts_with("vp8") {
        "VP8".to_string()
    } else if codec.starts_with("mp4a") || codec.starts_with("aac") {
        "AAC".to_string()
    } else if codec.starts_with("opus") {
        "Opus".to_string()
    } else if codec.starts_with("none") || codec.is_empty() {
        String::new()
    } else {
        codec
    }
}

fn dynamic_range_label(format: &RawFormat) -> Option<String> {
    let value = [
        format.dynamic_range.as_deref(),
        format.format_note.as_deref(),
        format.vcodec.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ")
    .to_ascii_lowercase();

    if value.contains("hdr")
        || value.contains("hlg")
        || value.contains("pq")
        || value.contains("dolby vision")
        || value.contains("dvh")
        || value.contains("vp9.2")
    {
        Some("HDR".to_string())
    } else {
        None
    }
}

fn filesize_label(filesize: Option<u64>) -> Option<String> {
    let filesize = filesize?;
    if filesize < 1_048_576 {
        return None;
    }
    Some(format!(
        "~{} МБ",
        ((filesize as f64) / 1_048_576.0).round() as u64
    ))
}

fn format_is_better(candidate: &FormatOption, current: &FormatOption) -> bool {
    format_sort_score(candidate) > format_sort_score(current)
}

fn format_sort_score(format: &FormatOption) -> (u64, u64, u64, u64, u64) {
    match format.kind {
        FormatKind::Video => (
            leading_number(&format.quality_label),
            fps_number(&format.quality_label),
            format.filesize.unwrap_or_default(),
            ext_rank(format.ext.as_deref()),
            codec_rank(format.codec.as_deref()),
        ),
        FormatKind::Audio => (
            leading_number(&format.quality_label),
            format.filesize.unwrap_or_default(),
            ext_rank(format.ext.as_deref()),
            codec_rank(format.codec.as_deref()),
            0,
        ),
    }
}

fn leading_number(value: &str) -> u64 {
    value
        .chars()
        .take_while(|char| char.is_ascii_digit())
        .collect::<String>()
        .parse()
        .unwrap_or_default()
}

fn fps_number(value: &str) -> u64 {
    value
        .split_whitespace()
        .find_map(|part| part.strip_suffix("fps"))
        .and_then(|part| part.parse::<u64>().ok())
        .unwrap_or_default()
}

fn ext_rank(ext: Option<&str>) -> u64 {
    match ext.unwrap_or_default().to_ascii_lowercase().as_str() {
        "mp4" | "m4a" => 4,
        "webm" | "opus" => 3,
        "mkv" => 2,
        _ => 1,
    }
}

fn codec_rank(codec: Option<&str>) -> u64 {
    let codec = codec.unwrap_or_default().to_ascii_lowercase();
    if codec.starts_with("av01") || codec.starts_with("opus") {
        4
    } else if codec.starts_with("vp9") || codec.starts_with("vp09") || codec.starts_with("mp4a") {
        3
    } else if codec.starts_with("avc") || codec.starts_with("h264") {
        2
    } else {
        1
    }
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.1}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;

    #[test]
    fn appends_custom_user_agent_only_when_configured() {
        let mut args = vec!["-J".to_string()];
        append_custom_user_agent_args(&mut args, None);
        assert_eq!(args, vec!["-J"]);

        append_custom_user_agent_args(&mut args, Some("Mozilla/5.0 TestBrowser/1.0"));
        assert_eq!(
            args,
            vec!["-J", "--user-agent", "Mozilla/5.0 TestBrowser/1.0"]
        );
    }
    use crate::tools::{ToolInventory, ToolState, ToolStatus};
    use std::path::PathBuf;

    #[tokio::test]
    async fn stops_a_probe_process_when_its_time_limit_expires() {
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = Command::new("cmd.exe");
            command.args(["/C", "ping -n 6 127.0.0.1 > nul"]);
            command
        };
        #[cfg(not(target_os = "windows"))]
        let mut command = {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "sleep 5"]);
            command
        };
        command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        configure_analysis_process_group(&mut command);
        hide_windows_console(&mut command);

        let child = command.spawn().unwrap();
        let result = collect_probe_output(child, Duration::from_millis(50)).await;

        assert_eq!(result.unwrap_err(), ANALYSIS_TIMEOUT_CODE);
    }

    #[test]
    fn classifies_the_analysis_time_limit_as_a_retryable_network_error() {
        let failure = ProbeFailure {
            message: ANALYSIS_TIMEOUT_CODE.to_string(),
            browser: None,
            missing_tool: false,
        };
        let issue = classify_probe_issue(&failure);

        assert_eq!(issue.code, ProbeIssueCode::Network);
        assert!(issue.retryable);
        assert!(!issue.requires_auth);
        assert_eq!(failure.user_message(), ANALYSIS_TIMEOUT_CODE);
    }

    #[test]
    fn replacing_one_analysis_section_keeps_the_other_section_active() {
        let manager = AnalysisProcessManager::default();
        manager.begin_session(AnalysisScope::Single, "single-old");
        manager.begin_session(AnalysisScope::Playlist, "playlist-current");
        manager.begin_session(AnalysisScope::Single, "single-new");

        let sessions = manager
            .sessions
            .lock()
            .expect("analysis process mutex poisoned");
        assert_eq!(sessions[&AnalysisScope::Single].id, "single-new");
        assert_eq!(sessions[&AnalysisScope::Playlist].id, "playlist-current");
    }

    #[test]
    fn deserializes_every_current_frontend_video_profile() {
        let cases = [
            ("best", VideoDownloadProfile::Best),
            ("mp4-1080", VideoDownloadProfile::Mp4_1080),
            ("mp4-720", VideoDownloadProfile::Mp4_720),
            ("mp4-480", VideoDownloadProfile::Mp4_480),
            ("mp4-360", VideoDownloadProfile::Mp4_360),
            ("universal", VideoDownloadProfile::Universal),
            ("phone", VideoDownloadProfile::Phone),
            ("tablet", VideoDownloadProfile::Tablet),
            ("smart-tv", VideoDownloadProfile::SmartTv),
            ("legacy", VideoDownloadProfile::Legacy),
            ("custom", VideoDownloadProfile::Custom),
        ];

        for (name, expected) in cases {
            let json = serde_json::to_string(name).unwrap();
            let profile: VideoDownloadProfile = serde_json::from_str(&json).unwrap();

            assert_eq!(profile, expected, "profile {name}");
            assert_eq!(serde_json::to_string(&profile).unwrap(), json);
        }
    }

    #[test]
    fn migrates_legacy_video_profile_names_to_current_values() {
        let cases = [
            ("phone-tablet", VideoDownloadProfile::Phone, "phone"),
            ("iphone-ipad", VideoDownloadProfile::Tablet, "tablet"),
            ("android", VideoDownloadProfile::Tablet, "tablet"),
        ];

        for (legacy_name, expected, current_name) in cases {
            let profile: VideoDownloadProfile =
                serde_json::from_str(&serde_json::to_string(legacy_name).unwrap()).unwrap();

            assert_eq!(profile, expected, "legacy profile {legacy_name}");
            assert_eq!(
                serde_json::to_string(&profile).unwrap(),
                serde_json::to_string(current_name).unwrap()
            );
        }
    }

    #[test]
    fn parses_available_video_and_audio_qualities() {
        let json = r#"{
          "title":"Example",
          "uploader":"Channel",
          "duration":120,
          "webpage_url":"https://youtube.com/watch?v=x",
          "thumbnail":"https://i.ytimg.com/x.jpg",
          "description":"Short description",
          "upload_date":"20240512",
          "view_count":852341,
          "formats":[
            {"format_id":"137","ext":"mp4","width":1920,"height":1080,"fps":30,"vcodec":"avc1","acodec":"none","filesize":1000},
            {"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a","abr":128,"audio_channels":1,"filesize":200}
          ]
        }"#;

        let media = parse_media_info(json).unwrap();

        assert_eq!(media.title, "Example");
        assert_eq!(media.uploader, Some("Channel".to_string()));
        assert_eq!(media.duration, Some(120));
        assert_eq!(media.description, Some("Short description".to_string()));
        assert_eq!(media.upload_date, Some("20240512".to_string()));
        assert_eq!(media.view_count, Some(852341));
        assert_eq!(
            media.video_formats[0].quality_label,
            "1080p 30fps MP4 H.264"
        );
        assert_eq!(media.video_formats[0].kind, FormatKind::Video);
        assert_eq!(media.video_formats[0].width, Some(1920));
        assert_eq!(media.video_formats[0].height, Some(1080));
        assert_eq!(media.video_formats[0].fps, Some(30));
        assert_eq!(media.audio_formats[0].quality_label, "128kbps M4A AAC");
        assert_eq!(media.audio_formats[0].kind, FormatKind::Audio);
        assert_eq!(media.audio_formats[0].audio_channels, Some(1));
    }

    #[test]
    fn parses_flat_playlist_with_unavailable_entries_and_missing_values() {
        let json = r#"{
          "id":"PL-test",
          "title":"Test playlist",
          "channel":"Test channel",
          "webpage_url":"https://youtube.com/playlist?list=PL-test",
          "entries":[
            {"id":"first","title":"First","duration":90,"playlist_index":1},
            {"id":"private","title":"Private video","availability":"private","playlist_index":2},
            null,
            {"url":"removed","availability":"needs_auth","playlist_index":4}
          ]
        }"#;

        let playlist = parse_playlist_info(json).unwrap();

        assert_eq!(playlist.id, "PL-test");
        assert_eq!(playlist.uploader, Some("Test channel".to_string()));
        assert_eq!(playlist.entries.len(), 3);
        assert_eq!(
            playlist.entries[0].url,
            "https://www.youtube.com/watch?v=first"
        );
        assert_eq!(playlist.entries[1].availability.as_deref(), Some("private"));
        assert_eq!(playlist.entries[2].index, 4);
        assert_eq!(playlist.entries[2].title, "Видео 3");
        assert_eq!(playlist.total_duration, None);
    }

    #[test]
    fn parses_an_empty_flat_playlist() {
        let playlist =
            parse_playlist_info(r#"{"id":"empty","title":"Empty","entries":[]}"#).unwrap();

        assert!(playlist.entries.is_empty());
        assert_eq!(playlist.total_duration, Some(0));
    }

    #[test]
    fn classifies_playlist_probe_failures_with_machine_codes() {
        let cases = [
            (
                "Sign in to confirm your age",
                ProbeIssueCode::AgeRestricted,
                false,
                true,
            ),
            (
                "This is a private video",
                ProbeIssueCode::PrivateVideo,
                false,
                true,
            ),
            (
                "This video has been removed",
                ProbeIssueCode::RemovedVideo,
                false,
                false,
            ),
            (
                "This is a members-only video",
                ProbeIssueCode::MembershipRequired,
                false,
                false,
            ),
            (
                "This video is not available in your country",
                ProbeIssueCode::GeoRestricted,
                false,
                false,
            ),
            (
                "HTTP Error 403: Forbidden",
                ProbeIssueCode::Forbidden,
                true,
                false,
            ),
            (
                "HTTP Error 429: Too Many Requests",
                ProbeIssueCode::RateLimited,
                true,
                false,
            ),
            ("Connection timed out", ProbeIssueCode::Network, true, false),
            (
                "youtube-auth-refresh-failed",
                ProbeIssueCode::Network,
                true,
                false,
            ),
            (
                "youtube-auth-session-unavailable",
                ProbeIssueCode::AuthenticationRequired,
                false,
                true,
            ),
            (
                "Unexpected extractor failure",
                ProbeIssueCode::Unknown,
                false,
                false,
            ),
        ];

        for (message, code, retryable, requires_auth) in cases {
            let issue = classify_probe_issue(&ProbeFailure {
                message: message.to_string(),
                browser: None,
                missing_tool: false,
            });
            assert_eq!(issue.code, code, "message: {message}");
            assert_eq!(issue.retryable, retryable, "message: {message}");
            assert_eq!(issue.requires_auth, requires_auth, "message: {message}");
        }

        let missing_tool = classify_probe_issue(&ProbeFailure {
            message: String::new(),
            browser: None,
            missing_tool: true,
        });
        assert_eq!(missing_tool.code, ProbeIssueCode::MissingTool);
    }

    #[test]
    fn treats_membership_restrictions_as_unavailable_instead_of_sign_in_required() {
        let result = failed_playlist_item(
            "member-item".to_string(),
            ProbeFailure {
                message: "This is a members-only video".to_string(),
                browser: None,
                missing_tool: false,
            },
        );

        assert_eq!(result.state, PlaylistItemState::Unavailable);
        assert_eq!(
            result.issue.map(|issue| issue.code),
            Some(ProbeIssueCode::MembershipRequired)
        );
    }

    #[test]
    fn parses_manual_and_automatic_subtitles() {
        let json = r#"{
          "title":"Subtitles",
          "formats":[],
          "subtitles":{
            "ru":[{"ext":"vtt","name":"Русский"},{"ext":"srt","name":"Русский"}]
          },
          "automatic_captions":{
            "en":[{"ext":"json3","name":"English"},{"ext":"vtt","name":"English"}]
          }
        }"#;

        let media = parse_media_info(json).unwrap();

        assert_eq!(
            media.subtitles,
            vec![
                SubtitleOption {
                    language: "ru".to_string(),
                    name: "Русский".to_string(),
                    formats: vec!["srt".to_string(), "vtt".to_string()],
                    automatic: false,
                },
                SubtitleOption {
                    language: "en".to_string(),
                    name: "English".to_string(),
                    formats: vec!["vtt".to_string(), "json3".to_string()],
                    automatic: true,
                },
            ]
        );
    }

    #[test]
    fn keeps_distinct_video_variants_visible_when_codec_container_or_hdr_differs() {
        let json = r#"{
          "title":"Variants",
          "formats":[
            {"format_id":"137","ext":"mp4","height":1080,"fps":30,"vcodec":"avc1.640028","acodec":"none","filesize":100000000},
            {"format_id":"248","ext":"webm","height":1080,"fps":30,"vcodec":"vp9","acodec":"none","filesize_approx":90000000},
            {"format_id":"337","ext":"webm","height":1080,"fps":30,"vcodec":"vp9.2","acodec":"none","dynamic_range":"HDR","filesize":110000000},
            {"format_id":"399","ext":"mp4","height":1080,"fps":30,"vcodec":"av01.0.08M.08","acodec":"none","filesize":80000000}
          ]
        }"#;

        let media = parse_media_info(json).unwrap();
        let labels = media
            .video_formats
            .iter()
            .map(|format| format.quality_label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(media.video_formats.len(), 4);
        assert!(labels.contains(&"1080p 30fps MP4 H.264 ~95 МБ"));
        assert!(labels.contains(&"1080p 30fps WebM VP9 ~86 МБ"));
        assert!(labels.contains(&"1080p 30fps WebM VP9 HDR ~105 МБ"));
        assert!(labels.contains(&"1080p 30fps MP4 AV1 ~76 МБ"));
        assert_eq!(media.video_formats[0].height, Some(1080));
        assert_eq!(media.video_formats[0].fps, Some(30));
    }

    #[test]
    fn parses_unique_best_visible_quality_options() {
        let json = r#"{
          "title":"Example",
          "formats":[
            {"format_id":"136","ext":"mp4","height":720,"fps":30,"vcodec":"avc1","acodec":"none","filesize":700},
            {"format_id":"137-low","ext":"mp4","height":1080,"fps":30,"vcodec":"avc1","acodec":"none","filesize":1000},
            {"format_id":"137-best","ext":"mp4","height":1080,"fps":30,"vcodec":"avc1","acodec":"none","filesize":1800},
            {"format_id":"251-low","ext":"webm","vcodec":"none","acodec":"opus","abr":160,"filesize":200},
            {"format_id":"251-best","ext":"webm","vcodec":"none","acodec":"opus","abr":160,"filesize":300}
          ]
        }"#;

        let media = parse_media_info(json).unwrap();

        assert_eq!(
            media
                .video_formats
                .iter()
                .map(|format| format.quality_label.as_str())
                .collect::<Vec<_>>(),
            vec!["1080p 30fps MP4 H.264", "720p 30fps MP4 H.264"]
        );
        assert_eq!(media.video_formats[0].format_id, "137-best");
        assert_eq!(media.audio_formats.len(), 1);
        assert_eq!(media.audio_formats[0].format_id, "251-best");
    }

    #[test]
    fn explains_missing_browser_cookies_in_russian() {
        let raw = "ERROR: could not find chrome cookies database in C:\\Users\\TestUser\\AppData";

        let message = humanize_ytdlp_error(raw);

        assert_eq!(
            message,
            "Не удалось найти cookies Chrome. Проверьте, что браузер установлен, вы вошли в YouTube в этом браузере и он полностью закрыт перед загрузкой."
        );
    }

    #[test]
    fn explains_dpapi_cookie_error_in_russian() {
        let raw = "ERROR: Failed to decrypt with DPAPI. See https://github.com/yt-dlp/yt-dlp/issues/10927 for more info";

        let message = humanize_ytdlp_error(raw);

        assert_eq!(
            message,
            "Не удалось расшифровать cookies выбранного Chromium-браузера через защиту Windows (DPAPI). Некоторые Chromium-браузеры дополнительно защищают cookies, и программа не может их прочитать. Это не ошибка YTLoadster. Используйте Firefox/LibreWolf для авторизации или используйте \"Войти в YouTube\"."
        );
    }

    #[test]
    fn explains_locked_chromium_cookies_in_russian() {
        let raw = "ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info";

        assert_eq!(
            humanize_ytdlp_error(raw),
            "Не удалось получить доступ к cookies выбранного браузера. Закройте ваш браузер и повторите попытку."
        );
    }

    #[test]
    fn suggests_another_browser_only_for_non_firefox_cookie_errors() {
        let raw = "ERROR: Could not copy Chrome cookie database";

        assert_eq!(
            humanize_ytdlp_error_for_browser(raw, Some("vivaldi")),
            "Не удалось получить доступ к cookies выбранного браузера. Закройте ваш браузер и повторите попытку. Если ошибка останется, используйте другой браузер для входа (например, Firefox)."
        );
        assert_eq!(
            humanize_ytdlp_error_for_browser(raw, Some("firefox")),
            "Не удалось получить доступ к cookies выбранного браузера. Закройте ваш браузер и повторите попытку."
        );
        assert_eq!(
            humanize_ytdlp_error_for_browser(raw, Some("librewolf")),
            "Не удалось получить доступ к cookies выбранного браузера. Закройте ваш браузер и повторите попытку."
        );
    }

    #[test]
    fn hides_internal_tool_name_in_unrecognized_errors() {
        assert_eq!(
            humanize_ytdlp_error("ERROR: yt-dlp failed unexpectedly"),
            "ERROR: программа failed unexpectedly"
        );
    }

    #[test]
    fn explains_http_429_and_hides_javascript_runtime_warning() {
        let raw = "WARNING: [youtube] No supported JavaScript runtime could be found. Only deno is enabled by default. See https://github.com/yt-dlp/yt-dlp/wiki/EJS for details ERROR: Unable to download video subtitles for 'ab': HTTP Error 429: Too Many Requests";

        assert_eq!(
            humanize_ytdlp_error(raw),
            "YouTube временно ограничил количество запросов (ошибка 429). Подождите некоторое время и повторите попытку. Если ошибка возникла при загрузке субтитров, попробуйте выбрать другую дорожку или уменьшить количество одновременных загрузок."
        );
    }

    #[test]
    fn explains_when_a_previously_analyzed_format_is_no_longer_available() {
        let raw = "ERROR: [youtube] test: Requested format is not available. Use --list-formats for a list of available formats";

        assert_eq!(
            humanize_ytdlp_error(raw),
            "Выбранный поток больше недоступен у YouTube. Повторно проанализируйте ссылку и выберите другое качество или профиль."
        );
    }

    #[test]
    fn explains_macos_safari_cookie_access_denial() {
        let raw = "ERROR: [Errno 1] Operation not permitted: '/Users/test/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies'";

        assert_eq!(
            humanize_ytdlp_error(raw),
            "macOS не разрешил программе прочитать cookies Safari. Выберите другой браузер для cookies или продолжите без входа; не отключайте защиту macOS ради этого."
        );
    }

    #[test]
    fn explains_age_restricted_video_in_russian() {
        let raw = "ERROR: [youtube] aZL8z5PDDWI: Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ for tips";

        assert_eq!(
            humanize_ytdlp_error(raw),
            "Для этого видео YouTube требует войти в аккаунт и подтвердить возраст. Откройте Настройки → Авторизация → Войти в YouTube, выполните вход и повторите попытку. Если вход уже выполнен, убедитесь, что возраст подтверждён в аккаунте."
        );
    }

    #[test]
    fn explains_youtube_bot_confirmation_in_russian() {
        let raw = "ERROR: [youtube] pe9e-3BME64: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.";

        assert_eq!(
            humanize_ytdlp_error(raw),
            "YouTube просит подтвердить, что вы не робот. Откройте Настройки → Авторизация → Войти в YouTube, выполните вход и повторите попытку."
        );
    }

    #[test]
    fn removes_internal_links_from_unrecognized_errors() {
        let raw = "WARNING: ignored ERROR: [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp/) failed unexpectedly. See https://github.com/yt-dlp/yt-dlp/wiki/EJS for details";
        let message = humanize_ytdlp_error(raw);

        assert_eq!(message, "ERROR: failed unexpectedly.");
        assert!(!message.contains("github.com"));
        assert!(!message.contains("программа/программа"));
    }

    #[test]
    fn maps_librewolf_profile_to_firefox_cookie_extractor() {
        assert_eq!(
            browser_cookie_argument(
                "librewolf",
                Some("C:/Users/TestUser/AppData/Roaming/librewolf/Profiles/default-release")
            ),
            "firefox:C:/Users/TestUser/AppData/Roaming/librewolf/Profiles/default-release"
        );
    }

    #[test]
    fn explains_http_403_in_russian() {
        let raw = "ERROR: unable to download video data: HTTP Error 403: Forbidden";

        let message = humanize_ytdlp_error(raw);

        assert_eq!(
            message,
            "YouTube временно отклонил запрос к видео (ошибка 403). Повторите загрузку чуть позже. Если ошибка повторяется, попробуйте уменьшить число одновременных загрузок или включить Настройки → Авторизация → Использовать вход из браузера."
        );
    }

    #[test]
    fn builds_mp3_download_args_with_ffmpeg_location_and_cookies_file() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::AudioMp3,
            format_id: None,
            audio_format_id: None,
            video_profile: None,
            format_label: None,
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: Some(CookieSource::File(PathBuf::from("C:/cookies.txt"))),
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);

        assert!(args.contains(&"--extract-audio".to_string()));
        assert!(args.contains(&"--audio-format".to_string()));
        assert!(args.contains(&"mp3".to_string()));
        assert!(args.contains(&"--cookies".to_string()));
        assert!(args.contains(&"C:/cookies.txt".to_string()));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--ffmpeg-location", "C:/app/ffmpeg.exe"]));
        assert_eq!(
            args.last(),
            Some(&"https://youtube.com/watch?v=x".to_string())
        );
    }

    #[test]
    fn builds_subtitle_only_download_args() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::Subtitles,
            format_id: None,
            audio_format_id: None,
            video_profile: None,
            format_label: Some("Русский (ru) • SRT".to_string()),
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: Some(SubtitleSelection {
                language: "ru".to_string(),
                format: "srt".to_string(),
                automatic: false,
            }),
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);

        assert!(args.contains(&"--skip-download".to_string()));
        assert!(args.contains(&"--write-subs".to_string()));
        assert!(!args.contains(&"--write-auto-subs".to_string()));
        assert!(args.windows(2).any(|pair| pair == ["--sub-langs", "ru"]));
        assert!(args.windows(2).any(|pair| pair == ["--sub-format", "srt"]));
        assert!(!args.contains(&"-f".to_string()));
    }

    #[test]
    fn builds_audio_download_args_with_requested_audio_options() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::AudioMp3,
            format_id: None,
            audio_format_id: None,
            video_profile: None,
            format_label: None,
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: Some("320K".to_string()),
            audio_channels: Some("stereo".to_string()),
            embed_metadata: Some(true),
            embed_thumbnail: Some(true),
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);

        assert!(args.contains(&"--audio-quality".to_string()));
        assert!(args.contains(&"320K".to_string()));
        assert!(args.contains(&"--embed-metadata".to_string()));
        assert!(args.contains(&"--embed-thumbnail".to_string()));
        assert!(args.contains(&"--postprocessor-args".to_string()));
        assert!(args.contains(&"ffmpeg:-ac 2".to_string()));
    }

    #[test]
    fn selected_audio_format_still_converts_to_requested_codec_before_thumbnail_embedding() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::AudioMp3,
            format_id: Some("251".to_string()),
            audio_format_id: None,
            video_profile: None,
            format_label: Some("139.5kbps WebM Opus".to_string()),
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: Some("320K".to_string()),
            audio_channels: Some("stereo".to_string()),
            embed_metadata: Some(true),
            embed_thumbnail: Some(true),
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);

        assert!(args.windows(2).any(|pair| pair == ["-f", "251"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--audio-format", "mp3"]));
        assert!(args.contains(&"--extract-audio".to_string()));
        assert!(args.contains(&"--embed-metadata".to_string()));
        assert!(args.contains(&"--embed-thumbnail".to_string()));
    }

    #[test]
    fn builds_selected_video_quality_with_best_audio_fallback() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::Mp4Video,
            format_id: Some("137".to_string()),
            audio_format_id: None,
            video_profile: None,
            format_label: None,
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);

        assert!(args.contains(&"-f".to_string()));
        assert!(args.contains(&"137+ba/b".to_string()));
        assert!(args.contains(&"--merge-output-format".to_string()));
        assert!(args.contains(&"mp4".to_string()));
    }

    #[test]
    fn builds_selected_video_with_the_exact_audio_stream() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::Mp4Video,
            format_id: Some("137".to_string()),
            audio_format_id: Some("140".to_string()),
            video_profile: Some(VideoDownloadProfile::Universal),
            format_label: None,
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };
        let args = build_download_args(&request, &tools);
        assert!(args.windows(2).any(|pair| pair == ["-f", "137+140"]));
        assert!(!args.iter().any(|argument| argument.contains("recode")));
    }

    #[test]
    fn preserves_a_complete_legacy_video_and_audio_selector() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::Mp4Video,
            format_id: Some("137+140".to_string()),
            audio_format_id: Some("140".to_string()),
            video_profile: Some(VideoDownloadProfile::Universal),
            format_label: None,
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);

        assert!(args.windows(2).any(|pair| pair == ["-f", "137+140"]));
        assert!(!args.iter().any(|argument| argument == "137+140+140"));
    }

    #[test]
    fn download_args_include_machine_readable_progress_template() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::BestVideo,
            format_id: None,
            audio_format_id: None,
            video_profile: None,
            format_label: None,
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);

        assert!(args.contains(&"--progress-template".to_string()));
        assert!(args.contains(
            &"download:YTLOADSTER_PROGRESS|%(info.vcodec)s|%(info.acodec)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s".to_string()
        ));
    }

    #[test]
    fn download_args_enable_discovered_javascript_runtime() {
        let mut tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        tools.js_runtime = found_tool("node", "C:/Program Files/nodejs/node.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::Mp4Video,
            format_id: Some("137".to_string()),
            audio_format_id: None,
            video_profile: None,
            format_label: None,
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);

        assert!(args.contains(&"--js-runtimes".to_string()));
        assert!(args.contains(&"node:C:/Program Files/nodejs/node.exe".to_string()));
    }

    #[test]
    fn ytdlp_environment_forces_utf8_output_on_windows() {
        let env = ytdlp_process_env();

        assert!(env.contains(&("PYTHONIOENCODING", "utf-8")));
        assert!(env.contains(&("PYTHONUTF8", "1")));
    }

    #[test]
    fn process_path_prioritizes_the_discovered_ffmpeg_pair() {
        let tools = inventory_with_ytdlp_and_ffmpeg("/app/yt-dlp", "/app/ffmpeg");
        let path = ytdlp_process_path(&tools, Some(OsString::from("/system/bin"))).unwrap();
        let paths = env::split_paths(&path).collect::<Vec<_>>();

        assert_eq!(paths.first(), Some(&PathBuf::from("/app")));
        assert!(paths.contains(&PathBuf::from("/system/bin")));
    }

    #[test]
    fn download_args_force_utf8_encoding() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::BestVideo,
            format_id: None,
            audio_format_id: None,
            video_profile: None,
            format_label: None,
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);

        assert!(args.windows(2).any(|pair| pair == ["--encoding", "utf-8"]));
    }

    #[test]
    fn download_args_save_files_without_video_id_suffix() {
        let tools = inventory_with_ytdlp_and_ffmpeg("C:/app/yt-dlp.exe", "C:/app/ffmpeg.exe");
        let request = DownloadRequest {
            url: "https://youtube.com/watch?v=x".to_string(),
            title: Some("Example".to_string()),
            thumbnail: None,
            preset: DownloadPreset::AudioM4a,
            format_id: Some("140".to_string()),
            audio_format_id: None,
            video_profile: None,
            format_label: None,
            destination_dir: PathBuf::from("C:/Downloads"),
            cookie_source: None,
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
            canonical_source: None,
            include_video_technical_details_in_filename: false,
            video_technical_details: None,
        };

        let args = build_download_args(&request, &tools);
        let output_template = args
            .windows(2)
            .find_map(|pair| (pair[0] == "-o").then_some(pair[1].as_str()))
            .unwrap();

        assert_eq!(output_template, "%(title).200B.%(ext)s");
        assert!(!output_template.contains("[%(id)s]"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--paths", "home:C:/Downloads"]));
    }

    fn inventory_with_ytdlp_and_ffmpeg(ytdlp: &str, ffmpeg: &str) -> ToolInventory {
        let ffmpeg_path = PathBuf::from(ffmpeg);
        let ffprobe_name = if ffmpeg_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
        {
            "ffprobe.exe"
        } else {
            "ffprobe"
        };
        let ffprobe_path = ffmpeg_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(ffprobe_name);

        ToolInventory {
            ytdlp: found_tool("yt-dlp", ytdlp),
            ffmpeg: found_tool("ffmpeg", ffmpeg),
            ffprobe: found_tool("ffprobe", ffprobe_path),
            js_runtime: found_tool("deno", "C:/app/deno.exe"),
        }
    }

    fn found_tool(name: &str, path: impl Into<PathBuf>) -> ToolStatus {
        ToolStatus {
            name: name.to_string(),
            path: Some(path.into()),
            state: ToolState::Found,
            version: None,
            setup_action: None,
        }
    }
}
