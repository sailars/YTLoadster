use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::{ACCEPT, CACHE_CONTROL};
use serde::Deserialize;
use sha2::{Digest, Sha256};
#[cfg(not(target_os = "windows"))]
use tauri::Manager;
use tauri::{AppHandle, State};
use tokio::process::Command;

use crate::tools::{discover_tools, version_numbers, ToolConfig, ToolEnvironment};

const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;
const MAX_TOOL_BYTES: u64 = 180 * 1024 * 1024;
const MAX_FFMPEG_BYTES: u64 = 700 * 1024 * 1024;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Default)]
pub struct ComponentUpdateLock(AtomicBool);

struct InstallationGuard<'a>(&'a AtomicBool);

impl Drop for InstallationGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentId {
    Ytdlp,
    Deno,
    Ffmpeg,
}

impl ComponentId {
    const ALL: [Self; 3] = [Self::Ytdlp, Self::Deno, Self::Ffmpeg];

    #[cfg(not(target_os = "windows"))]
    fn folder(self) -> &'static str {
        match self {
            Self::Ytdlp => "ytdlp",
            Self::Deno => "deno",
            Self::Ffmpeg => "ffmpeg",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentUpdateStatus {
    pub id: ComponentId,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub state: &'static str,
    pub source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
}

struct Source {
    version: String,
    release_url: String,
    asset: GitHubAsset,
    sha256: [u8; 32],
}

#[tauri::command]
pub async fn check_component_updates(app: AppHandle) -> Vec<ComponentUpdateStatus> {
    let env = ToolEnvironment::current_for_app(&app);
    let inventory = discover_tools(ToolConfig::default(), env);
    let client = match http_client(&app) {
        Ok(client) => client,
        Err(_) => {
            return ComponentId::ALL
                .into_iter()
                .map(|id| unavailable(id, None))
                .collect()
        }
    };
    let mut results = Vec::with_capacity(3);
    for id in ComponentId::ALL {
        let path = component_path(id, &inventory);
        let current = match path {
            Some(path) => read_version(path, id).await.ok(),
            None => None,
        };
        let status = match latest_source(&client, id).await {
            Ok(source) => status_for_source(id, current, &source),
            Err(_) => unavailable(id, current),
        };
        results.push(status);
    }
    results
}

#[tauri::command]
pub async fn install_component_update(
    app: AppHandle,
    lock: State<'_, ComponentUpdateLock>,
    id: ComponentId,
) -> Result<String, String> {
    lock.0
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "другое обновление компонента ещё выполняется".to_string())?;
    let _guard = InstallationGuard(&lock.0);
    let client = http_client(&app)?;
    let source = latest_source(&client, id).await?;
    let env = ToolEnvironment::current_for_app(&app);
    #[cfg(target_os = "windows")]
    let root = env.app_tools_dir.clone();
    #[cfg(not(target_os = "windows"))]
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| install_error())?
        .join("components")
        .join(id.folder());
    let inventory = discover_tools(ToolConfig::default(), env);
    if let Some(path) = component_path(id, &inventory) {
        if let Ok(current) = read_version(path, id).await {
            if !is_newer(&source.version, &current) {
                return Ok(current);
            }
        }
    }

    fs::create_dir_all(&root).map_err(|_| install_error())?;
    #[cfg(not(target_os = "windows"))]
    let final_dir = root.join(&source.version);
    #[cfg(not(target_os = "windows"))]
    if final_dir.exists() {
        return Err(install_error());
    }
    let staging = Staging::new(&root)?;
    let archive = staging.path.join("download");
    download_verified(&client, &source, &archive, id).await?;
    let payload = staging.path.join("payload");
    fs::create_dir(&payload).map_err(|_| install_error())?;
    match id {
        ComponentId::Ytdlp => {
            let name = if cfg!(target_os = "windows") {
                "yt-dlp.exe"
            } else {
                "yt-dlp_macos"
            };
            fs::rename(&archive, payload.join(name)).map_err(|_| install_error())?;
        }
        ComponentId::Deno => extract_deno(&archive, &payload).await?,
        ComponentId::Ffmpeg => extract_ffmpeg(&archive, &payload).await?,
    }
    make_executable_if_unix(&payload, id)?;
    validate_payload(&payload, id, &source.version).await?;
    #[cfg(target_os = "windows")]
    activate_windows_payload(&payload, &root, id)?;
    #[cfg(not(target_os = "windows"))]
    fs::rename(&payload, &final_dir).map_err(|_| install_error())?;
    Ok(source.version)
}

