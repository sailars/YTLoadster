use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(target_os = "windows")]
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
#[cfg(target_os = "windows")]
use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use security_framework::os::macos::keychain::SecKeychain;
#[cfg(target_os = "windows")]
use windows::core::BOOL;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE,
};

const SESSION_FILE: &str = "youtube-session.bin";
const SESSION_METADATA_FILE: &str = "youtube-session.json";
const AUTH_PROFILE_DIRECTORY: &str = "youtube-auth-browser";
const WEBVIEW_AUTH_PROFILE_DIRECTORY: &str = "youtube-auth-webview2";
const WEBVIEW_AUTH_WINDOW_LABEL: &str = "youtube-auth-webview2";
const WEBVIEW_AUTH_BROWSER_NAME: &str = "WebView2";
const YOUTUBE_LOGIN_URL: &str = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";
#[cfg(target_os = "macos")]
const MACOS_KEYCHAIN_SERVICE: &str = "com.ytloadster.desktop.youtube-session";
#[cfg(target_os = "macos")]
const MACOS_KEYCHAIN_ACCOUNT: &str = "default";
static AUTH_ATTEMPT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeAuthStatus {
    pub supported: bool,
    pub authenticated: bool,
    pub browser: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeAuthStart {
    pub browser: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeAuthWindowState {
    pub open: bool,
    pub session_detected: bool,
    pub status: YoutubeAuthStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeWebviewAuthState {
    pub open: bool,
    pub authenticated: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCookie {
    name: String,
    value: String,
    domain: String,
    path: String,
    expires: f64,
    secure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMetadata {
    browser: String,
    saved_at: u64,
}

#[derive(Debug)]
struct ActiveAuth {
    browser_name: String,
    websocket_url: String,
    cookie_fingerprint: Option<[u8; 32]>,
    profile_dir: PathBuf,
    child: std::process::Child,
    window_seen: bool,
}

#[derive(Debug, Default)]
pub struct YoutubeAuthManager {
    active: Mutex<Option<ActiveAuth>>,
    refresh: tokio::sync::Mutex<()>,
    completed: AtomicBool,
}

impl YoutubeAuthManager {
    pub fn shutdown(&self) {
        self.completed.store(false, Ordering::Relaxed);
        if let Some(active) = self
            .active
            .lock()
            .expect("youtube auth mutex poisoned")
            .take()
        {
            stop_and_remove_auth_attempt(active);
        }
    }
}

#[derive(Debug, Clone)]
struct BrowserInstallation {
    id: &'static str,
    name: &'static str,
    executable: PathBuf,
}

pub struct TemporaryCookieFile {
    path: PathBuf,
}

impl TemporaryCookieFile {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TemporaryCookieFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[tauri::command]
pub fn get_youtube_auth_status(app: AppHandle) -> YoutubeAuthStatus {
    youtube_auth_status(&app)
}

#[tauri::command]
pub fn cancel_youtube_auth(
    app: AppHandle,
    manager: State<'_, YoutubeAuthManager>,
) -> YoutubeAuthStatus {
    manager.completed.store(false, Ordering::Relaxed);
    if let Some(active) = manager
        .active
        .lock()
        .expect("youtube auth mutex poisoned")
        .take()
    {
        stop_and_remove_auth_attempt(active);
    }
    youtube_auth_status(&app)
}

#[tauri::command]
pub async fn get_youtube_auth_window_state(
    app: AppHandle,
    manager: State<'_, YoutubeAuthManager>,
) -> Result<YoutubeAuthWindowState, String> {
    refresh_youtube_auth_session(&app, &manager).await
}

#[tauri::command]
pub async fn start_youtube_auth(
    preferred_browser: Option<String>,
    app: AppHandle,
    manager: State<'_, YoutubeAuthManager>,
) -> Result<YoutubeAuthStart, String> {
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (preferred_browser, app, manager);
        return Err(
            "Автоматический вход в YouTube пока поддерживается только в Windows.".to_string(),
        );
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        manager.completed.store(false, Ordering::Relaxed);
        let browser = choose_browser(preferred_browser.as_deref()).ok_or_else(|| {
            "Не найден поддерживаемый Chromium-браузер. Установите Edge, Chrome, Brave, Vivaldi или Opera и повторите попытку."
                .to_string()
        })?;
        let profile_dir = unique_auth_profile_dir(&auth_profile_root(&app)?, browser.id);
        fs::create_dir_all(&profile_dir).map_err(|error| {
            format!("Не удалось подготовить отдельный профиль браузера: {error}")
        })?;
        if let Some(previous) = manager
            .active
            .lock()
            .expect("youtube auth mutex poisoned")
            .take()
        {
            stop_and_remove_auth_attempt(previous);
        }

        let debugger_port = std::net::TcpListener::bind(("127.0.0.1", 0))
            .and_then(|listener| listener.local_addr().map(|address| address.port()))
            .map_err(|_| "youtube-auth-connection-failed".to_string())?;
        let mut command = auth_browser_command(&browser.executable, &profile_dir, debugger_port);
        command.arg(YOUTUBE_LOGIN_URL);
        let child = command
            .spawn()
            .map_err(|error| format!("Не удалось открыть {}: {error}", browser.name))?;

        let active = ActiveAuth {
            browser_name: browser.name.to_string(),
            websocket_url: String::new(),
            cookie_fingerprint: None,
            profile_dir,
            child,
            window_seen: false,
        };
        let attempt_profile = active.profile_dir.clone();
        *manager.active.lock().expect("youtube auth mutex poisoned") = Some(active);
        // Register the child before awaiting CDP so cancel/exit can stop a starting browser.
        let connection = wait_for_live_debugger_url(debugger_port).await;
        let failed_attempt = {
            let mut guard = manager.active.lock().expect("youtube auth mutex poisoned");
            let Some(active) = guard
                .as_mut()
                .filter(|active| active.profile_dir == attempt_profile)
            else {
                return Err("youtube-auth-cancelled".to_string());
            };
            match &connection {
                Ok(url) => {
                    active.websocket_url = url.clone();
                    None
                }
                Err(_) => guard.take(),
            }
        };
        if let Err(error) = connection {
            if let Some(active) = failed_attempt {
                stop_and_remove_auth_attempt(active);
            }
            return Err(error);
        }
        monitor_youtube_auth_session(app, attempt_profile);

        Ok(YoutubeAuthStart {
            browser: browser.name.to_string(),
        })
    }
}

#[tauri::command]
pub async fn start_youtube_webview_auth(app: AppHandle) -> Result<YoutubeAuthStart, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Err(
            "Экспериментальный вход через встроенное окно пока поддерживается только в Windows."
                .to_string(),
        );
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window(WEBVIEW_AUTH_WINDOW_LABEL) {
            let _ = window.show();
            let _ = window.set_focus();
            return Ok(YoutubeAuthStart {
                browser: WEBVIEW_AUTH_BROWSER_NAME.to_string(),
            });
        }

        let profile_dir = webview_auth_profile_dir(&app)?;
        fs::create_dir_all(&profile_dir)
            .map_err(|error| format!("Не удалось подготовить профиль встроенного окна: {error}"))?;
        let login_url = Url::parse(YOUTUBE_LOGIN_URL)
            .map_err(|error| format!("Не удалось подготовить адрес входа: {error}"))?;

        WebviewWindowBuilder::new(
            &app,
            WEBVIEW_AUTH_WINDOW_LABEL,
            WebviewUrl::External(login_url),
        )
        .title("YTLoadster — YouTube")
        .inner_size(540.0, 720.0)
        .min_inner_size(420.0, 560.0)
        .center()
        .resizable(true)
        .data_directory(profile_dir)
        .enable_clipboard_access()
        .devtools(false)
        .build()
        .map_err(|error| format!("Не удалось открыть встроенное окно входа: {error}"))?;

        Ok(YoutubeAuthStart {
            browser: WEBVIEW_AUTH_BROWSER_NAME.to_string(),
        })
    }
}

#[tauri::command]
pub async fn get_youtube_webview_auth_state(
    app: AppHandle,
) -> Result<YoutubeWebviewAuthState, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Ok(YoutubeWebviewAuthState {
            open: false,
            authenticated: false,
        });
    }

    #[cfg(target_os = "windows")]
    {
        let Some(window) = app.get_webview_window(WEBVIEW_AUTH_WINDOW_LABEL) else {
            return Ok(YoutubeWebviewAuthState {
                open: false,
                authenticated: false,
            });
        };
        let youtube_url = Url::parse("https://www.youtube.com/")
            .map_err(|error| format!("Не удалось проверить адрес YouTube: {error}"))?;
        let cookies = window
            .cookies_for_url(youtube_url)
            .map_err(|error| format!("Не удалось проверить cookies встроенного окна: {error}"))?
            .into_iter()
            .map(|cookie| BrowserCookie {
                name: cookie.name().to_string(),
                value: cookie.value().to_string(),
                domain: cookie.domain().unwrap_or(".youtube.com").to_string(),
                path: cookie.path().unwrap_or("/").to_string(),
                expires: cookie
                    .expires_datetime()
                    .map(|value| value.unix_timestamp() as f64)
                    .unwrap_or(0.0),
                secure: cookie.secure().unwrap_or(true),
            })
            .collect::<Vec<_>>();

        if youtube_cookie_set_is_authenticated(&cookies) {
            save_youtube_session(&app, WEBVIEW_AUTH_BROWSER_NAME, &cookies)?;
            window
                .close()
                .map_err(|error| format!("Вход выполнен, но окно не удалось закрыть: {error}"))?;
            return Ok(YoutubeWebviewAuthState {
                open: false,
                authenticated: true,
            });
        }

        Ok(YoutubeWebviewAuthState {
            open: true,
            authenticated: false,
        })
    }
}

#[tauri::command]
pub async fn cancel_youtube_webview_auth(app: AppHandle) -> Result<YoutubeAuthStatus, String> {
    if let Some(window) = app.get_webview_window(WEBVIEW_AUTH_WINDOW_LABEL) {
        window
            .close()
            .map_err(|error| format!("Не удалось закрыть встроенное окно входа: {error}"))?;
    }
    Ok(youtube_auth_status(&app))
}

#[tauri::command]
pub fn sign_out_youtube(
    app: AppHandle,
    manager: State<'_, YoutubeAuthManager>,
) -> Result<YoutubeAuthStatus, String> {
    clear_youtube_auth_data(&app, &manager)
}

#[tauri::command]
pub fn clear_youtube_auth(
    app: AppHandle,
    manager: State<'_, YoutubeAuthManager>,
) -> Result<YoutubeAuthStatus, String> {
    clear_youtube_auth_data(&app, &manager)
}

fn clear_youtube_auth_data(
    app: &AppHandle,
    manager: &YoutubeAuthManager,
) -> Result<YoutubeAuthStatus, String> {
    manager.completed.store(false, Ordering::Relaxed);
    if let Some(active) = manager
        .active
        .lock()
        .expect("youtube auth mutex poisoned")
        .take()
    {
        stop_and_remove_auth_attempt(active);
    }
    if let Some(window) = app.get_webview_window(WEBVIEW_AUTH_WINDOW_LABEL) {
        let _ = window.clear_all_browsing_data();
        let _ = window.close();
    }
    remove_saved_youtube_session(app)?;
    let profiles = auth_profile_root(app)?;
    remove_directory_with_retry(&profiles)
        .map_err(|error| format!("Не удалось удалить данные входа YouTube: {error}"))?;
    let webview_profile = webview_auth_profile_dir(app)?;
    remove_directory_with_retry(&webview_profile)
        .map_err(|error| format!("Не удалось удалить профиль встроенного окна: {error}"))?;
    Ok(youtube_auth_status(app))
}

fn remove_saved_youtube_session(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    macos_delete_youtube_session()?;
    let data_dir = auth_data_dir(&app)?;
    for name in [SESSION_FILE, SESSION_METADATA_FILE] {
        let path = data_dir.join(name);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("Не удалось удалить сохранённую авторизацию: {error}"))?;
        }
    }
    Ok(())
}

