use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
#[cfg(target_os = "windows")]
use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use rusqlite::{Connection, OpenFlags};
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
    pub websocket_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeAuthWindowState {
    pub open: bool,
    pub session_detected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeWebviewAuthState {
    pub open: bool,
    pub authenticated: bool,
}

#[derive(Debug, Clone, Deserialize)]
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
    browser_executable: PathBuf,
    profile_dir: PathBuf,
    child: std::process::Child,
    window_seen: bool,
}

#[derive(Debug, Default)]
pub struct YoutubeAuthManager {
    active: Mutex<Option<ActiveAuth>>,
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
pub fn get_youtube_auth_window_state(
    manager: State<'_, YoutubeAuthManager>,
) -> Result<YoutubeAuthWindowState, String> {
    let mut active = manager.active.lock().expect("youtube auth mutex poisoned");
    let Some(active) = active.as_mut() else {
        return Ok(YoutubeAuthWindowState {
            open: false,
            session_detected: false,
        });
    };
    let root_process_running = active
        .child
        .try_wait()
        .map(|status| status.is_none())
        .map_err(|error| format!("Не удалось проверить окно авторизации: {error}"))?;

    #[cfg(target_os = "windows")]
    let (session_detected, is_open) = {
        let root_process_id = active.child.id();
        let visible_window = browser_process_tree_has_visible_window(root_process_id);
        active.window_seen |= visible_window;
        let process_tree_running = browser_process_tree_is_running(root_process_id);
        let is_open = auth_window_is_open(
            active.window_seen,
            root_process_running,
            process_tree_running,
            visible_window,
        );
        (profile_has_youtube_session(&active.profile_dir), is_open)
    };
    #[cfg(target_os = "macos")]
    let (session_detected, is_open) = (false, root_process_running);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let (session_detected, is_open) = (false, root_process_running);

    Ok(YoutubeAuthWindowState {
        open: is_open,
        session_detected,
    })
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

        let mut command = Command::new(&browser.executable);
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        command
            .arg(format!("--user-data-dir={}", profile_dir.to_string_lossy()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--disable-background-mode")
            .arg("--new-window")
            .arg(YOUTUBE_LOGIN_URL)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = command
            .spawn()
            .map_err(|error| format!("Не удалось открыть {}: {error}", browser.name))?;

        *manager.active.lock().expect("youtube auth mutex poisoned") = Some(ActiveAuth {
            browser_name: browser.name.to_string(),
            browser_executable: browser.executable,
            profile_dir,
            child,
            window_seen: false,
        });

        Ok(YoutubeAuthStart {
            browser: browser.name.to_string(),
            websocket_url: None,
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
                websocket_url: None,
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
            websocket_url: None,
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
pub async fn prepare_youtube_auth_capture(
    manager: State<'_, YoutubeAuthManager>,
) -> Result<YoutubeAuthStart, String> {
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = manager;
        return Err(
            "Автоматический вход в YouTube пока поддерживается только в Windows.".to_string(),
        );
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let mut active = manager
            .active
            .lock()
            .expect("youtube auth mutex poisoned")
            .take()
            .ok_or_else(|| "Сеанс входа не запущен.".to_string())?;
        if active
            .child
            .try_wait()
            .map_err(|error| format!("Не удалось проверить окно авторизации: {error}"))?
            .is_none()
        {
            #[cfg(target_os = "windows")]
            {
                request_browser_window_close(active.child.id());
                tokio::time::sleep(Duration::from_millis(800)).await;
                terminate_browser_process_tree(active.child.id());
            }
            #[cfg(target_os = "macos")]
            terminate_macos_auth_browser_group(active.child.id());
            let _ = active.child.kill();
            let _ = active.child.wait();
        }

        #[cfg(target_os = "windows")]
        {
            terminate_browser_process_descendants(active.child.id());
            wait_for_browser_process_descendants(active.child.id(), Duration::from_secs(5)).await;
        }
        let active_port_file = active.profile_dir.join("DevToolsActivePort");
        tokio::time::sleep(Duration::from_millis(500)).await;
        let mut websocket_url = None;
        for attempt in 0..2 {
            let _ = fs::remove_file(&active_port_file);
            let mut command = Command::new(&active.browser_executable);
            command
                .arg(format!(
                    "--user-data-dir={}",
                    active.profile_dir.to_string_lossy()
                ))
                .arg("--headless=new")
                .arg("--remote-debugging-port=0")
                .arg("--remote-allow-origins=*")
                .arg("--disable-background-mode")
                .arg("--no-first-run")
                .arg("about:blank")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            active.child = command.spawn().map_err(|error| {
                format!(
                    "Не удалось проверить вход через {}: {error}",
                    active.browser_name
                )
            })?;

            if let Ok(url) = wait_for_debugger_url(&active_port_file).await {
                websocket_url = Some(url);
                break;
            }
            let _ = active.child.kill();
            let _ = active.child.wait();
            if attempt == 0 {
                tokio::time::sleep(Duration::from_millis(1_000)).await;
            } else {
                let _ = active.child.kill();
                return Err("Не удалось завершить настройку входа. Закройте отдельное окно браузера, очистите данные входа и повторите попытку.".to_string());
            }
        }
        let websocket_url = websocket_url.ok_or_else(|| {
            "Не удалось завершить настройку входа. Очистите данные входа и повторите попытку."
                .to_string()
        })?;
        let browser = active.browser_name.clone();
        *manager.active.lock().expect("youtube auth mutex poisoned") = Some(active);
        Ok(YoutubeAuthStart {
            browser,
            websocket_url: Some(websocket_url),
        })
    }
}

#[tauri::command]
pub fn complete_youtube_auth(
    browser: String,
    cookies: Vec<BrowserCookie>,
    app: AppHandle,
    manager: State<'_, YoutubeAuthManager>,
) -> Result<YoutubeAuthStatus, String> {
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (browser, cookies, app, manager);
        return Err(
            "Автоматический вход в YouTube пока поддерживается только в Windows.".to_string(),
        );
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let browser_name = manager
            .active
            .lock()
            .expect("youtube auth mutex poisoned")
            .as_ref()
            .map(|active| active.browser_name.clone())
            .ok_or_else(|| "Сеанс входа не запущен.".to_string())?;
        if !browser_name.eq_ignore_ascii_case(browser.trim()) {
            return Err(
                "Открытое окно авторизации не соответствует выбранному браузеру.".to_string(),
            );
        }

        save_youtube_session(&app, &browser_name, &cookies)?;
        if let Some(active) = manager
            .active
            .lock()
            .expect("youtube auth mutex poisoned")
            .take()
        {
            stop_and_remove_auth_attempt(active);
        }

        Ok(youtube_auth_status(&app))
    }
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

pub fn materialize_youtube_cookies(app: &AppHandle) -> Result<TemporaryCookieFile, String> {
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

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn wait_for_debugger_url(active_port_file: &Path) -> Result<String, String> {
    for _ in 0..100 {
        if let Ok(value) = fs::read_to_string(active_port_file) {
            let mut lines = value.lines();
            if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                if port.chars().all(|character| character.is_ascii_digit())
                    && path.starts_with("/devtools/browser/")
                {
                    return Ok(format!("ws://127.0.0.1:{port}{path}"));
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("Браузер открылся, но программа не смогла подключиться к окну авторизации.".to_string())
}

fn serialize_youtube_cookies(cookies: &[BrowserCookie]) -> Result<String, String> {
    let filtered = cookies
        .iter()
        .filter(|cookie| is_youtube_domain(&cookie.domain))
        .filter(|cookie| cookie_fields_are_safe(cookie))
        .collect::<Vec<_>>();
    let has_account_session = filtered.iter().any(|cookie| {
        matches!(
            cookie.name.as_str(),
            "SAPISID" | "__Secure-1PAPISID" | "__Secure-3PAPISID" | "LOGIN_INFO"
        ) && !cookie.value.is_empty()
    });
    if !has_account_session {
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
    cookies.iter().any(|cookie| {
        is_youtube_domain(&cookie.domain)
            && matches!(
                cookie.name.as_str(),
                "SAPISID" | "__Secure-1PAPISID" | "__Secure-3PAPISID" | "LOGIN_INFO"
            )
            && !cookie.value.is_empty()
    })
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
fn protect_session(data: &[u8]) -> Result<Vec<u8>, String> {
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
fn unprotect_session(data: &[u8]) -> Result<Vec<u8>, String> {
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
fn profile_has_youtube_session(profile_dir: &Path) -> bool {
    [
        profile_dir.join("Default/Network/Cookies"),
        profile_dir.join("Default/Cookies"),
    ]
    .into_iter()
    .filter(|path| path.is_file())
    .any(|path| match cookie_database_has_session(&path) {
        Ok(result) => result,
        Err(_) => copied_cookie_database_has_session(&path),
    })
}

#[cfg(target_os = "windows")]
fn cookie_database_has_session(path: &Path) -> rusqlite::Result<bool> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?
    .query_row(
        "SELECT EXISTS(SELECT 1 FROM cookies WHERE host_key LIKE '%youtube.com' AND name IN ('SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID', 'LOGIN_INFO'))",
        [],
        |row| row.get::<_, bool>(0),
    )
}

#[cfg(target_os = "windows")]
fn copied_cookie_database_has_session(source: &Path) -> bool {
    let temporary_dir = std::env::temp_dir().join(format!(
        "ytloadster-auth-check-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let destination = temporary_dir.join("Cookies");
    let result = (|| {
        fs::create_dir_all(&temporary_dir).ok()?;
        fs::copy(source, &destination).ok()?;
        let source_wal = PathBuf::from(format!("{}-wal", source.to_string_lossy()));
        if source_wal.is_file() {
            let _ = fs::copy(&source_wal, temporary_dir.join("Cookies-wal"));
        }
        cookie_database_has_session(&destination).ok()
    })()
    .unwrap_or(false);
    let _ = fs::remove_dir_all(temporary_dir);
    result
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
fn terminate_browser_process_descendants(root_process_id: u32) {
    terminate_browser_processes(root_process_id, false);
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
async fn wait_for_browser_process_descendants(root_process_id: u32, timeout: Duration) {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if browser_process_tree(root_process_id).len() <= 1 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
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
    fn detects_authenticated_youtube_profile() {
        let profile_dir = std::env::temp_dir().join(format!(
            "ytloadster-auth-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let database_path = profile_dir.join("Default/Network/Cookies");
        fs::create_dir_all(database_path.parent().unwrap()).unwrap();
        let connection = Connection::open(&database_path).unwrap();
        connection
            .execute(
                "CREATE TABLE cookies (host_key TEXT NOT NULL, name TEXT NOT NULL)",
                [],
            )
            .unwrap();
        assert!(!profile_has_youtube_session(&profile_dir));
        connection
            .execute(
                "INSERT INTO cookies (host_key, name) VALUES ('.youtube.com', '__Secure-3PAPISID')",
                [],
            )
            .unwrap();
        assert!(profile_has_youtube_session(&profile_dir));
        drop(connection);
        fs::remove_dir_all(profile_dir).unwrap();
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
    fn webview_auth_requires_a_youtube_account_cookie() {
        let cookies = vec![
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
}