#[cfg(target_os = "windows")]
fn activate_windows_payload(payload: &Path, root: &Path, id: ComponentId) -> Result<(), String> {
    let (incoming, target) = match id {
        ComponentId::Ytdlp => (payload.join("yt-dlp.exe"), root.join("yt-dlp.exe")),
        ComponentId::Deno => (payload.join("deno.exe"), root.join("deno.exe")),
        ComponentId::Ffmpeg => (payload.to_path_buf(), root.join("ffmpeg")),
    };
    replace_path_with_backup(&incoming, &target)
}

#[cfg(target_os = "windows")]
fn replace_path_with_backup(incoming: &Path, target: &Path) -> Result<(), String> {
    replace_path_with_backup_using(incoming, target, |from, to| fs::rename(from, to))
}

#[cfg(target_os = "windows")]
fn replace_path_with_backup_using(
    incoming: &Path,
    target: &Path,
    move_incoming: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    let incoming_type = fs::symlink_metadata(incoming)
        .map_err(|_| install_error())?
        .file_type();
    if incoming_type.is_symlink() || (!incoming_type.is_file() && !incoming_type.is_dir()) {
        return Err(install_error());
    }
    let file_name = target.file_name().ok_or_else(install_error)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| install_error())?
        .as_nanos();
    let backup = target.with_file_name(format!(
        ".{}.backup-{}-{stamp}",
        file_name.to_string_lossy(),
        std::process::id()
    ));
    let had_previous = target.exists();
    if had_previous {
        let previous_type = fs::symlink_metadata(target)
            .map_err(|_| install_error())?
            .file_type();
        if previous_type.is_symlink() || previous_type.is_dir() != incoming_type.is_dir() {
            return Err(install_error());
        }
        fs::rename(target, &backup).map_err(|_| install_error())?;
    }
    if move_incoming(incoming, target).is_err() {
        if had_previous && fs::rename(&backup, target).is_err() {
            return Err(format!(
                "не удалось заменить компонент и восстановить прежний файл; резервная копия: {}",
                backup.display()
            ));
        }
        return Err(install_error());
    }
    if had_previous {
        if incoming_type.is_dir() {
            let _ = fs::remove_dir_all(&backup);
        } else {
            let _ = fs::remove_file(&backup);
        }
    }
    Ok(())
}

fn component_path<'a>(
    id: ComponentId,
    inventory: &'a crate::tools::ToolInventory,
) -> Option<&'a Path> {
    match id {
        ComponentId::Ytdlp => inventory.ytdlp.path.as_deref(),
        ComponentId::Deno => (inventory.js_runtime.name == "deno")
            .then_some(inventory.js_runtime.path.as_deref())
            .flatten(),
        ComponentId::Ffmpeg => inventory.ffmpeg.path.as_deref(),
    }
}

fn unavailable(id: ComponentId, current_version: Option<String>) -> ComponentUpdateStatus {
    ComponentUpdateStatus {
        id,
        current_version,
        latest_version: None,
        state: "unavailable",
        source_url: None,
    }
}

fn status_for_source(
    id: ComponentId,
    current_version: Option<String>,
    source: &Source,
) -> ComponentUpdateStatus {
    let available = current_version
        .as_deref()
        .is_none_or(|current| is_newer(&source.version, current));
    ComponentUpdateStatus {
        id,
        current_version,
        latest_version: Some(source.version.clone()),
        state: if available { "available" } else { "upToDate" },
        source_url: Some(source.release_url.clone()),
    }
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (version_numbers(latest), version_numbers(current)) {
        (Some(latest), Some(current)) => latest > current,
        _ => false,
    }
}

fn http_client(app: &AppHandle) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(300))
        .user_agent(format!("YTLoadster/{}", app.package_info().version))
        .build()
        .map_err(|_| check_error())
}

