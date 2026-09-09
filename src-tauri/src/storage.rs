use crate::downloads::{
    media_signature, normalize_concurrency, normalize_download_retries,
    normalize_file_access_retries, normalize_fragment_concurrency, normalize_fragment_retries,
    schedule_pending_downloads, DownloadManager, DEFAULT_DOWNLOAD_RETRIES,
    DEFAULT_FILE_ACCESS_RETRIES, DEFAULT_FRAGMENT_RETRIES,
};
use crate::power::SleepInhibitor;
use crate::tray::TrayController;
use crate::ytdlp::{DownloadPreset, DownloadRequest, YtdlpRuntimeSettings};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const DATABASE_FILE_NAME: &str = "ytloadster.sqlite3";
const MAX_CUSTOM_USER_AGENT_BYTES: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub default_download_dir: Option<PathBuf>,
    pub ytdlp_path: Option<PathBuf>,
    pub ffmpeg_path: Option<PathBuf>,
    pub ffprobe_path: Option<PathBuf>,
    pub concurrency: u8,
    pub fragment_concurrency: u8,
    pub download_retries: u8,
    pub file_access_retries: u8,
    pub fragment_retries: u8,
    pub custom_user_agent_enabled: bool,
    pub custom_user_agent: String,
    pub include_video_technical_details_in_filename: bool,
    pub playlist_format_selection_mode: String,
    pub prevent_system_sleep_while_downloading: bool,
    pub minimize_to_tray: bool,
}

impl Settings {
    pub fn effective_custom_user_agent(&self) -> Option<String> {
        self.custom_user_agent_enabled
            .then(|| self.custom_user_agent.clone())
            .filter(|value| !value.is_empty())
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_download_dir: None,
            ytdlp_path: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            concurrency: 2,
            fragment_concurrency: 1,
            download_retries: DEFAULT_DOWNLOAD_RETRIES,
            file_access_retries: DEFAULT_FILE_ACCESS_RETRIES,
            fragment_retries: DEFAULT_FRAGMENT_RETRIES,
            custom_user_agent_enabled: false,
            custom_user_agent: String::new(),
            include_video_technical_details_in_filename: false,
            playlist_format_selection_mode: "strict".to_string(),
            prevent_system_sleep_while_downloading: false,
            minimize_to_tray: true,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub default_download_dir: Option<PathBuf>,
    pub ytdlp_path: Option<PathBuf>,
    pub ffmpeg_path: Option<PathBuf>,
    pub ffprobe_path: Option<PathBuf>,
    pub concurrency: Option<u8>,
    pub fragment_concurrency: Option<u8>,
    pub download_retries: Option<u8>,
    pub file_access_retries: Option<u8>,
    pub fragment_retries: Option<u8>,
    pub custom_user_agent_enabled: Option<bool>,
    pub custom_user_agent: Option<String>,
    pub include_video_technical_details_in_filename: Option<bool>,
    pub playlist_format_selection_mode: Option<String>,
    pub prevent_system_sleep_while_downloading: Option<bool>,
    pub minimize_to_tray: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub url: String,
    pub canonical_source: Option<String>,
    pub title: String,
    pub thumbnail: Option<String>,
    pub output_path: Option<PathBuf>,
    pub destination_dir: Option<PathBuf>,
    pub preset: String,
    pub format_label: Option<String>,
    pub file_size_bytes: Option<u64>,
    pub completed_at_ms: Option<u64>,
    pub completed_at_legacy: Option<String>,
    pub media_signature: Option<String>,
    pub request: Option<DownloadRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCheckItem {
    pub client_id: String,
    pub request: DownloadRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDuplicate {
    pub client_id: String,
    pub history_id: String,
}

#[derive(Debug, Clone)]
pub struct Storage {
    conn: Arc<Mutex<Connection>>,
}

impl Storage {
    pub fn open_default(app: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
        let legacy_dirs = legacy_storage_directories();
        let path = prepare_storage_path(&app_data_dir, &legacy_dirs)?;
        Self::open(path)
    }

    pub fn open(path: PathBuf) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        Self::from_connection(conn)
    }

    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|err| err.to_string())?;
        Self::from_connection(conn)
    }