fn remove_directory_with_retry(path: &Path) -> std::io::Result<()> {
    for attempt in 0..15 {
        match fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) if attempt == 14 => return Err(error),
            Err(_) => std::thread::sleep(Duration::from_millis(150)),
        }
    }
    Ok(())
}

pub async fn materialize_youtube_cookies(app: &AppHandle) -> Result<TemporaryCookieFile, String> {
    let manager = app.state::<YoutubeAuthManager>();
    let state = refresh_youtube_auth_session(app, &manager).await?;
    if state.open && !state.session_detected {
        return Err("youtube-auth-session-unavailable".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return materialize_youtube_cookie_file(app, macos_read_youtube_session()?);
    }
    let encrypted = fs::read(auth_data_dir(app)?.join(SESSION_FILE))
        .map_err(|_| "Сохранённая авторизация YouTube не найдена. Войдите повторно.".to_string())?;
    let plaintext = unprotect_session(&encrypted)?;
    materialize_youtube_cookie_file(app, plaintext)
}

fn materialize_youtube_cookie_file(
    app: &AppHandle,
    plaintext: Vec<u8>,
) -> Result<TemporaryCookieFile, String> {
    if !plaintext.starts_with(b"# Netscape HTTP Cookie File") {
        return Err("Сохранённая авторизация YouTube повреждена. Войдите повторно.".to_string());
    }
    let runtime_dir = auth_data_dir(app)?.join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Не удалось подготовить временную авторизацию: {error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = runtime_dir.join(format!("cookies-{}-{nonce}.txt", std::process::id()));
    fs::write(&path, plaintext)
        .map_err(|error| format!("Не удалось подготовить временную авторизацию: {error}"))?;
    Ok(TemporaryCookieFile { path })
}

fn youtube_auth_status(app: &AppHandle) -> YoutubeAuthStatus {
    #[cfg(target_os = "macos")]
    {
        let metadata = auth_data_dir(app)
            .ok()
            .and_then(|directory| fs::read(directory.join(SESSION_METADATA_FILE)).ok())
            .and_then(|bytes| serde_json::from_slice::<SessionMetadata>(&bytes).ok());
        return YoutubeAuthStatus {
            supported: true,
            authenticated: metadata.is_some() && macos_youtube_session_exists(),
            browser: metadata.map(|value| value.browser),
        };
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        YoutubeAuthStatus {
            supported: false,
            authenticated: false,
            browser: None,
        }
    }

    #[cfg(target_os = "windows")]
    {
        let metadata = auth_data_dir(app)
            .ok()
            .and_then(|directory| fs::read(directory.join(SESSION_METADATA_FILE)).ok())
            .and_then(|bytes| serde_json::from_slice::<SessionMetadata>(&bytes).ok());
        let authenticated = auth_data_dir(app)
            .map(|directory| directory.join(SESSION_FILE).is_file())
            .unwrap_or(false)
            && metadata.is_some();
        YoutubeAuthStatus {
            supported: true,
            authenticated,
            browser: metadata.map(|value| value.browser),
        }
    }
}

fn auth_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("authorization"))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn macos_youtube_session_exists() -> bool {
    SecKeychain::default()
        .and_then(|keychain| {
            keychain.find_generic_password(MACOS_KEYCHAIN_SERVICE, MACOS_KEYCHAIN_ACCOUNT)
        })
        .is_ok()
}

#[cfg(target_os = "macos")]
fn macos_read_youtube_session() -> Result<Vec<u8>, String> {
    let keychain = SecKeychain::default()
        .map_err(|error| format!("Не удалось открыть Связку ключей macOS: {error}"))?;
    let (password, _) = keychain
        .find_generic_password(MACOS_KEYCHAIN_SERVICE, MACOS_KEYCHAIN_ACCOUNT)
        .map_err(|_| {
            "Сохранённая авторизация YouTube не найдена или недоступна. Войдите повторно."
                .to_string()
        })?;
    Ok(password.to_owned())
}

#[cfg(target_os = "macos")]
fn macos_store_youtube_session(cookie_text: &[u8]) -> Result<(), String> {
    let keychain = SecKeychain::default()
        .map_err(|error| format!("Не удалось открыть Связку ключей macOS: {error}"))?;
    keychain
        .set_generic_password(MACOS_KEYCHAIN_SERVICE, MACOS_KEYCHAIN_ACCOUNT, cookie_text)
        .map_err(|error| {
            format!("Не удалось сохранить авторизацию YouTube в Связке ключей macOS: {error}")
        })
}

#[cfg(target_os = "macos")]
fn macos_delete_youtube_session() -> Result<(), String> {
    let keychain = SecKeychain::default()
        .map_err(|error| format!("Не удалось открыть Связку ключей macOS: {error}"))?;
    if let Ok((_, item)) =
        keychain.find_generic_password(MACOS_KEYCHAIN_SERVICE, MACOS_KEYCHAIN_ACCOUNT)
    {
        item.delete();
    }
    Ok(())
}

fn auth_profile_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(AUTH_PROFILE_DIRECTORY))
        .map_err(|error| error.to_string())
}