async fn latest_source(client: &reqwest::Client, id: ComponentId) -> Result<Source, String> {
    match id {
        ComponentId::Ytdlp => {
            let repo = "yt-dlp/yt-dlp";
            let release: GitHubRelease = github_json(
                client,
                &format!("https://api.github.com/repos/{repo}/releases/latest"),
            )
            .await?;
            let name = if cfg!(target_os = "windows") {
                "yt-dlp.exe"
            } else {
                "yt-dlp_macos"
            };
            let version = release.tag_name.clone();
            source_for_asset(release, repo, version, name)
        }
        ComponentId::Deno => {
            let repo = "denoland/deno";
            let release: GitHubRelease = github_json(
                client,
                &format!("https://api.github.com/repos/{repo}/releases/latest"),
            )
            .await?;
            let target = match (std::env::consts::OS, std::env::consts::ARCH) {
                ("windows", "x86_64") => "deno-x86_64-pc-windows-msvc.zip",
                ("macos", "x86_64") => "deno-x86_64-apple-darwin.zip",
                ("macos", "aarch64") => "deno-aarch64-apple-darwin.zip",
                _ => return Err(check_error()),
            };
            let version = release.tag_name.trim_start_matches('v').to_string();
            source_for_asset(release, repo, version, target)
        }
        ComponentId::Ffmpeg if cfg!(target_os = "windows") => {
            let repo = "BtbN/FFmpeg-Builds";
            let release: GitHubRelease = github_json(
                client,
                &format!("https://api.github.com/repos/{repo}/releases/latest"),
            )
            .await?;
            let (version, name) = select_windows_ffmpeg_asset(&release).ok_or_else(check_error)?;
            source_for_asset(release, repo, version, &name)
        }
        ComponentId::Ffmpeg if cfg!(target_os = "macos") => {
            let repo = "sailars/YTLoadster";
            let releases: Vec<GitHubRelease> = github_json(
                client,
                &format!("https://api.github.com/repos/{repo}/releases?per_page=100"),
            )
            .await?;
            let name = match std::env::consts::ARCH {
                "aarch64" => "ffmpeg-macos-arm64.tar.gz",
                "x86_64" => "ffmpeg-macos-x64.tar.gz",
                _ => return Err(check_error()),
            };
            let release = releases
                .into_iter()
                .filter(|release| !release.draft && !release.prerelease)
                .filter(|release| release.tag_name.starts_with("ffmpeg-components-"))
                .filter(|release| release.assets.iter().any(|asset| asset.name == name))
                .filter(|release| {
                    version_numbers(release.tag_name.trim_start_matches("ffmpeg-components-"))
                        .is_some()
                })
                .max_by_key(|release| {
                    version_numbers(release.tag_name.trim_start_matches("ffmpeg-components-"))
                });
            let release = release.ok_or_else(check_error)?;
            let version = release
                .tag_name
                .trim_start_matches("ffmpeg-components-")
                .to_string();
            source_for_asset(release, repo, version, name)
        }
        _ => Err(check_error()),
    }
}

fn select_windows_ffmpeg_asset(release: &GitHubRelease) -> Option<(String, String)> {
    release
        .assets
        .iter()
        .filter_map(|asset| {
            let raw = asset.name.strip_prefix("ffmpeg-n")?.split('-').next()?;
            if !asset.name.contains("-win64-lgpl-shared-") || !asset.name.ends_with(".zip") {
                return None;
            }
            let parts = version_numbers(raw)?;
            Some((parts, raw.to_string(), asset.name.clone()))
        })
        .max_by(|left, right| left.0.cmp(&right.0))
        .map(|(_, version, name)| (version, name))
}

fn source_for_asset(
    release: GitHubRelease,
    repo: &'static str,
    version: String,
    name: &str,
) -> Result<Source, String> {
    if version_numbers(&version).is_none() || release.draft || release.prerelease {
        return Err(check_error());
    }
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == name)
        .ok_or_else(check_error)?;
    let sha256 = parse_digest(asset.digest.as_deref().ok_or_else(check_error)?)?;
    let url = reqwest::Url::parse(&asset.browser_download_url).map_err(|_| check_error())?;
    let expected_prefix = format!("/{repo}/releases/download/");
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.path().starts_with(&expected_prefix)
        || url.query().is_some()
    {
        return Err(check_error());
    }
    if asset.size == 0 || asset.size > MAX_FFMPEG_BYTES {
        return Err(check_error());
    }
    Ok(Source {
        version,
        release_url: format!(
            "https://github.com/{repo}/releases/tag/{}",
            release.tag_name
        ),
        asset,
        sha256,
    })
}