    pub fn get_settings(&self) -> Result<Settings, String> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(Settings {
            default_download_dir: get_path_setting(&conn, "default_download_dir")?,
            ytdlp_path: get_path_setting(&conn, "ytdlp_path")?,
            ffmpeg_path: get_path_setting(&conn, "ffmpeg_path")?,
            ffprobe_path: get_path_setting(&conn, "ffprobe_path")?,
            concurrency: normalize_concurrency(
                get_string_setting(&conn, "concurrency")?
                    .and_then(|value| value.parse::<u8>().ok())
                    .unwrap_or(2),
            ),
            fragment_concurrency: normalize_fragment_concurrency(
                get_string_setting(&conn, "fragment_concurrency")?
                    .and_then(|value| value.parse::<u8>().ok())
                    .unwrap_or(1),
            ),
            download_retries: normalize_download_retries(
                get_string_setting(&conn, "download_retries")?
                    .and_then(|value| value.parse::<u8>().ok())
                    .unwrap_or(DEFAULT_DOWNLOAD_RETRIES),
            ),
            file_access_retries: normalize_file_access_retries(
                get_string_setting(&conn, "file_access_retries")?
                    .and_then(|value| value.parse::<u8>().ok())
                    .unwrap_or(DEFAULT_FILE_ACCESS_RETRIES),
            ),
            fragment_retries: normalize_fragment_retries(
                get_string_setting(&conn, "fragment_retries")?
                    .and_then(|value| value.parse::<u8>().ok())
                    .unwrap_or(DEFAULT_FRAGMENT_RETRIES),
            ),
            custom_user_agent_enabled: get_string_setting(&conn, "custom_user_agent_enabled")?
                .map(|value| value == "true" || value == "1")
                .unwrap_or(false),
            custom_user_agent: normalize_custom_user_agent(
                &get_string_setting(&conn, "custom_user_agent")?.unwrap_or_default(),
            )
            .unwrap_or_default(),
            include_video_technical_details_in_filename: get_string_setting(
                &conn,
                "include_video_technical_details_in_filename",
            )?
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false),
            playlist_format_selection_mode: normalize_playlist_format_selection_mode(
                get_string_setting(&conn, "playlist_format_selection_mode")?.as_deref(),
            )
            .to_string(),
            prevent_system_sleep_while_downloading: get_string_setting(
                &conn,
                "prevent_system_sleep_while_downloading",
            )?
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false),
            minimize_to_tray: get_string_setting(&conn, "minimize_to_tray")?
                .map(|value| value == "true" || value == "1")
                .unwrap_or(true),
        })
    }

    pub fn update_settings(&self, patch: SettingsPatch) -> Result<Settings, String> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let current_custom_user_agent =
            get_string_setting(&conn, "custom_user_agent")?.unwrap_or_default();
        let next_custom_user_agent = patch
            .custom_user_agent
            .as_deref()
            .unwrap_or(&current_custom_user_agent);
        let normalized_custom_user_agent = normalize_custom_user_agent(next_custom_user_agent)?;
        let current_custom_user_agent_enabled =
            get_string_setting(&conn, "custom_user_agent_enabled")?
                .map(|value| value == "true" || value == "1")
                .unwrap_or(false);
        let next_custom_user_agent_enabled = patch
            .custom_user_agent_enabled
            .unwrap_or(current_custom_user_agent_enabled);
        if next_custom_user_agent_enabled && normalized_custom_user_agent.is_empty() {
            return Err("settings-error:custom-user-agent-required".to_string());
        }
        upsert_path_setting(
            &conn,
            "default_download_dir",
            patch.default_download_dir.as_ref(),
        )?;
        upsert_path_setting(&conn, "ytdlp_path", patch.ytdlp_path.as_ref())?;
        upsert_path_setting(&conn, "ffmpeg_path", patch.ffmpeg_path.as_ref())?;
        upsert_path_setting(&conn, "ffprobe_path", patch.ffprobe_path.as_ref())?;
        if let Some(concurrency) = patch.concurrency {
            upsert_string_setting(
                &conn,
                "concurrency",
                &normalize_concurrency(concurrency).to_string(),
            )?;
        }
        if let Some(fragment_concurrency) = patch.fragment_concurrency {
            upsert_string_setting(
                &conn,
                "fragment_concurrency",
                &normalize_fragment_concurrency(fragment_concurrency).to_string(),
            )?;
        }
        if let Some(download_retries) = patch.download_retries {
            upsert_string_setting(
                &conn,
                "download_retries",
                &normalize_download_retries(download_retries).to_string(),
            )?;
        }
        if let Some(file_access_retries) = patch.file_access_retries {
            upsert_string_setting(
                &conn,
                "file_access_retries",
                &normalize_file_access_retries(file_access_retries).to_string(),
            )?;
        }
        if let Some(fragment_retries) = patch.fragment_retries {
            upsert_string_setting(
                &conn,
                "fragment_retries",
                &normalize_fragment_retries(fragment_retries).to_string(),
            )?;
        }
        if patch.custom_user_agent.is_some() {
            upsert_string_setting(&conn, "custom_user_agent", &normalized_custom_user_agent)?;
        }
        if let Some(enabled) = patch.custom_user_agent_enabled {
            upsert_string_setting(
                &conn,
                "custom_user_agent_enabled",
                if enabled { "true" } else { "false" },
            )?;
        }
        if let Some(include) = patch.include_video_technical_details_in_filename {
            upsert_string_setting(
                &conn,
                "include_video_technical_details_in_filename",
                if include { "true" } else { "false" },
            )?;
        }
        if let Some(mode) = patch.playlist_format_selection_mode {
            upsert_string_setting(
                &conn,
                "playlist_format_selection_mode",
                normalize_playlist_format_selection_mode(Some(&mode)),
            )?;
        }
        if let Some(enabled) = patch.prevent_system_sleep_while_downloading {
            upsert_string_setting(
                &conn,
                "prevent_system_sleep_while_downloading",
                if enabled { "true" } else { "false" },
            )?;
        }
        if let Some(enabled) = patch.minimize_to_tray {
            upsert_string_setting(
                &conn,
                "minimize_to_tray",
                if enabled { "true" } else { "false" },
            )?;
        }
        drop(conn);
        self.get_settings()
    }

    pub fn record_completed_download(
        &self,
        job_id: u64,
        request: &DownloadRequest,
        output_path: &Path,
    ) -> Result<HistoryItem, String> {
        let completed_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis() as u64;
        let id = format!("{completed_at_ms}-{job_id}");
        let mut safe_request = request.clone();
        safe_request.cookie_source = None;
        let request_json =
            serde_json::to_string(&safe_request).map_err(|error| error.to_string())?;
        let signature = media_signature(request);
        let file_size_bytes = fs::metadata(output_path)
            .ok()
            .map(|metadata| metadata.len());
        let file_size_db = file_size_bytes.and_then(|value| i64::try_from(value).ok());
        let completed_at_db = i64::try_from(completed_at_ms).unwrap_or(i64::MAX);
        let preset = preset_name(&request.preset).to_string();
        let canonical_source = request
            .canonical_source
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| Some(request.url.clone()));
        let title = request
            .title
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_default();
        let output_path_text = output_path.to_string_lossy().to_string();
        let destination_dir_text = request.destination_dir.to_string_lossy().to_string();
        let completed_at_text = completed_at_ms.to_string();

        let conn = self.conn.lock().expect("storage mutex poisoned");
        let existing_id = conn
            .query_row(
                "SELECT id FROM history WHERE output_path = ?1 ORDER BY rowid DESC LIMIT 1",
                params![&output_path_text],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(existing_id) = existing_id {
            drop(conn);
            return self
                .history_item(&existing_id)?
                .ok_or_else(|| "Не удалось прочитать сохранённую запись истории.".to_string());
        }
        conn.execute(
            "INSERT INTO history (
                id, url, canonical_source, title, thumbnail, output_path, destination_dir,
                preset, format_label, file_size_bytes, completed_at, completed_at_ms,
                media_signature, request_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                &id,
                &request.url,
                canonical_source.as_deref(),
                &title,
                request.thumbnail.as_deref(),
                &output_path_text,
                &destination_dir_text,
                &preset,
                request.format_label.as_deref(),
                file_size_db,
                &completed_at_text,
                completed_at_db,
                signature.as_deref(),
                &request_json,
            ],
        )
        .map_err(|error| error.to_string())?;
        drop(conn);

        self.history_item(&id)?
            .ok_or_else(|| "Не удалось прочитать сохранённую запись истории.".to_string())
    }

    pub fn get_history(&self) -> Result<Vec<HistoryItem>, String> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut statement = conn
            .prepare(
                "SELECT id, url, canonical_source, title, thumbnail, output_path,
                        destination_dir, preset, format_label, file_size_bytes,
                        completed_at, completed_at_ms, media_signature, request_json
                 FROM history
                 ORDER BY COALESCE(completed_at_ms, 0) DESC, completed_at DESC, rowid DESC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], history_item_from_row)
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn remove_history_item(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute("DELETE FROM history WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn clear_history(&self) -> Result<(), String> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute("DELETE FROM history", [])
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn check_history_duplicates(
        &self,
        items: Vec<HistoryCheckItem>,
    ) -> Result<Vec<HistoryDuplicate>, String> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let mut statement = conn
            .prepare(
                "SELECT id FROM history
                 WHERE media_signature = ?1
                 ORDER BY COALESCE(completed_at_ms, 0) DESC, rowid DESC
                 LIMIT 1",
            )
            .map_err(|error| error.to_string())?;
        let mut duplicates = Vec::new();
        for item in items {
            let Some(signature) = media_signature(&item.request) else {
                continue;
            };
            let history_id = statement
                .query_row(params![signature], |row| row.get::<_, String>(0))
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some(history_id) = history_id {
                duplicates.push(HistoryDuplicate {
                    client_id: item.client_id,
                    history_id,
                });
            }
        }
        Ok(duplicates)
    }

    fn history_item(&self, id: &str) -> Result<Option<HistoryItem>, String> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.query_row(
            "SELECT id, url, canonical_source, title, thumbnail, output_path,
                    destination_dir, preset, format_label, file_size_bytes,
                    completed_at, completed_at_ms, media_signature, request_json
             FROM history WHERE id = ?1",
            params![id],
            history_item_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())
    }

    fn from_connection(conn: Connection) -> Result<Self, String> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                canonical_source TEXT,
                title TEXT,
                thumbnail TEXT,
                output_path TEXT,
                destination_dir TEXT,
                preset TEXT NOT NULL,
                format_label TEXT,
                file_size_bytes INTEGER,
                completed_at TEXT NOT NULL,
                completed_at_ms INTEGER,
                media_signature TEXT,
                request_json TEXT
            );
            "#,
        )
        .map_err(|err| err.to_string())?;
        ensure_history_schema(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }
}