fn webview_auth_profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(WEBVIEW_AUTH_PROFILE_DIRECTORY))
        .map_err(|error| error.to_string())
}

fn unique_auth_profile_dir(root: &Path, browser_id: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let attempt = AUTH_ATTEMPT_COUNTER.fetch_add(1, Ordering::Relaxed);
    root.join(format!(
        "{browser_id}-{timestamp}-{}-{attempt}",
        std::process::id()
    ))
}

fn monitor_youtube_auth_session(app: AppHandle, profile: PathBuf) {
    tauri::async_runtime::spawn(async move {
        loop {
            let manager = app.state::<YoutubeAuthManager>();
            if !manager
                .active
                .lock()
                .expect("youtube auth mutex poisoned")
                .as_ref()
                .is_some_and(|active| active.profile_dir == profile)
            {
                break;
            }
            let _ = refresh_youtube_auth_session(&app, &manager).await;
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    });
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn auth_browser_command(executable: &Path, profile: &Path, debugger_port: u16) -> Command {
    let mut command = Command::new(executable);
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .arg(format!("--remote-debugging-port={debugger_port}"))
        .arg("--remote-debugging-address=127.0.0.1")
        .arg(format!("--user-data-dir={}", profile.to_string_lossy()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-background-mode")
        .arg("--new-window")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

async fn refresh_youtube_auth_session(
    app: &AppHandle,
    manager: &YoutubeAuthManager,
) -> Result<YoutubeAuthWindowState, String> {
    // Polling and queued jobs must never overwrite a newer cookie snapshot.
    let _refresh = manager.refresh.lock().await;
    let capture = manager
        .active
        .lock()
        .expect("youtube auth mutex poisoned")
        .as_ref()
        .map(|active| (active.profile_dir.clone(), active.websocket_url.clone()));
    let Some((profile, websocket_url)) = capture else {
        let status = youtube_auth_status(app);
        return Ok(YoutubeAuthWindowState {
            open: false,
            session_detected: manager.completed.load(Ordering::Relaxed) && status.authenticated,
            status,
        });
    };
    let snapshot = read_live_browser_snapshot(&websocket_url).await;
    let (open, session_detected, closed_attempt) = {
        let mut guard = manager.active.lock().expect("youtube auth mutex poisoned");
        let Some(active) = guard
            .as_mut()
            .filter(|active| active.profile_dir == profile)
        else {
            // Sign-out or a new attempt happened while CDP was reading cookies.
            return Ok(YoutubeAuthWindowState {
                open: false,
                session_detected: false,
                status: youtube_auth_status(app),
            });
        };
        let (open, session_detected) = match snapshot {
            Ok(snapshot) => {
                let browser_name = active.browser_name.clone();
                let authenticated = update_live_youtube_session(
                    &mut active.cookie_fingerprint,
                    &snapshot.cookies,
                    |cookies| save_youtube_session(app, &browser_name, cookies),
                    || remove_saved_youtube_session(app),
                )?;
                active.window_seen |= snapshot.open;
                (snapshot.open, authenticated)
            }
            Err(_) => {
                if auth_process_window_is_open(active)? {
                    return Err("youtube-auth-refresh-failed".to_string());
                }
                // Cmd+Q may close CDP before its final response. Keep the last protected snapshot.
                (false, active.cookie_fingerprint.is_some())
            }
        };
        let closed_attempt = if open {
            None
        } else {
            manager.completed.store(session_detected, Ordering::Relaxed);
            guard.take()
        };
        (open, session_detected, closed_attempt)
    };
    if let Some(active) = closed_attempt {
        let _ = tokio::task::spawn_blocking(move || stop_and_remove_auth_attempt(active)).await;
    }
    Ok(YoutubeAuthWindowState {
        open,
        session_detected,
        status: youtube_auth_status(app),
    })
}

fn update_live_youtube_session(
    fingerprint: &mut Option<[u8; 32]>,
    cookies: &[BrowserCookie],
    save: impl FnOnce(&[BrowserCookie]) -> Result<(), String>,
    clear: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    if !youtube_cookie_set_is_authenticated(cookies) {
        if fingerprint.is_some() {
            clear()?;
            *fingerprint = None;
        }
        return Ok(false);
    }
    let next: [u8; 32] = Sha256::digest(serialize_youtube_cookies(cookies)?.as_bytes()).into();
    if fingerprint.as_ref() != Some(&next) {
        save(cookies)?;
        *fingerprint = Some(next);
    }
    Ok(true)
}

struct LiveBrowserSnapshot {
    cookies: Vec<BrowserCookie>,
    open: bool,
}

async fn read_live_browser_snapshot(websocket_url: &str) -> Result<LiveBrowserSnapshot, String> {
    use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};
    let error = || "youtube-auth-refresh-failed".to_string();
    let port = url::Url::parse(websocket_url)
        .ok()
        .and_then(|url| url.port());
    if !port.is_some_and(|port| live_debugger_url_matches_port(websocket_url, port)) {
        return Err(error());
    }
    tokio::time::timeout(Duration::from_secs(3), async {
        let config = WebSocketConfig::default()
            .max_message_size(Some(4 * 1024 * 1024))
            .max_frame_size(Some(4 * 1024 * 1024));
        let (mut socket, _) =
            tokio_tungstenite::connect_async_with_config(websocket_url, Some(config), false)
                .await
                .map_err(|_| error())?;
        let mut cookies = None;
        let mut open = None;
        for (id, method) in [(1, "Storage.getCookies"), (2, "Target.getTargets")] {
            socket
                .send(Message::Text(
                    serde_json::json!({"id": id, "method": method})
                        .to_string()
                        .into(),
                ))
                .await
                .map_err(|_| error())?;
            loop {
                let message = socket
                    .next()
                    .await
                    .ok_or_else(error)?
                    .map_err(|_| error())?;
                match message {
                    Message::Text(text) => {
                        let value: serde_json::Value =
                            serde_json::from_str(&text).map_err(|_| error())?;
                        if value["id"].as_u64() != Some(id) {
                            continue;
                        }
                        if value.get("error").is_some() {
                            return Err(error());
                        }
                        if id == 1 {
                            let all: Vec<BrowserCookie> =
                                serde_json::from_value(value["result"]["cookies"].clone())
                                    .map_err(|_| error())?;
                            cookies = Some(
                                all.into_iter()
                                    .filter(|cookie| is_youtube_domain(&cookie.domain))
                                    .collect(),
                            );
                        } else {
                            let targets = value["result"]["targetInfos"]
                                .as_array()
                                .ok_or_else(error)?;
                            open = Some(targets.iter().any(|target| target["type"] == "page"));
                        }
                        break;
                    }
                    Message::Close(_) => return Err(error()),
                    _ => {}
                }
            }
        }
        let _ = socket.close(None).await;
        Ok(LiveBrowserSnapshot {
            cookies: cookies.ok_or_else(error)?,
            open: open.ok_or_else(error)?,
        })
    })
    .await
    .map_err(|_| error())?
}

fn auth_process_window_is_open(active: &mut ActiveAuth) -> Result<bool, String> {
    let root_running = active
        .child
        .try_wait()
        .map(|status| status.is_none())
        .map_err(|_| "youtube-auth-refresh-failed".to_string())?;
    #[cfg(target_os = "windows")]
    {
        let visible = browser_process_tree_has_visible_window(active.child.id());
        active.window_seen |= visible;
        Ok(auth_window_is_open(
            active.window_seen,
            root_running,
            browser_process_tree_is_running(active.child.id()),
            visible,
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(root_running)
    }
}

fn auth_window_is_open(
    window_seen: bool,
    root_process_running: bool,
    process_tree_running: bool,
    visible_window: bool,
) -> bool {
    if window_seen {
        visible_window
    } else {
        root_process_running || process_tree_running
    }
}

fn stop_and_remove_auth_attempt(mut active: ActiveAuth) {
    #[cfg(target_os = "windows")]
    {
        request_browser_window_close(active.child.id());
        std::thread::sleep(Duration::from_millis(350));
        terminate_browser_process_tree(active.child.id());
    }
    #[cfg(target_os = "macos")]
    terminate_macos_auth_browser_group(active.child.id());
    if active.child.try_wait().ok().flatten().is_none() {
        let _ = active.child.kill();
    }
    let _ = active.child.wait();
    let _ = remove_directory_with_retry(&active.profile_dir);
}

#[cfg(target_os = "macos")]
fn terminate_macos_auth_browser_group(process_id: u32) {
    let process_group = format!("-{process_id}");
    let _ = Command::new("/bin/kill")
        .arg("-TERM")
        .arg(&process_group)
        .status();
    std::thread::sleep(Duration::from_millis(350));
    let _ = Command::new("/bin/kill")
        .arg("-KILL")
        .arg(process_group)
        .status();
}

async fn wait_for_live_debugger_url(port: u16) -> Result<String, String> {
    let error = || "youtube-auth-connection-failed".to_string();
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|_| error())?;
    let endpoint = format!("http://127.0.0.1:{port}/json/version");
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(response) = client.get(&endpoint).send().await {
                if response.status().is_success() {
                    if let Ok(bytes) = response.bytes().await {
                        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                            if let Some(url) = value["webSocketDebuggerUrl"].as_str() {
                                if live_debugger_url_matches_port(url, port) {
                                    return url.to_string();
                                }
                            }
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .map_err(|_| error())
}

fn live_debugger_url_matches_port(value: &str, port: u16) -> bool {
    url::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "ws"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(port)
            && url.path().starts_with("/devtools/browser/")
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    })
}

fn serialize_youtube_cookies(cookies: &[BrowserCookie]) -> Result<String, String> {
    let filtered = cookies
        .iter()
        .filter(|cookie| is_youtube_domain(&cookie.domain))
        .filter(|cookie| cookie_is_usable(cookie))
        .collect::<Vec<_>>();
    if !youtube_cookie_set_is_authenticated(cookies) {
        return Err(
            "Вход ещё не завершён. Завершите авторизацию в открывшемся браузере.".to_string(),
        );
    }

    let mut output = String::from("# Netscape HTTP Cookie File\r\n");
    for cookie in filtered {
        let include_subdomains = if cookie.domain.starts_with('.') {
            "TRUE"
        } else {
            "FALSE"
        };
        let secure = if cookie.secure { "TRUE" } else { "FALSE" };
        let expires = if cookie.expires.is_finite() && cookie.expires > 0.0 {
            cookie.expires.floor() as u64
        } else {
            0
        };
        output.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\r\n",
            cookie.domain,
            include_subdomains,
            if cookie.path.is_empty() {
                "/"
            } else {
                &cookie.path
            },
            secure,
            expires,
            cookie.name,
            cookie.value
        ));
    }
    Ok(output)
}

fn youtube_cookie_set_is_authenticated(cookies: &[BrowserCookie]) -> bool {
    // Match the downloader's authentication requirement, including logout/rotation detection.
    let valid = |cookie: &&BrowserCookie| {
        let domain = cookie.domain.trim_start_matches('.').to_ascii_lowercase();
        (domain == "youtube.com" || domain == "www.youtube.com")
            && (cookie.path.is_empty() || cookie.path == "/")
            && cookie_is_usable(cookie)
            && !cookie.value.is_empty()
    };
    let mut account_cookies = cookies.iter().filter(valid);
    let has_login = account_cookies
        .clone()
        .any(|cookie| cookie.name == "LOGIN_INFO");
    let has_sid = account_cookies.any(|cookie| {
        matches!(
            cookie.name.as_str(),
            "SAPISID" | "__Secure-1PAPISID" | "__Secure-3PAPISID"
        )
    });
    has_login && has_sid
}

fn cookie_is_usable(cookie: &BrowserCookie) -> bool {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    cookie_fields_are_safe(cookie)
        && cookie.expires.is_finite()
        && (cookie.expires <= 0.0 || cookie.expires > now)
}

fn save_youtube_session(
    app: &AppHandle,
    browser_name: &str,
    cookies: &[BrowserCookie],
) -> Result<(), String> {
    let cookie_text = serialize_youtube_cookies(cookies)?;
    #[cfg(target_os = "macos")]
    {
        macos_store_youtube_session(cookie_text.as_bytes())?;
        let data_dir = auth_data_dir(app)?;
        fs::create_dir_all(&data_dir)
            .map_err(|error| format!("Не удалось создать каталог авторизации: {error}"))?;
        let metadata = SessionMetadata {
            browser: browser_name.to_string(),
            saved_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };
        let metadata_json =
            serde_json::to_vec_pretty(&metadata).map_err(|error| error.to_string())?;
        return write_atomic(&data_dir.join(SESSION_METADATA_FILE), &metadata_json);
    }
    let encrypted = protect_session(cookie_text.as_bytes())?;
    let data_dir = auth_data_dir(app)?;
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Не удалось создать каталог авторизации: {error}"))?;
    write_atomic(&data_dir.join(SESSION_FILE), &encrypted)?;
    let metadata = SessionMetadata {
        browser: browser_name.to_string(),
        saved_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };
    let metadata_json = serde_json::to_vec_pretty(&metadata).map_err(|error| error.to_string())?;
    write_atomic(&data_dir.join(SESSION_METADATA_FILE), &metadata_json)
}

fn is_youtube_domain(domain: &str) -> bool {
    let domain = domain.trim_start_matches('.').to_ascii_lowercase();
    domain == "youtube.com" || domain.ends_with(".youtube.com")
}

fn cookie_fields_are_safe(cookie: &BrowserCookie) -> bool {
    [&cookie.name, &cookie.value, &cookie.domain, &cookie.path]
        .into_iter()
        .all(|value| !value.contains(['\r', '\n', '\t', '\0']))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
pub(crate) fn protect_session(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::core::w;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: data
            .len()
            .try_into()
            .map_err(|_| "Сессия слишком велика".to_string())?,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            w!("YTLoadster YouTube session"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| format!("Windows не удалось защитить авторизацию: {error}"))?;
        let protected = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(protected)
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn unprotect_session(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: data
            .len()
            .try_into()
            .map_err(|_| "Сессия слишком велика".to_string())?,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| "Сохранённая авторизация YouTube недоступна для текущего пользователя Windows. Войдите повторно.".to_string())?;
        let plaintext = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(plaintext)
    }
}

#[cfg(not(target_os = "windows"))]
fn protect_session(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Автоматический вход в YouTube пока поддерживается только в Windows.".to_string())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_session(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Автоматический вход в YouTube пока поддерживается только в Windows.".to_string())
}

#[cfg(target_os = "windows")]
fn request_browser_window_close(process_id: u32) {
    unsafe extern "system" fn close_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let process_ids = unsafe { &*(lparam.0 as *const HashSet<u32>) };
        let mut window_process_id = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut window_process_id));
            if process_ids.contains(&window_process_id) {
                let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
        BOOL(1)
    }

    let process_ids = browser_process_tree(process_id);
    unsafe {
        let _ = EnumWindows(
            Some(close_window),
            LPARAM((&process_ids as *const HashSet<u32>) as isize),
        );
    }
}

#[cfg(target_os = "windows")]
fn browser_process_tree(root_process_id: u32) -> HashSet<u32> {
    collect_process_tree(root_process_id, &system_process_relations())
}

#[cfg(target_os = "windows")]
fn browser_process_tree_is_running(root_process_id: u32) -> bool {
    process_tree_is_running(root_process_id, &system_process_relations())
}

#[cfg(target_os = "windows")]
fn process_tree_is_running(root_process_id: u32, entries: &[(u32, u32)]) -> bool {
    let process_ids = collect_process_tree(root_process_id, entries);
    entries
        .iter()
        .any(|(process_id, _)| process_ids.contains(process_id))
}

#[cfg(target_os = "windows")]
fn browser_process_tree_has_visible_window(root_process_id: u32) -> bool {
    struct VisibleWindowSearch {
        process_ids: HashSet<u32>,
        found: bool,
    }

    unsafe extern "system" fn find_visible_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = unsafe { &mut *(lparam.0 as *mut VisibleWindowSearch) };
        let mut window_process_id = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut window_process_id));
            if search.process_ids.contains(&window_process_id) && IsWindowVisible(hwnd).as_bool() {
                search.found = true;
                return BOOL(0);
            }
        }
        BOOL(1)
    }

    let mut search = VisibleWindowSearch {
        process_ids: browser_process_tree(root_process_id),
        found: false,
    };
    unsafe {
        let _ = EnumWindows(
            Some(find_visible_window),
            LPARAM((&mut search as *mut VisibleWindowSearch) as isize),
        );
    }
    search.found
}