fn parse_digest(value: &str) -> Result<[u8; 32], String> {
    let hex = value.strip_prefix("sha256:").ok_or_else(check_error)?;
    if hex.len() != 64 {
        return Err(check_error());
    }
    let mut bytes = [0u8; 32];
    for (index, pair) in hex.as_bytes().chunks_exact(2).enumerate() {
        let pair = std::str::from_utf8(pair).map_err(|_| check_error())?;
        bytes[index] = u8::from_str_radix(pair, 16).map_err(|_| check_error())?;
    }
    Ok(bytes)
}

async fn github_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T, String> {
    let mut response = client
        .get(url)
        .header(ACCEPT, "application/vnd.github+json")
        .header(CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|_| check_error())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|len| len > MAX_METADATA_BYTES as u64)
    {
        return Err(check_error());
    }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| check_error())? {
        if data.len() + chunk.len() > MAX_METADATA_BYTES {
            return Err(check_error());
        }
        data.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&data).map_err(|_| check_error())
}

async fn download_verified(
    client: &reqwest::Client,
    source: &Source,
    path: &Path,
    id: ComponentId,
) -> Result<(), String> {
    let max_size = if id == ComponentId::Ffmpeg {
        MAX_FFMPEG_BYTES
    } else {
        MAX_TOOL_BYTES
    };
    if source.asset.size > max_size {
        return Err(install_error());
    }
    let mut response = client
        .get(&source.asset.browser_download_url)
        .send()
        .await
        .map_err(|_| install_error())?;
    if !response.status().is_success()
        || response.content_length().is_some_and(|len| len > max_size)
    {
        return Err(install_error());
    }
    let mut file = File::create(path).map_err(|_| install_error())?;
    let mut hash = Sha256::new();
    let mut size = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|_| install_error())? {
        size += chunk.len() as u64;
        if size > max_size {
            return Err(install_error());
        }
        file.write_all(&chunk).map_err(|_| install_error())?;
        hash.update(&chunk);
    }
    file.sync_all().map_err(|_| install_error())?;
    if size != source.asset.size || hash.finalize().as_slice() != source.sha256 {
        return Err("контрольная сумма компонента не совпадает с данными выпуска".to_string());
    }
    Ok(())
}

async fn extract_deno(archive: &Path, payload: &Path) -> Result<(), String> {
    let entries = archive_entries(archive).await?;
    let expected = if cfg!(target_os = "windows") {
        "deno.exe"
    } else {
        "deno"
    };
    if entries != [expected] {
        return Err(install_error());
    }
    extract_archive(archive, payload, &entries).await?;
    ensure_regular_file(&payload.join(expected))
}

async fn extract_ffmpeg(archive: &Path, payload: &Path) -> Result<(), String> {
    let entries = archive_entries(archive).await?;
    if cfg!(target_os = "windows") {
        let bin_path = entries
            .iter()
            .find(|entry| entry.ends_with("/bin/ffmpeg.exe"))
            .and_then(|entry| entry.strip_suffix("/ffmpeg.exe"))
            .ok_or_else(install_error)?;
        if !entries
            .iter()
            .any(|entry| entry == &format!("{bin_path}/ffprobe.exe"))
        {
            return Err(install_error());
        }
        let root = bin_path.strip_suffix("/bin").ok_or_else(install_error)?;
        let license_name = format!("{root}/LICENSE.txt");
        if !entries.iter().any(|entry| entry == &license_name) {
            return Err(install_error());
        }
        let selected = entries
            .iter()
            .filter(|entry| {
                entry.starts_with(&format!("{bin_path}/"))
                    && (entry.ends_with(".dll")
                        || entry.ends_with("/ffmpeg.exe")
                        || entry.ends_with("/ffprobe.exe"))
                    || *entry == &license_name
            })
            .cloned()
            .collect::<Vec<_>>();
        extract_archive(archive, payload, &selected).await?;
        let bin_dir = payload.join(bin_path);
        for entry in fs::read_dir(&bin_dir).map_err(|_| install_error())? {
            let entry = entry.map_err(|_| install_error())?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name == "ffmpeg.exe"
                || name == "ffprobe.exe"
                || name.to_ascii_lowercase().ends_with(".dll")
            {
                ensure_regular_file(&entry.path())?;
                fs::copy(entry.path(), payload.join(name.as_ref())).map_err(|_| install_error())?;
            }
        }
        let license = payload.join(&license_name);
        ensure_regular_file(&license)?;
        fs::copy(license, payload.join("LICENSE.txt")).map_err(|_| install_error())?;
        let extracted_root = payload
            .join(bin_path)
            .parent()
            .ok_or_else(install_error)?
            .to_path_buf();
        fs::remove_dir_all(extracted_root).map_err(|_| install_error())?;
    } else {
        let expected = [
            "ffmpeg",
            "ffprobe",
            "libmp3lame.0.dylib",
            "FFMPEG_LGPL-2.1.txt",
            "LAME_LGPL-2.0.txt",
            "COMPONENTS.txt",
        ];
        if entries
            .iter()
            .any(|entry| !expected.contains(&entry.as_str()))
            || expected
                .iter()
                .any(|name| !entries.iter().any(|entry| entry == name))
        {
            return Err(install_error());
        }
        extract_archive(archive, payload, &entries).await?;
        for name in expected {
            ensure_regular_file(&payload.join(name))?;
        }
    }
    Ok(())
}