fn ensure_history_schema(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare("PRAGMA table_info(history)")
        .map_err(|error| error.to_string())?;
    let existing = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<std::collections::HashSet<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);

    for (name, definition) in [
        ("canonical_source", "TEXT"),
        ("thumbnail", "TEXT"),
        ("destination_dir", "TEXT"),
        ("format_label", "TEXT"),
        ("file_size_bytes", "INTEGER"),
        ("completed_at_ms", "INTEGER"),
        ("media_signature", "TEXT"),
        ("request_json", "TEXT"),
    ] {
        if !existing.contains(name) {
            conn.execute(
                &format!("ALTER TABLE history ADD COLUMN {name} {definition}"),
                [],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_history_completed_at_ms
             ON history(completed_at_ms DESC);
         CREATE INDEX IF NOT EXISTS idx_history_media_signature
             ON history(media_signature);
         PRAGMA user_version = 2;",
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn history_item_from_row(row: &Row<'_>) -> rusqlite::Result<HistoryItem> {
    let request_json = row.get::<_, Option<String>>(13)?;
    let request = request_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<DownloadRequest>(json).ok())
        .map(|mut request| {
            request.cookie_source = None;
            request
        });
    let completed_at_legacy = row.get::<_, Option<String>>(10)?;
    let completed_at_ms = row
        .get::<_, Option<i64>>(11)?
        .and_then(|value| u64::try_from(value).ok())
        .or_else(|| {
            completed_at_legacy
                .as_deref()
                .and_then(|value| value.parse::<u64>().ok())
        });
    let title = row
        .get::<_, Option<String>>(3)?
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_default();
    Ok(HistoryItem {
        id: row.get(0)?,
        url: row.get(1)?,
        canonical_source: row.get(2)?,
        title,
        thumbnail: row.get(4)?,
        output_path: row.get::<_, Option<String>>(5)?.map(PathBuf::from),
        destination_dir: row.get::<_, Option<String>>(6)?.map(PathBuf::from),
        preset: row.get(7)?,
        format_label: row.get(8)?,
        file_size_bytes: row
            .get::<_, Option<i64>>(9)?
            .and_then(|value| u64::try_from(value).ok()),
        completed_at_ms,
        completed_at_legacy,
        media_signature: row.get(12)?,
        request,
    })
}

fn preset_name(preset: &DownloadPreset) -> &'static str {
    match preset {
        DownloadPreset::BestVideo => "bestVideo",
        DownloadPreset::Mp4Video => "mp4Video",
        DownloadPreset::AudioMp3 => "audioMp3",
        DownloadPreset::AudioM4a => "audioM4a",
        DownloadPreset::AudioOpus => "audioOpus",
        DownloadPreset::Subtitles => "subtitles",
    }
}

fn legacy_storage_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        directories.push(current_dir.clone());
        directories.push(current_dir.join("src-tauri"));
    }

    if let Some(executable_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        directories.push(executable_dir);
    }

    directories
        .into_iter()
        .fold(Vec::new(), |mut unique, directory| {
            if !unique.contains(&directory) {
                unique.push(directory);
            }
            unique
        })
}

