use crate::downloads::{
    normalize_concurrency, normalize_fragment_concurrency, schedule_pending_downloads,
    DownloadManager,
};
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

const DATABASE_FILE_NAME: &str = "ytloadster.sqlite3";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub default_download_dir: Option<PathBuf>,
    pub ytdlp_path: Option<PathBuf>,
    pub ffmpeg_path: Option<PathBuf>,
    pub ffprobe_path: Option<PathBuf>,
    pub concurrency: u8,
    pub fragment_concurrency: u8,
    pub include_video_technical_details_in_filename: bool,
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
            include_video_technical_details_in_filename: false,
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
    pub include_video_technical_details_in_filename: Option<bool>,
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
            include_video_technical_details_in_filename: get_string_setting(
                &conn,
                "include_video_technical_details_in_filename",
            )?
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false),
        })
    }

    pub fn update_settings(&self, patch: SettingsPatch) -> Result<Settings, String> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
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
        if let Some(include) = patch.include_video_technical_details_in_filename {
            upsert_string_setting(
                &conn,
                "include_video_technical_details_in_filename",
                if include { "true" } else { "false" },
            )?;
        }
        drop(conn);
        self.get_settings()
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
                title TEXT,
                output_path TEXT,
                preset TEXT NOT NULL,
                completed_at TEXT NOT NULL
            );
            "#,
        )
        .map_err(|err| err.to_string())?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
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
pub fn get_settings(storage: State<'_, Storage>) -> Result<Settings, String> {
    storage.get_settings()
}

#[tauri::command]
pub fn update_settings(
    patch: SettingsPatch,
    storage: State<'_, Storage>,
    manager: State<'_, DownloadManager>,
    app: AppHandle,
) -> Result<Settings, String> {
    let settings = storage.update_settings(patch)?;
    manager.set_concurrency(settings.concurrency);
    manager.set_fragment_concurrency(settings.fragment_concurrency);
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

#[cfg(test)]
mod tests {
    use super::*;
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