async fn archive_entries(archive: &Path) -> Result<Vec<String>, String> {
    let mut command = archive_command();
    command.arg("-tf").arg(archive).kill_on_drop(true);
    let output = tokio::time::timeout(PROCESS_TIMEOUT, command.output())
        .await
        .map_err(|_| install_error())?
        .map_err(|_| install_error())?;
    if !output.status.success() || output.stdout.len() > 512 * 1024 {
        return Err(install_error());
    }
    let text = std::str::from_utf8(&output.stdout).map_err(|_| install_error())?;
    let entries = text
        .lines()
        .map(|line| {
            line.trim_start_matches("./")
                .trim_end_matches('/')
                .to_string()
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if entries.is_empty()
        || entries.iter().any(|entry| {
            entry.starts_with('/')
                || entry.contains('\\')
                || entry.contains(':')
                || entry
                    .split('/')
                    .any(|part| part == ".." || part == "." || part.is_empty())
        })
    {
        return Err(install_error());
    }
    let mut verbose_command = archive_command();
    verbose_command.arg("-tvf").arg(archive).kill_on_drop(true);
    let verbose = tokio::time::timeout(PROCESS_TIMEOUT, verbose_command.output())
        .await
        .map_err(|_| install_error())?
        .map_err(|_| install_error())?;
    if !verbose.status.success() || verbose.stdout.len() > 1024 * 1024 {
        return Err(install_error());
    }
    let listing = verbose
        .stdout
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty() && *line != b"\r")
        .collect::<Vec<_>>();
    if listing.len() != entries.len()
        || listing
            .iter()
            .any(|line| line.first() != Some(&b'-') && line.first() != Some(&b'd'))
    {
        return Err(install_error());
    }
    Ok(entries)
}

async fn extract_archive(
    archive: &Path,
    destination: &Path,
    entries: &[String],
) -> Result<(), String> {
    let mut command = archive_command();
    command
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(destination)
        .args(entries)
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(180), command.output())
        .await
        .map_err(|_| install_error())?
        .map_err(|_| install_error())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(install_error())
    }
}

fn archive_command() -> Command {
    #[cfg(target_os = "windows")]
    {
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        let mut command = Command::new(PathBuf::from(system_root).join("System32/tar.exe"));
        command.creation_flags(0x08000000);
        command
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("/usr/bin/tar")
    }
}

fn ensure_regular_file(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_file()) {
        Ok(())
    } else {
        Err(install_error())
    }
}

fn make_executable_if_unix(payload: &Path, id: ComponentId) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let names: &[&str] = match id {
            ComponentId::Ytdlp => &["yt-dlp_macos"],
            ComponentId::Deno => &["deno"],
            ComponentId::Ffmpeg => &["ffmpeg", "ffprobe"],
        };
        for name in names {
            let path = payload.join(name);
            let mut permissions = fs::metadata(&path)
                .map_err(|_| install_error())?
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).map_err(|_| install_error())?;
        }
    }
    #[cfg(not(unix))]
    let _ = (payload, id);
    Ok(())
}