fn prepare_storage_path(app_data_dir: &Path, legacy_dirs: &[PathBuf]) -> Result<PathBuf, String> {
    fs::create_dir_all(app_data_dir).map_err(|err| {
        format!(
            "не удалось создать каталог данных приложения {}: {err}",
            app_data_dir.display()
        )
    })?;

    let destination = app_data_dir.join(DATABASE_FILE_NAME);
    if destination.exists() {
        return Ok(destination);
    }

    for legacy_path in legacy_dirs
        .iter()
        .map(|directory| directory.join(DATABASE_FILE_NAME))
    {
        if legacy_path.is_file() && legacy_path != destination {
            fs::copy(&legacy_path, &destination).map_err(|err| {
                format!(
                    "не удалось перенести настройки из {} в {}: {err}",
                    legacy_path.display(),
                    destination.display()
                )
            })?;
            break;
        }
    }

    Ok(destination)
}

#[tauri::command]
pub fn get_history(storage: State<'_, Storage>) -> Result<Vec<HistoryItem>, String> {
    storage.get_history()
}

#[tauri::command]
pub fn remove_history_item(id: String, storage: State<'_, Storage>) -> Result<(), String> {
    storage.remove_history_item(&id)
}

#[tauri::command]
pub fn clear_history(storage: State<'_, Storage>) -> Result<(), String> {
    storage.clear_history()
}