#[cfg(target_os = "windows")]
fn system_process_relations() -> Vec<(u32, u32)> {
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
        loop {
            entries.push((entry.th32ProcessID, entry.th32ParentProcessID));
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
    }
    unsafe {
        let _ = CloseHandle(snapshot);
    }
    entries
}

#[cfg(target_os = "windows")]
fn collect_process_tree(root_process_id: u32, entries: &[(u32, u32)]) -> HashSet<u32> {
    let mut process_ids = HashSet::from([root_process_id]);
    loop {
        let previous_len = process_ids.len();
        for (process_id, parent_process_id) in entries {
            if process_ids.contains(parent_process_id) {
                process_ids.insert(*process_id);
            }
        }
        if process_ids.len() == previous_len {
            break;
        }
    }
    process_ids
}

#[cfg(target_os = "windows")]
fn terminate_browser_process_tree(root_process_id: u32) {
    terminate_browser_processes(root_process_id, true);
}

#[cfg(target_os = "windows")]
fn terminate_browser_processes(root_process_id: u32, include_root: bool) {
    for process_id in browser_process_tree(root_process_id) {
        if !include_root && process_id == root_process_id {
            continue;
        }
        if let Ok(handle) = unsafe { OpenProcess(PROCESS_TERMINATE, false, process_id) } {
            unsafe {
                let _ = TerminateProcess(handle, 0);
                let _ = CloseHandle(handle);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn choose_browser(preferred: Option<&str>) -> Option<BrowserInstallation> {
    let browsers = installed_chromium_browsers();
    preferred
        .and_then(|preferred| {
            browsers
                .iter()
                .find(|browser| browser.id.eq_ignore_ascii_case(preferred))
                .cloned()
        })
        .or_else(|| browsers.into_iter().next())
}

#[cfg(target_os = "windows")]
fn installed_chromium_browsers() -> Vec<BrowserInstallation> {
    let program_files = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let program_files_x86 = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from);
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let definitions = [
        (
            "edge",
            "Microsoft Edge",
            "msedge.exe",
            vec![
                program_files_x86
                    .as_ref()
                    .map(|root| root.join("Microsoft/Edge/Application/msedge.exe")),
                program_files
                    .as_ref()
                    .map(|root| root.join("Microsoft/Edge/Application/msedge.exe")),
                local_app_data
                    .as_ref()
                    .map(|root| root.join("Microsoft/Edge/Application/msedge.exe")),
            ],
        ),
        (
            "chrome",
            "Google Chrome",
            "chrome.exe",
            vec![
                program_files
                    .as_ref()
                    .map(|root| root.join("Google/Chrome/Application/chrome.exe")),
                program_files_x86
                    .as_ref()
                    .map(|root| root.join("Google/Chrome/Application/chrome.exe")),
                local_app_data
                    .as_ref()
                    .map(|root| root.join("Google/Chrome/Application/chrome.exe")),
            ],
        ),
        (
            "brave",
            "Brave",
            "brave.exe",
            vec![
                program_files
                    .as_ref()
                    .map(|root| root.join("BraveSoftware/Brave-Browser/Application/brave.exe")),
                program_files_x86
                    .as_ref()
                    .map(|root| root.join("BraveSoftware/Brave-Browser/Application/brave.exe")),
                local_app_data
                    .as_ref()
                    .map(|root| root.join("BraveSoftware/Brave-Browser/Application/brave.exe")),
            ],
        ),
        (
            "vivaldi",
            "Vivaldi",
            "vivaldi.exe",
            vec![
                local_app_data
                    .as_ref()
                    .map(|root| root.join("Vivaldi/Application/vivaldi.exe")),
                program_files
                    .as_ref()
                    .map(|root| root.join("Vivaldi/Application/vivaldi.exe")),
                program_files_x86
                    .as_ref()
                    .map(|root| root.join("Vivaldi/Application/vivaldi.exe")),
            ],
        ),
        (
            "opera",
            "Opera",
            "opera.exe",
            vec![
                local_app_data
                    .as_ref()
                    .map(|root| root.join("Programs/Opera/opera.exe")),
                local_app_data
                    .as_ref()
                    .map(|root| root.join("Programs/Opera GX/opera.exe")),
            ],
        ),
    ];

    definitions
        .into_iter()
        .filter_map(|(id, name, executable_name, paths)| {
            paths
                .into_iter()
                .flatten()
                .chain(path_executable_candidates(executable_name))
                .find(|path| path.is_file())
                .map(|executable| BrowserInstallation {
                    id,
                    name,
                    executable,
                })
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn path_executable_candidates(executable: &str) -> impl Iterator<Item = PathBuf> + '_ {
    std::env::var_os("PATH")
        .map(|value| {
            std::env::split_paths(&value)
                .map(|path| path.join(executable))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
        .into_iter()
}

#[cfg(target_os = "macos")]
fn choose_browser(preferred: Option<&str>) -> Option<BrowserInstallation> {
    let browsers = installed_chromium_browsers();
    preferred
        .and_then(|preferred| {
            browsers
                .iter()
                .find(|browser| browser.id.eq_ignore_ascii_case(preferred))
                .cloned()
        })
        .or_else(|| browsers.into_iter().next())
}

#[cfg(target_os = "macos")]
fn installed_chromium_browsers() -> Vec<BrowserInstallation> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }

    [
        (
            "chrome",
            "Google Chrome",
            "Google Chrome.app",
            "Google Chrome",
        ),
        ("brave", "Brave", "Brave Browser.app", "Brave Browser"),
        ("vivaldi", "Vivaldi", "Vivaldi.app", "Vivaldi"),
        ("opera", "Opera", "Opera.app", "Opera"),
    ]
    .into_iter()
    .filter_map(|(id, name, app_name, executable_name)| {
        roots
            .iter()
            .map(|root| {
                root.join(app_name)
                    .join("Contents/MacOS")
                    .join(executable_name)
            })
            .find(|path| path.is_file())
            .map(|executable| BrowserInstallation {
                id,
                name,
                executable,
            })
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie(name: &str, value: &str) -> BrowserCookie {
        BrowserCookie {
            name: name.into(),
            value: value.into(),
            domain: ".youtube.com".into(),
            path: "/".into(),
            expires: 1_900_000_000.0,
            secure: true,
        }
    }

    fn account_cookies(value: &str) -> Vec<BrowserCookie> {
        vec![
            cookie("SAPISID", value),
            cookie("LOGIN_INFO", "account-login"),
        ]
    }

    #[test]
    fn login_continues_to_youtube_instead_of_a_technical_page() {
        assert!(YOUTUBE_LOGIN_URL.contains("www.youtube.com%2F"));
        assert!(!YOUTUBE_LOGIN_URL.contains("robots.txt"));
    }

    #[test]
    fn creates_a_fresh_profile_for_every_auth_attempt() {
        let root = PathBuf::from("youtube-auth-browser");
        let first = unique_auth_profile_dir(&root, "edge");
        let second = unique_auth_profile_dir(&root, "edge");

        assert_eq!(first.parent(), Some(root.as_path()));
        assert_eq!(second.parent(), Some(root.as_path()));
        assert_ne!(first, second);
        assert!(first
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("edge-")));
    }

    #[test]
    fn keeps_auth_open_when_launcher_exits_but_browser_tree_is_running() {
        assert!(auth_window_is_open(false, false, true, false));
        assert!(auth_window_is_open(true, false, true, true));
    }

    #[test]
    fn detects_manual_close_after_a_browser_window_was_seen() {
        assert!(!auth_window_is_open(true, false, true, false));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn collects_the_complete_browser_process_tree() {
        let process_ids = collect_process_tree(
            100,
            &[(100, 1), (101, 100), (102, 101), (103, 100), (200, 1)],
        );

        assert_eq!(process_ids, HashSet::from([100, 101, 102, 103]));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detects_live_descendants_after_the_launcher_pid_exits() {
        let relations = [(101, 100), (102, 101), (200, 1)];

        assert!(process_tree_is_running(100, &relations));
        assert!(!process_tree_is_running(300, &relations));
    }

    #[test]
    fn exports_only_safe_youtube_cookies() {
        let cookies = vec![
            cookie("LOGIN_INFO", "account-login"),
            cookie("PREF", "bad\tvalue"),
            BrowserCookie {
                name: "SAPISID".to_string(),
                value: "secret".to_string(),
                domain: ".youtube.com".to_string(),
                path: "/".to_string(),
                expires: 1_900_000_000.0,
                secure: true,
            },
            BrowserCookie {
                name: "SID".to_string(),
                value: "google-secret".to_string(),
                domain: ".google.com".to_string(),
                path: "/".to_string(),
                expires: 1_900_000_000.0,
                secure: true,
            },
        ];

        let text = serialize_youtube_cookies(&cookies).unwrap();

        assert!(text.contains(".youtube.com"));
        assert!(text.contains("SAPISID"));
        assert!(!text.contains("google-secret"));
        assert!(!text.contains("bad\tvalue"));
    }

    #[test]
    fn rejects_cookie_sets_without_an_authenticated_youtube_session() {
        let cookies = vec![BrowserCookie {
            name: "PREF".to_string(),
            value: "language=ru".to_string(),
            domain: ".youtube.com".to_string(),
            path: "/".to_string(),
            expires: 1_900_000_000.0,
            secure: true,
        }];

        assert!(serialize_youtube_cookies(&cookies).is_err());
    }

    #[test]
    fn preserves_session_only_cookies_for_the_downloader() {
        let cookies = [
            cookie("LOGIN_INFO", "account-login"),
            BrowserCookie {
                name: "SAPISID".into(),
                value: "account".into(),
                domain: ".youtube.com".into(),
                path: "/".into(),
                expires: 1_900_000_000.0,
                secure: true,
            },
            BrowserCookie {
                name: "SID".into(),
                value: "session-only".into(),
                domain: ".youtube.com".into(),
                path: "/".into(),
                expires: -1.0,
                secure: true,
            },
        ];
        let text = serialize_youtube_cookies(&cookies).unwrap();
        assert!(text.contains(".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsession-only\r\n"));
    }

    #[test]
    fn accepts_only_the_dedicated_loopback_debugger() {
        assert!(live_debugger_url_matches_port(
            "ws://127.0.0.1:9234/devtools/browser/id",
            9234
        ));
        for url in [
            "ws://127.0.0.1:9222/devtools/browser/id",
            "ws://example.com:9234/devtools/browser/id",
            "ws://127.0.0.1:9234/devtools/page/id",
            "ws://user@127.0.0.1:9234/devtools/browser/id",
        ] {
            assert!(!live_debugger_url_matches_port(url, 9234));
        }
    }

    #[tokio::test]
    async fn discovers_the_live_browser_without_a_profile_restart() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let expected = format!("ws://127.0.0.1:{port}/devtools/browser/live-session");
        let body = serde_json::json!({ "webSocketDebuggerUrl": expected }).to_string();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 4096];
            let count = socket.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..count]).starts_with("GET /json/version "));
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        assert_eq!(wait_for_live_debugger_url(port).await.unwrap(), expected);
        server.join().unwrap();
    }

    #[test]
    fn webview_auth_requires_a_youtube_account_cookie() {
        let cookies = vec![
            cookie("LOGIN_INFO", "account-login"),
            BrowserCookie {
                name: "SID".to_string(),
                value: "google-session".to_string(),
                domain: ".google.com".to_string(),
                path: "/".to_string(),
                expires: 1_900_000_000.0,
                secure: true,
            },
            BrowserCookie {
                name: "SAPISID".to_string(),
                value: "youtube-session".to_string(),
                domain: ".youtube.com".to_string(),
                path: "/".to_string(),
                expires: 1_900_000_000.0,
                secure: true,
            },
        ];

        assert!(youtube_cookie_set_is_authenticated(&cookies));
        assert!(!youtube_cookie_set_is_authenticated(&cookies[..1]));
    }

    #[test]
    fn waits_for_complete_unexpired_youtube_authentication() {
        assert!(!youtube_cookie_set_is_authenticated(&[cookie(
            "SAPISID", "account"
        )]));
        assert!(!youtube_cookie_set_is_authenticated(&[cookie(
            "LOGIN_INFO",
            "account"
        )]));
        let mut cookies = account_cookies("account");
        assert!(youtube_cookie_set_is_authenticated(&cookies));
        cookies[1].expires = 1.0;
        assert!(!youtube_cookie_set_is_authenticated(&cookies));
        cookies[1].expires = -1.0;
        assert!(youtube_cookie_set_is_authenticated(&cookies));
        cookies[1].domain = ".google.com".into();
        assert!(!youtube_cookie_set_is_authenticated(&cookies));
        cookies[1].domain = "studio.youtube.com".into();
        assert!(!youtube_cookie_set_is_authenticated(&cookies));
        cookies[1] = cookie("LOGIN_INFO", "invalid\nvalue");
        assert!(!youtube_cookie_set_is_authenticated(&cookies));
    }

    #[test]
    fn saves_rotated_cookies_and_removes_the_session_after_browser_logout() {
        use std::cell::{Cell, RefCell};
        let saved = RefCell::new(None::<String>);
        let writes = Cell::new(0);
        let mut fingerprint = None;
        let update = |fingerprint: &mut Option<[u8; 32]>, cookies: &[BrowserCookie]| {
            update_live_youtube_session(
                fingerprint,
                cookies,
                |cookies| {
                    *saved.borrow_mut() = Some(serialize_youtube_cookies(cookies)?);
                    writes.set(writes.get() + 1);
                    Ok(())
                },
                || {
                    *saved.borrow_mut() = None;
                    Ok(())
                },
            )
        };
        assert!(!update(&mut fingerprint, &[cookie("PREF", "ru")]).unwrap());
        assert!(saved.borrow().is_none());
        assert!(update(&mut fingerprint, &account_cookies("first-session")).unwrap());
        assert!(saved.borrow().as_ref().unwrap().contains("first-session"));
        assert!(update(&mut fingerprint, &account_cookies("first-session")).unwrap());
        assert_eq!(writes.get(), 1);
        assert!(update(&mut fingerprint, &account_cookies("rotated-session")).unwrap());
        assert!(saved.borrow().as_ref().unwrap().contains("rotated-session"));
        assert!(!saved.borrow().as_ref().unwrap().contains("first-session"));
        assert!(!update(&mut fingerprint, &[cookie("SAPISID", "left-after-logout")]).unwrap());
        assert!(saved.borrow().is_none());
        assert!(update(&mut fingerprint, &account_cookies("signed-in-again")).unwrap());
        assert!(saved.borrow().as_ref().unwrap().contains("signed-in-again"));
    }

    #[test]
    fn does_not_report_saved_authentication_when_protection_fails() {
        let mut fingerprint = None;
        assert!(update_live_youtube_session(
            &mut fingerprint,
            &account_cookies("account"),
            |_| Err("storage unavailable".into()),
            || Ok(())
        )
        .is_err());
        assert!(fingerprint.is_none());
    }

    #[tokio::test]
    async fn reads_live_cookie_rotation_and_closed_windows_from_the_same_browser() {
        use tokio_tungstenite::tungstenite::Message;
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let url = format!(
            "ws://127.0.0.1:{}/devtools/browser/test",
            listener.local_addr().unwrap().port()
        );
        let server = tokio::spawn(async move {
            for (value, open) in [("first", true), ("rotated", true), ("rotated", false)] {
                let (tcp, _) = listener.accept().await.unwrap();
                let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
                let mut cookies = account_cookies(value);
                let mut other_cookie = cookie("SID", "google-secret");
                other_cookie.domain = ".google.com".into();
                cookies.push(other_cookie);
                cookies.push(BrowserCookie {
                    expires: -1.0,
                    ..cookie("SID", "session-only")
                });
                for (id, method) in [(1, "Storage.getCookies"), (2, "Target.getTargets")] {
                    let request = socket.next().await.unwrap().unwrap().into_text().unwrap();
                    let request: serde_json::Value = serde_json::from_str(&request).unwrap();
                    assert_eq!(request["method"], method);
                    assert_eq!(request["id"], id);
                    let result = if id == 1 {
                        serde_json::json!({"cookies": cookies})
                    } else {
                        serde_json::json!({"targetInfos": [{"type": if open {"page"} else {"service_worker"}}]})
                    };
                    // Ignore unsolicited CDP events rather than mistaking them for a response.
                    socket
                        .send(Message::Text(
                            serde_json::json!({"method":"Target.targetCreated"})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                    socket
                        .send(Message::Text(
                            serde_json::json!({"id":id,"result":result})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                }
            }
        });
        let first = read_live_browser_snapshot(&url).await.unwrap();
        assert!(first.open);
        assert!(youtube_cookie_set_is_authenticated(&first.cookies));
        assert!(serialize_youtube_cookies(&first.cookies)
            .unwrap()
            .contains("first"));
        assert!(!serialize_youtube_cookies(&first.cookies)
            .unwrap()
            .contains("google-secret"));
        let rotated = read_live_browser_snapshot(&url).await.unwrap();
        assert!(rotated.open);
        let text = serialize_youtube_cookies(&rotated.cookies).unwrap();
        assert!(text.contains("rotated"));
        assert!(text.contains("\t0\tSID\tsession-only\r\n"));
        assert!(!read_live_browser_snapshot(&url).await.unwrap().open);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn reports_a_closed_cdp_connection_without_exposing_cookies() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let url = format!(
            "ws://127.0.0.1:{}/devtools/browser/test",
            listener.local_addr().unwrap().port()
        );
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
            let _ = socket.next().await;
            socket.close(None).await.unwrap();
        });
        assert_eq!(
            read_live_browser_snapshot(&url).await.err().unwrap(),
            "youtube-auth-refresh-failed"
        );
        server.await.unwrap();
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    #[tokio::test]
    #[ignore = "requires an installed Chromium browser; uses an isolated headless test profile"]
    async fn captures_and_refreshes_cookies_from_an_open_installed_browser() {
        use std::cell::RefCell;
        use tokio_tungstenite::tungstenite::Message;
        struct Attempt(Option<ActiveAuth>);
        impl Drop for Attempt {
            fn drop(&mut self) {
                if let Some(active) = self.0.take() {
                    stop_and_remove_auth_attempt(active);
                }
            }
        }
        let browser = choose_browser(None).expect("A Chromium browser is required for this test");
        let profile = unique_auth_profile_dir(
            &std::env::temp_dir().join("ytloadster-cdp-test"),
            browser.id,
        );
        fs::create_dir_all(&profile).unwrap();
        let port = std::net::TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let child = auth_browser_command(&browser.executable, &profile, port)
            .arg("--headless=new")
            .arg("about:blank")
            .spawn()
            .unwrap();
        let mut attempt = Attempt(Some(ActiveAuth {
            browser_name: browser.name.into(),
            websocket_url: String::new(),
            cookie_fingerprint: None,
            profile_dir: profile,
            child,
            window_seen: false,
        }));
        let url = wait_for_live_debugger_url(port).await.unwrap();
        attempt.0.as_mut().unwrap().websocket_url = url.clone();
        let (mut socket, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
        let saved = RefCell::new(Vec::<u8>::new());
        let mut fingerprint = None;
        let update = |fingerprint: &mut Option<[u8; 32]>, cookies: &[BrowserCookie]| {
            update_live_youtube_session(
                fingerprint,
                cookies,
                |cookies| {
                    let text = serialize_youtube_cookies(cookies)?;
                    #[cfg(target_os = "windows")]
                    {
                        *saved.borrow_mut() = protect_session(text.as_bytes())?;
                    }
                    #[cfg(target_os = "macos")]
                    {
                        *saved.borrow_mut() = text.into_bytes();
                    }
                    Ok(())
                },
                || {
                    saved.borrow_mut().clear();
                    Ok(())
                },
            )
        };
        for (id, value) in [
            (1, "first"),
            (2, "rotated"),
            (3, "logout"),
            (4, "signed-in-again"),
        ] {
            let mut cookies = if value == "logout" {
                vec![BrowserCookie {
                    expires: 1.0,
                    ..cookie("LOGIN_INFO", "expired")
                }]
            } else {
                account_cookies(value)
            };
            let mut google_cookie = cookie("SID", "not-exported");
            google_cookie.domain = ".google.com".into();
            cookies.push(google_cookie);
            socket.send(Message::Text(serde_json::json!({"id":id,"method":"Storage.setCookies","params":{"cookies":cookies}}).to_string().into())).await.unwrap();
            loop {
                let message = socket.next().await.unwrap().unwrap();
                if let Message::Text(text) = message {
                    let response: serde_json::Value = serde_json::from_str(&text).unwrap();
                    if response["id"] == id {
                        assert!(response.get("error").is_none());
                        break;
                    }
                }
            }
            let snapshot = read_live_browser_snapshot(&url).await.unwrap();
            assert!(snapshot.open, "Saving cookies must leave the browser open");
            assert_eq!(
                update(&mut fingerprint, &snapshot.cookies).unwrap(),
                value != "logout"
            );
            if value == "logout" {
                assert!(saved.borrow().is_empty());
            } else {
                #[cfg(target_os = "windows")]
                let plaintext = unprotect_session(&saved.borrow()).unwrap();
                #[cfg(target_os = "macos")]
                let plaintext = saved.borrow().clone();
                let text = String::from_utf8(plaintext).unwrap();
                assert!(text.contains(value));
                assert!(!text.contains("not-exported"));
                #[cfg(target_os = "windows")]
                assert!(!String::from_utf8_lossy(&saved.borrow()).contains(value));
            }
        }
        let last_saved = saved.borrow().clone();
        socket
            .send(Message::Text(
                serde_json::json!({"id":5,"method":"Browser.close"})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!read_live_browser_snapshot(&url)
            .await
            .is_ok_and(|snapshot| snapshot.open));
        assert_eq!(*saved.borrow(), last_saved);
        drop(attempt);

        // Exiting the app must also clean a browser whose CDP connection is still starting.
        let pending_profile = unique_auth_profile_dir(
            &std::env::temp_dir().join("ytloadster-cdp-test"),
            browser.id,
        );
        fs::create_dir_all(&pending_profile).unwrap();
        let port = std::net::TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let child = auth_browser_command(&browser.executable, &pending_profile, port)
            .arg("--headless=new")
            .arg("about:blank")
            .spawn()
            .unwrap();
        let manager = YoutubeAuthManager::default();
        *manager.active.lock().unwrap() = Some(ActiveAuth {
            browser_name: browser.name.into(),
            websocket_url: String::new(),
            cookie_fingerprint: None,
            profile_dir: pending_profile.clone(),
            child,
            window_seen: false,
        });
        manager.shutdown();
        assert!(manager.active.lock().unwrap().is_none());
        assert!(!pending_profile.exists());
    }
}