async fn validate_payload(
    payload: &Path,
    id: ComponentId,
    expected_version: &str,
) -> Result<(), String> {
    let primary = match id {
        ComponentId::Ytdlp if cfg!(target_os = "windows") => payload.join("yt-dlp.exe"),
        ComponentId::Ytdlp => payload.join("yt-dlp_macos"),
        ComponentId::Deno if cfg!(target_os = "windows") => payload.join("deno.exe"),
        ComponentId::Deno => payload.join("deno"),
        ComponentId::Ffmpeg if cfg!(target_os = "windows") => payload.join("ffmpeg.exe"),
        ComponentId::Ffmpeg => payload.join("ffmpeg"),
    };
    ensure_regular_file(&primary)?;
    let actual = read_version(&primary, id)
        .await
        .map_err(|_| install_error())?;
    if !version_matches_release(id, &actual, expected_version) {
        return Err(install_error());
    }
    if id == ComponentId::Ffmpeg {
        let probe = payload.join(if cfg!(target_os = "windows") {
            "ffprobe.exe"
        } else {
            "ffprobe"
        });
        ensure_regular_file(&probe)?;
        let probe_version = read_version(&probe, id)
            .await
            .map_err(|_| install_error())?;
        if probe_version != actual {
            return Err(install_error());
        }
        let encoders = run_tool(&primary, &["-hide_banner", "-encoders"])
            .await
            .map_err(|_| install_error())?;
        if !encoders.contains("libmp3lame") || !encoders.contains("png") {
            return Err(install_error());
        }
        #[cfg(target_os = "windows")]
        if !fs::read_dir(payload)
            .map_err(|_| install_error())?
            .flatten()
            .any(|entry| {
                entry.file_name().to_string_lossy().starts_with("avcodec-")
                    && entry.path().extension().is_some_and(|ext| ext == "dll")
            })
        {
            return Err(install_error());
        }
    }
    Ok(())
}

fn version_matches_release(id: ComponentId, actual: &str, expected_version: &str) -> bool {
    if id == ComponentId::Ffmpeg && cfg!(target_os = "windows") {
        version_numbers(&actual)
            .zip(version_numbers(expected_version))
            .is_some_and(|(actual, branch)| actual.starts_with(&branch))
    } else {
        actual == expected_version
    }
}

async fn read_version(path: &Path, id: ComponentId) -> Result<String, String> {
    let args = if id == ComponentId::Ffmpeg {
        &["-version"][..]
    } else {
        &["--version"][..]
    };
    let output = run_tool(path, args).await?;
    parse_version_output(&output, id).ok_or_else(check_error)
}

fn parse_version_output(output: &str, id: ComponentId) -> Option<String> {
    let line = output.lines().next()?.trim();
    let raw = match id {
        ComponentId::Ytdlp => line.split_whitespace().next()?,
        ComponentId::Deno => line.strip_prefix("deno ")?.split_whitespace().next()?,
        ComponentId::Ffmpeg => line
            .strip_prefix("ffmpeg version ")
            .or_else(|| line.strip_prefix("ffprobe version "))?
            .split_whitespace()
            .next()?,
    };
    let raw = raw.trim_start_matches('v').trim_start_matches('n');
    let numeric = raw
        .split(|character: char| !(character.is_ascii_digit() || character == '.'))
        .next()?;
    version_numbers(numeric)?;
    Some(numeric.to_string())
}

async fn run_tool(path: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(path);
    command.args(args).kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(PROCESS_TIMEOUT, command.output())
        .await
        .map_err(|_| check_error())?
        .map_err(|_| check_error())?;
    if !output.status.success() || output.stdout.len() > 512 * 1024 {
        return Err(check_error());
    }
    String::from_utf8(output.stdout).map_err(|_| check_error())
}

struct Staging {
    path: PathBuf,
}