#[tauri::command]
pub fn check_history_duplicates(
    items: Vec<HistoryCheckItem>,
    storage: State<'_, Storage>,
) -> Result<Vec<HistoryDuplicate>, String> {
    storage.check_history_duplicates(items)
}

#[tauri::command]
pub fn get_settings(storage: State<'_, Storage>) -> Result<Settings, String> {
    storage.get_settings()
}

#[tauri::command]
pub fn update_settings(
    patch: SettingsPatch,
    storage: State<'_, Storage>,
    manager: State<'_, DownloadManager>,
    ytdlp_runtime_settings: State<'_, YtdlpRuntimeSettings>,
    sleep_inhibitor: State<'_, SleepInhibitor>,
    tray: State<'_, TrayController>,
    app: AppHandle,
) -> Result<Settings, String> {
    let settings = storage.update_settings(patch)?;
    manager.set_concurrency(settings.concurrency);
    manager.set_fragment_concurrency(settings.fragment_concurrency);
    manager.set_retry_settings(
        settings.download_retries,
        settings.file_access_retries,
        settings.fragment_retries,
    );
    ytdlp_runtime_settings.set_custom_user_agent(settings.effective_custom_user_agent());
    sleep_inhibitor.set_enabled(settings.prevent_system_sleep_while_downloading);
    tray.set_enabled(settings.minimize_to_tray);
    schedule_pending_downloads(manager.inner().clone(), app);
    Ok(settings)
}

#[tauri::command]
pub fn get_default_download_dir() -> Result<PathBuf, String> {
    default_download_dir()
}

pub fn default_download_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let user_profile =
            std::env::var_os("USERPROFILE").ok_or_else(|| "USERPROFILE не задан".to_string())?;
        Ok(PathBuf::from(user_profile).join("Downloads"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME")
            .map(|home| PathBuf::from(home).join("Downloads"))
            .ok_or_else(|| "HOME не задан".to_string())
    }
}

fn get_path_setting(conn: &Connection, key: &str) -> Result<Option<PathBuf>, String> {
    Ok(get_string_setting(conn, key)?.map(PathBuf::from))
}