impl Staging {
    fn new(root: &Path) -> Result<Self, String> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| install_error())?
            .as_nanos();
        let path = root.join(format!(".staging-{}-{stamp}", std::process::id()));
        fs::create_dir(&path).map_err(|_| install_error())?;
        Ok(Self { path })
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn check_error() -> String {
    "не удалось получить сведения о выпуске компонента".to_string()
}
fn install_error() -> String {
    "не удалось установить компонент; прежняя версия сохранена".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn replaces_portable_component_and_restores_previous_file_on_failure() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ytloadster-component-swap-{stamp}"));
        let tools = root.join("tools/windows/x64");
        let payload = root.join("payload");
        fs::create_dir_all(&tools).unwrap();
        fs::create_dir_all(&payload).unwrap();
        fs::write(tools.join("deno.exe"), b"2.9.2").unwrap();
        fs::write(payload.join("deno.exe"), b"2.9.7").unwrap();

        activate_windows_payload(&payload, &tools, ComponentId::Deno).unwrap();
        assert_eq!(fs::read(tools.join("deno.exe")).unwrap(), b"2.9.7");

        fs::write(payload.join("deno.exe"), b"2.9.8").unwrap();
        assert!(replace_path_with_backup_using(
            &payload.join("deno.exe"),
            &tools.join("deno.exe"),
            |_, _| Err(std::io::Error::other("simulated replacement failure")),
        )
        .is_err());
        assert_eq!(fs::read(tools.join("deno.exe")).unwrap(), b"2.9.7");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn replaces_portable_ffmpeg_and_ffprobe_as_one_directory() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ytloadster-ffmpeg-swap-{stamp}"));
        let tools = root.join("tools/windows/x64");
        let payload = root.join("payload");
        fs::create_dir_all(tools.join("ffmpeg")).unwrap();
        fs::create_dir_all(&payload).unwrap();
        fs::write(tools.join("ffmpeg/ffmpeg.exe"), b"8.1").unwrap();
        fs::write(tools.join("ffmpeg/ffprobe.exe"), b"8.1").unwrap();
        fs::write(payload.join("ffmpeg.exe"), b"9.0").unwrap();
        fs::write(payload.join("ffprobe.exe"), b"9.0").unwrap();

        activate_windows_payload(&payload, &tools, ComponentId::Ffmpeg).unwrap();
        assert_eq!(fs::read(tools.join("ffmpeg/ffmpeg.exe")).unwrap(), b"9.0");
        assert_eq!(fs::read(tools.join("ffmpeg/ffprobe.exe")).unwrap(), b"9.0");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_versions_from_each_tool() {
        assert_eq!(
            parse_version_output("2026.08.19\n", ComponentId::Ytdlp),
            Some("2026.08.19".into())
        );
        assert_eq!(
            parse_version_output("deno 2.9.3 (stable)\n", ComponentId::Deno),
            Some("2.9.3".into())
        );
        assert_eq!(
            parse_version_output("ffmpeg version n9.0.1-26-g123", ComponentId::Ffmpeg),
            Some("9.0.1".into())
        );
        assert_eq!(
            parse_version_output("ffprobe version 8.1.2", ComponentId::Ffmpeg),
            Some("8.1.2".into())
        );
    }

    #[test]
    fn selects_stable_windows_shared_lgpl_build() {
        let release = GitHubRelease {
            tag_name: "autobuild-2026-09-28".into(),
            prerelease: false,
            draft: false,
            assets: vec![
                GitHubAsset {
                    name: "ffmpeg-N-123-win64-lgpl-shared.zip".into(),
                    browser_download_url: String::new(),
                    digest: None,
                    size: 1,
                },
                GitHubAsset {
                    name: "ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip".into(),
                    browser_download_url: String::new(),
                    digest: None,
                    size: 1,
                },
                GitHubAsset {
                    name: "ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip".into(),
                    browser_download_url: String::new(),
                    digest: None,
                    size: 1,
                },
                GitHubAsset {
                    name: "ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip".into(),
                    browser_download_url: String::new(),
                    digest: None,
                    size: 1,
                },
            ],
        };
        assert_eq!(
            select_windows_ffmpeg_asset(&release),
            Some((
                "9.0".into(),
                "ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip".into()
            ))
        );
    }

    #[test]
    fn verifies_digest_format_and_order() {
        assert!(parse_digest("sha256:abc").is_err());
        assert_eq!(
            parse_digest(&format!("sha256:{}", "ab".repeat(32))).unwrap(),
            [0xab; 32]
        );
        assert!(is_newer("2026.09.01", "2026.08.19"));
        assert!(!is_newer("8.1.2", "9.0.1"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn accepts_the_build_version_within_the_published_windows_ffmpeg_branch() {
        assert!(version_matches_release(ComponentId::Ffmpeg, "9.0.1", "9.0"));
        assert!(!version_matches_release(
            ComponentId::Ffmpeg,
            "9.1.0",
            "9.0"
        ));
        assert!(!version_matches_release(
            ComponentId::Deno,
            "2.9.7",
            "2.9.6"
        ));
    }
}