fn get_string_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut statement = conn
        .prepare("SELECT value FROM settings WHERE key = ?1")
        .map_err(|err| err.to_string())?;
    let mut rows = statement
        .query(params![key])
        .map_err(|err| err.to_string())?;
    rows.next()
        .map_err(|err| err.to_string())?
        .map(|row| row.get::<_, String>(0).map_err(|err| err.to_string()))
        .transpose()
}

fn upsert_path_setting(
    conn: &Connection,
    key: &str,
    value: Option<&PathBuf>,
) -> Result<(), String> {
    if let Some(value) = value {
        upsert_string_setting(conn, key, &value.to_string_lossy())
    } else {
        Ok(())
    }
}

fn upsert_string_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

fn normalize_custom_user_agent(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.len() > MAX_CUSTOM_USER_AGENT_BYTES {
        return Err("settings-error:custom-user-agent-too-long".to_string());
    }
    if value.chars().any(char::is_control) {
        return Err("settings-error:custom-user-agent-invalid".to_string());
    }
    Ok(value.to_string())
}

fn normalize_playlist_format_selection_mode(value: Option<&str>) -> &'static str {
    match value {
        Some("adaptive") => "adaptive",
        _ => "strict",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ytdlp::{CookieSource, VideoDownloadProfile, VideoTechnicalDetails};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn saves_and_loads_default_download_directory() {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .update_settings(SettingsPatch {
                default_download_dir: Some(PathBuf::from("C:/Downloads")),
                ..SettingsPatch::default()
            })
            .unwrap();

        let settings = storage.get_settings().unwrap();

        assert_eq!(
            settings.default_download_dir,
            Some(PathBuf::from("C:/Downloads"))
        );
    }

    #[test]
    fn saves_and_loads_download_concurrency() {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .update_settings(SettingsPatch {
                concurrency: Some(4),
                ..SettingsPatch::default()
            })
            .unwrap();

        let settings = storage.get_settings().unwrap();

        assert_eq!(settings.concurrency, 4);
    }

    #[test]
    fn defaults_to_two_simultaneous_downloads() {
        let storage = Storage::open_in_memory().unwrap();

        assert_eq!(storage.get_settings().unwrap().concurrency, 2);
    }

    #[test]
    fn sleep_blocking_is_off_and_minimize_to_tray_is_on_by_default() {
        let storage = Storage::open_in_memory().unwrap();
        let settings = storage.get_settings().unwrap();

        assert!(!settings.prevent_system_sleep_while_downloading);
        assert!(settings.minimize_to_tray);
    }

    #[test]
    fn persists_sleep_blocking_and_minimize_to_tray_preferences() {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .update_settings(SettingsPatch {
                prevent_system_sleep_while_downloading: Some(true),
                minimize_to_tray: Some(false),
                ..SettingsPatch::default()
            })
            .unwrap();

        let settings = storage.get_settings().unwrap();
        assert!(settings.prevent_system_sleep_while_downloading);
        assert!(!settings.minimize_to_tray);
    }

    #[test]
    fn saves_and_loads_fragment_concurrency() {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .update_settings(SettingsPatch {
                fragment_concurrency: Some(8),
                ..SettingsPatch::default()
            })
            .unwrap();

        let settings = storage.get_settings().unwrap();

        assert_eq!(settings.fragment_concurrency, 8);
    }

    #[test]
    fn retry_settings_use_ytdlp_defaults_and_are_persisted() {
        let storage = Storage::open_in_memory().unwrap();
        let defaults = storage.get_settings().unwrap();
        assert_eq!(defaults.download_retries, 10);
        assert_eq!(defaults.file_access_retries, 3);
        assert_eq!(defaults.fragment_retries, 10);

        storage
            .update_settings(SettingsPatch {
                download_retries: Some(25),
                file_access_retries: Some(8),
                fragment_retries: Some(18),
                ..SettingsPatch::default()
            })
            .unwrap();

        let settings = storage.get_settings().unwrap();
        assert_eq!(settings.download_retries, 25);
        assert_eq!(settings.file_access_retries, 8);
        assert_eq!(settings.fragment_retries, 18);
    }

    #[test]
    fn retry_settings_use_separate_practical_limits() {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .update_settings(SettingsPatch {
                download_retries: Some(255),
                file_access_retries: Some(101),
                fragment_retries: Some(200),
                ..SettingsPatch::default()
            })
            .unwrap();

        let settings = storage.get_settings().unwrap();
        assert_eq!(settings.download_retries, 30);
        assert_eq!(settings.file_access_retries, 10);
        assert_eq!(settings.fragment_retries, 30);
    }

    #[test]
    fn saves_and_enables_a_valid_custom_user_agent() {
        let storage = Storage::open_in_memory().unwrap();
        storage
            .update_settings(SettingsPatch {
                custom_user_agent: Some("  Mozilla/5.0 TestBrowser/1.0  ".to_string()),
                custom_user_agent_enabled: Some(true),
                ..SettingsPatch::default()
            })
            .unwrap();

        let settings = storage.get_settings().unwrap();
        assert!(settings.custom_user_agent_enabled);
        assert_eq!(settings.custom_user_agent, "Mozilla/5.0 TestBrowser/1.0");
        assert_eq!(
            settings.effective_custom_user_agent().as_deref(),
            Some("Mozilla/5.0 TestBrowser/1.0")
        );
    }

    #[test]
    fn rejects_an_empty_or_invalid_enabled_custom_user_agent() {
        let storage = Storage::open_in_memory().unwrap();
        assert!(storage
            .update_settings(SettingsPatch {
                custom_user_agent_enabled: Some(true),
                ..SettingsPatch::default()
            })
            .is_err());
        assert!(storage
            .update_settings(SettingsPatch {
                custom_user_agent: Some("Mozilla/5.0\r\nInjected: value".to_string()),
                ..SettingsPatch::default()
            })
            .is_err());
    }

    #[test]
    fn technical_video_filename_details_are_disabled_by_default_and_persisted() {
        let storage = Storage::open_in_memory().unwrap();
        assert!(
            !storage
                .get_settings()
                .unwrap()
                .include_video_technical_details_in_filename
        );

        storage
            .update_settings(SettingsPatch {
                include_video_technical_details_in_filename: Some(true),
                ..SettingsPatch::default()
            })
            .unwrap();

        let settings = storage.get_settings().unwrap();
        assert!(settings.include_video_technical_details_in_filename);
        assert_eq!(settings.concurrency, 2);
        assert_eq!(settings.fragment_concurrency, 1);
    }

    #[test]
    fn playlist_format_selection_is_strict_by_default_and_persists_adaptive_mode() {
        let storage = Storage::open_in_memory().unwrap();
        assert_eq!(
            storage
                .get_settings()
                .unwrap()
                .playlist_format_selection_mode,
            "strict"
        );

        storage
            .update_settings(SettingsPatch {
                playlist_format_selection_mode: Some("adaptive".to_string()),
                ..SettingsPatch::default()
            })
            .unwrap();
        assert_eq!(
            storage
                .get_settings()
                .unwrap()
                .playlist_format_selection_mode,
            "adaptive"
        );

        storage
            .update_settings(SettingsPatch {
                playlist_format_selection_mode: Some("unknown".to_string()),
                ..SettingsPatch::default()
            })
            .unwrap();
        assert_eq!(
            storage
                .get_settings()
                .unwrap()
                .playlist_format_selection_mode,
            "strict"
        );
    }

    #[test]
    fn default_download_directory_is_absolute() {
        let path = default_download_dir().unwrap();

        assert!(path.is_absolute());
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("Downloads")
        );
    }

    #[test]
    fn prepares_application_data_storage_and_copies_legacy_settings() {
        let root = unique_temp_dir();
        let legacy_dir = root.join("legacy");
        let app_data_dir = root.join("application-data");
        fs::create_dir_all(&legacy_dir).unwrap();

        let legacy_path = legacy_dir.join(DATABASE_FILE_NAME);
        let legacy_storage = Storage::open(legacy_path.clone()).unwrap();
        legacy_storage
            .update_settings(SettingsPatch {
                concurrency: Some(6),
                ..SettingsPatch::default()
            })
            .unwrap();
        drop(legacy_storage);

        let migrated_path = prepare_storage_path(&app_data_dir, &[legacy_dir]).unwrap();
        let migrated_storage = Storage::open(migrated_path.clone()).unwrap();

        assert_eq!(migrated_path, app_data_dir.join(DATABASE_FILE_NAME));
        assert_eq!(migrated_storage.get_settings().unwrap().concurrency, 6);
        assert!(legacy_path.exists());
    }

    #[test]
    fn stores_reads_checks_and_removes_safe_history_records() {
        let root = unique_temp_dir();
        let output_path = root.join("finished.mp4");
        fs::write(&output_path, b"finished-file").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        let request = history_request(&root);

        let saved = storage
            .record_completed_download(7, &request, &output_path)
            .unwrap();

        assert_eq!(saved.file_size_bytes, Some(13));
        assert_eq!(saved.output_path, Some(output_path.clone()));
        assert_eq!(
            saved
                .request
                .as_ref()
                .and_then(|item| item.cookie_source.as_ref()),
            None
        );
        assert!(saved.media_signature.is_some());
        assert!(saved.completed_at_ms.is_some());
        assert_eq!(storage.get_history().unwrap(), vec![saved.clone()]);
        let repeated = storage
            .record_completed_download(7, &request, &output_path)
            .unwrap();
        assert_eq!(repeated.id, saved.id);
        assert_eq!(storage.get_history().unwrap().len(), 1);
        assert_eq!(
            storage
                .check_history_duplicates(vec![HistoryCheckItem {
                    client_id: "row-7".to_string(),
                    request: request.clone(),
                }])
                .unwrap(),
            vec![HistoryDuplicate {
                client_id: "row-7".to_string(),
                history_id: saved.id.clone(),
            }]
        );

        storage.remove_history_item(&saved.id).unwrap();
        assert!(storage.get_history().unwrap().is_empty());
        assert!(output_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clears_history_without_deleting_downloaded_files() {
        let root = unique_temp_dir();
        let output_path = root.join("keep.mp4");
        fs::write(&output_path, b"keep").unwrap();
        let storage = Storage::open_in_memory().unwrap();
        storage
            .record_completed_download(8, &history_request(&root), &output_path)
            .unwrap();

        storage.clear_history().unwrap();

        assert!(storage.get_history().unwrap().is_empty());
        assert!(output_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migrates_the_legacy_history_table_without_losing_rows() {
        let root = unique_temp_dir();
        let database_path = root.join("legacy.sqlite3");
        let connection = Connection::open(&database_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 CREATE TABLE history (
                     id TEXT PRIMARY KEY,
                     url TEXT NOT NULL,
                     title TEXT,
                     output_path TEXT,
                     preset TEXT NOT NULL,
                     completed_at TEXT NOT NULL
                 );
                 INSERT INTO history (id, url, title, output_path, preset, completed_at)
                 VALUES ('legacy-1', 'https://youtu.be/legacy', 'Legacy item', 'D:/legacy.mp4', 'bestVideo', '1710000000000');",
            )
            .unwrap();
        drop(connection);

        let storage = Storage::open(database_path).unwrap();
        let history = storage.get_history().unwrap();

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "legacy-1");
        assert_eq!(history[0].completed_at_ms, Some(1_710_000_000_000));
        assert!(history[0].request.is_none());
        let schema_version: u32 = storage
            .conn
            .lock()
            .unwrap()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(schema_version, 2);
        drop(storage);
        fs::remove_dir_all(root).unwrap();
    }

    fn history_request(destination_dir: &Path) -> DownloadRequest {
        DownloadRequest {
            url: "https://youtu.be/history".to_string(),
            canonical_source: Some("https://youtube.com/watch?v=history".to_string()),
            title: Some("History item".to_string()),
            thumbnail: Some("https://i.ytimg.com/history.jpg".to_string()),
            preset: DownloadPreset::Mp4Video,
            format_id: Some("137".to_string()),
            audio_format_id: Some("140".to_string()),
            video_profile: Some(VideoDownloadProfile::Custom),
            format_label: Some("MP4 1080p H.264 + AAC".to_string()),
            include_video_technical_details_in_filename: true,
            video_technical_details: Some(VideoTechnicalDetails {
                height: Some(1080),
                fps: Some(30),
                codec: Some("avc1".to_string()),
                dynamic_range: Some("SDR".to_string()),
                requested_container: Some("mp4".to_string()),
            }),
            destination_dir: destination_dir.to_path_buf(),
            cookie_source: Some(CookieSource::Browser {
                browser: "chrome".to_string(),
                profile: Some("Default".to_string()),
            }),
            audio_bitrate: None,
            audio_channels: None,
            embed_metadata: None,
            embed_thumbnail: None,
            subtitle: None,
        }
    }

    fn unique_temp_dir() -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ytloadster-storage-test-{}-{now}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
