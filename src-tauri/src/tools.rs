use std::env;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolName {
    YtDlp,
    Ffmpeg,
    Ffprobe,
    Deno,
    Node,
}

impl ToolName {
    fn display_name(self) -> &'static str {
        match self {
            Self::YtDlp => "Компонент загрузки",
            Self::Ffmpeg => "ffmpeg",
            Self::Ffprobe => "ffprobe",
            Self::Deno => "deno",
            Self::Node => "node",
        }
    }

    fn executable_names(self, platform: ToolPlatform) -> &'static [&'static str] {
        match (self, platform) {
            (Self::YtDlp, ToolPlatform::Windows) => &["yt-dlp.exe"],
            (Self::YtDlp, ToolPlatform::MacOS) => &["yt-dlp_macos", "yt-dlp"],
            (Self::YtDlp, ToolPlatform::Other) => &["yt-dlp"],
            (Self::Ffmpeg, ToolPlatform::Windows) => &["ffmpeg.exe"],
            (Self::Ffmpeg, _) => &["ffmpeg"],
            (Self::Ffprobe, ToolPlatform::Windows) => &["ffprobe.exe"],
            (Self::Ffprobe, _) => &["ffprobe"],
            (Self::Deno, ToolPlatform::Windows) => &["deno.exe"],
            (Self::Deno, _) => &["deno"],
            (Self::Node, ToolPlatform::Windows) => &["node.exe"],
            (Self::Node, _) => &["node"],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolPlatform {
    Windows,
    MacOS,
    Other,
}

impl ToolPlatform {
    fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::MacOS
        } else {
            Self::Other
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ToolState {
    Found,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub name: String,
    pub path: Option<PathBuf>,
    pub state: ToolState,
    pub version: Option<String>,
    pub setup_action: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInventory {
    pub ytdlp: ToolStatus,
    pub ffmpeg: ToolStatus,
    pub ffprobe: ToolStatus,
    pub js_runtime: ToolStatus,
}

#[derive(Debug, Clone, Default)]
pub struct ToolConfig {
    pub ytdlp_path: Option<PathBuf>,
    pub ffmpeg_path: Option<PathBuf>,
    pub ffprobe_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct ToolEnvironment {
    pub platform: ToolPlatform,
    pub app_dir: PathBuf,
    pub app_tools_dir: PathBuf,
    pub project_dir: PathBuf,
    pub path_dirs: Vec<PathBuf>,
}

impl ToolEnvironment {
    pub fn current() -> Self {
        let platform = ToolPlatform::current();
        let app_dir = env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .or_else(|| env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."));
        let project_dir = env::current_dir().unwrap_or_else(|_| app_dir.clone());
        let app_tools_dir = bundled_tools_dir(&app_dir, platform);
        let path_dirs = env::var_os("PATH")
            .map(|paths| env::split_paths(&paths).collect())
            .unwrap_or_default();

        Self {
            platform,
            app_dir,
            app_tools_dir,
            project_dir,
            path_dirs,
        }
    }

    pub fn current_for_app(app: &AppHandle) -> Self {
        let mut environment = Self::current();
        if environment.platform == ToolPlatform::MacOS {
            if let Ok(resources_dir) = app.path().resource_dir() {
                environment.app_tools_dir = macos_resource_tools_dir(&resources_dir);
            }
        }
        environment
    }

    pub fn for_project(project_dir: PathBuf) -> Self {
        Self::for_project_with_platform(project_dir, ToolPlatform::current())
    }

    pub fn for_project_with_platform(project_dir: PathBuf, platform: ToolPlatform) -> Self {
        Self {
            platform,
            app_dir: project_dir.clone(),
            app_tools_dir: platform_tools_dir(&project_dir, platform),
            project_dir,
            path_dirs: Vec::new(),
        }
    }
}

#[tauri::command]
pub fn get_tool_status(app: AppHandle) -> ToolInventory {
    discover_tools(
        ToolConfig::default(),
        ToolEnvironment::current_for_app(&app),
    )
}

pub fn discover_tools(config: ToolConfig, env: ToolEnvironment) -> ToolInventory {
    ToolInventory {
        ytdlp: discover_tool(ToolName::YtDlp, config.ytdlp_path, &env),
        ffmpeg: discover_tool(ToolName::Ffmpeg, config.ffmpeg_path, &env),
        ffprobe: discover_tool(ToolName::Ffprobe, config.ffprobe_path, &env),
        js_runtime: discover_js_runtime(&env),
    }
}

fn discover_js_runtime(env: &ToolEnvironment) -> ToolStatus {
    let deno = discover_tool(ToolName::Deno, None, env);
    if deno.state == ToolState::Found {
        return deno;
    }

    let node = discover_tool(ToolName::Node, None, env);
    if node.state == ToolState::Found {
        return node;
    }

    ToolStatus {
        name: "JavaScript runtime".to_string(),
        path: None,
        state: ToolState::Missing,
        version: None,
        setup_action: Some("Загрузить компонент Deno".to_string()),
    }
}

fn discover_tool(
    tool: ToolName,
    configured_path: Option<PathBuf>,
    env: &ToolEnvironment,
) -> ToolStatus {
    let path = tool_candidates(tool, configured_path, env)
        .into_iter()
        .find(|candidate| candidate.is_file());

    match path {
        Some(path) => ToolStatus {
            name: tool.display_name().to_string(),
            path: Some(path),
            state: ToolState::Found,
            version: None,
            setup_action: None,
        },
        None => ToolStatus {
            name: tool.display_name().to_string(),
            path: None,
            state: ToolState::Missing,
            version: None,
            setup_action: Some(format!("Install {}", tool.display_name())),
        },
    }
}

fn tool_candidates(
    tool: ToolName,
    configured_path: Option<PathBuf>,
    env: &ToolEnvironment,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path) = configured_path {
        candidates.push(path);
    }

    for executable in tool.executable_names(env.platform) {
        candidates.push(env.app_dir.join(executable));
        // Keep this physical bundle path ahead of Tauri's resource resolver.
        // On macOS the resolver can point at a resource subdirectory, while
        // the executable always remains in `Contents/MacOS`.  In that case
        // replacing the original path made a valid bundled FFmpeg invisible.
        if env.platform == ToolPlatform::MacOS {
            if let Some(bundle_tools_dir) = macos_bundle_resource_tools_dir(&env.app_dir) {
                candidates.push(bundle_tools_dir.join(executable));
            }
        }
        if env.platform == ToolPlatform::Windows
            && matches!(tool, ToolName::Ffmpeg | ToolName::Ffprobe)
        {
            candidates.push(env.app_tools_dir.join("ffmpeg").join(executable));
            candidates.push(
                platform_tools_dir(&env.project_dir, env.platform)
                    .join("ffmpeg")
                    .join(executable),
            );
        }
        candidates.push(env.app_tools_dir.join(executable));
        candidates.push(platform_tools_dir(&env.project_dir, env.platform).join(executable));
        candidates.push(env.project_dir.join(executable));

        if env.platform == ToolPlatform::Windows
            && matches!(tool, ToolName::Ffmpeg | ToolName::Ffprobe)
        {
            candidates.push(
                env.project_dir
                    .join("ffmpeg-n8.1-latest-win64-lgpl-shared-8.1")
                    .join("bin")
                    .join(executable),
            );
        }

        if let Some(parent_project_dir) = env.project_dir.parent() {
            if env.platform == ToolPlatform::Windows
                && matches!(tool, ToolName::Ffmpeg | ToolName::Ffprobe)
            {
                candidates.push(
                    platform_tools_dir(parent_project_dir, env.platform)
                        .join("ffmpeg")
                        .join(executable),
                );
            }
            candidates.push(platform_tools_dir(parent_project_dir, env.platform).join(executable));
            candidates.push(parent_project_dir.join(executable));

            if env.platform == ToolPlatform::Windows
                && matches!(tool, ToolName::Ffmpeg | ToolName::Ffprobe)
            {
                candidates.push(
                    parent_project_dir
                        .join("ffmpeg-n8.1-latest-win64-lgpl-shared-8.1")
                        .join("bin")
                        .join(executable),
                );
            }
        }

        if env.platform == ToolPlatform::MacOS {
            candidates.push(PathBuf::from("/opt/homebrew/bin").join(executable));
            candidates.push(PathBuf::from("/usr/local/bin").join(executable));
        }

        candidates.extend(env.path_dirs.iter().map(|dir| dir.join(executable)));
    }
    candidates
}

fn platform_tools_dir(base: &Path, platform: ToolPlatform) -> PathBuf {
    match platform {
        ToolPlatform::Windows => base.join("tools").join("windows").join("x64"),
        ToolPlatform::MacOS => base.join("tools").join("macos"),
        ToolPlatform::Other => base.join("tools").join("linux"),
    }
}

fn bundled_tools_dir(app_dir: &Path, platform: ToolPlatform) -> PathBuf {
    if platform == ToolPlatform::MacOS {
        // A packaged macOS application runs from
        // `YTLoadster.app/Contents/MacOS/`. Tauri bundle resources reside in
        // the sibling `Contents/Resources/` directory, not next to the
        // executable. Keep the development lookup in `tools/macos/` as a
        // fallback when this is not an app bundle.
        if let Some(resources_tools_dir) = macos_bundle_resource_tools_dir(app_dir) {
            return resources_tools_dir;
        }
    }

    platform_tools_dir(app_dir, platform)
}

fn macos_bundle_resource_tools_dir(app_dir: &Path) -> Option<PathBuf> {
    let contents_dir = app_dir.parent()?;
    (contents_dir
        .file_name()
        .is_some_and(|name| name == "Contents"))
    .then(|| contents_dir.join("Resources").join("tools"))
}

fn macos_resource_tools_dir(resources_dir: &Path) -> PathBuf {
    resources_dir.join("tools")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn discovers_app_adjacent_ytdlp_before_path() {
        let app_dir = temp_dir_with_file("yt-dlp.exe");
        let path_dir = temp_dir_with_file("yt-dlp.exe");
        let env = ToolEnvironment {
            platform: ToolPlatform::Windows,
            app_dir: app_dir.clone(),
            app_tools_dir: app_dir.join("tools").join("windows").join("x64"),
            project_dir: app_dir.clone(),
            path_dirs: vec![path_dir],
        };

        let inventory = discover_tools(ToolConfig::default(), env);

        assert_eq!(inventory.ytdlp.path, Some(app_dir.join("yt-dlp.exe")));
    }

    #[test]
    fn discovers_managed_shared_ffmpeg_folder() {
        let root = temp_dir_with_nested_file("tools/windows/x64/ffmpeg/ffmpeg.exe");
        let env = ToolEnvironment::for_project_with_platform(root.clone(), ToolPlatform::Windows);

        let inventory = discover_tools(ToolConfig::default(), env);

        assert_eq!(
            inventory.ffmpeg.path,
            Some(root.join("tools/windows/x64/ffmpeg/ffmpeg.exe"))
        );
    }

    #[test]
    fn discovers_project_root_tool_when_backend_runs_from_src_tauri() {
        let root = temp_dir_with_file("yt-dlp.exe");
        let src_tauri = root.join("src-tauri");
        fs::create_dir_all(&src_tauri).unwrap();
        let env = ToolEnvironment::for_project_with_platform(src_tauri, ToolPlatform::Windows);

        let inventory = discover_tools(ToolConfig::default(), env);

        assert_eq!(inventory.ytdlp.path, Some(root.join("yt-dlp.exe")));
    }

    #[test]
    fn discovers_macos_tools_without_windows_extensions() {
        let root = unique_temp_dir();
        for file_name in ["yt-dlp_macos", "ffmpeg", "ffprobe"] {
            fs::write(root.join(file_name), b"test").unwrap();
        }
        let env = ToolEnvironment::for_project_with_platform(root.clone(), ToolPlatform::MacOS);

        let inventory = discover_tools(ToolConfig::default(), env);

        assert_eq!(inventory.ytdlp.path, Some(root.join("yt-dlp_macos")));
        assert_eq!(inventory.ffmpeg.path, Some(root.join("ffmpeg")));
        assert_eq!(inventory.ffprobe.path, Some(root.join("ffprobe")));
    }

    #[test]
    fn locates_macos_bundle_resources_from_the_macos_executable_directory() {
        let root = unique_temp_dir();
        let app_dir = root.join("YTLoadster.app/Contents/MacOS");
        let tools_dir = root.join("YTLoadster.app/Contents/Resources/tools");
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&tools_dir).unwrap();
        for file_name in ["yt-dlp_macos", "ffmpeg", "ffprobe", "deno"] {
            fs::write(tools_dir.join(file_name), b"test").unwrap();
        }

        let env = ToolEnvironment {
            platform: ToolPlatform::MacOS,
            app_dir: app_dir.clone(),
            // Simulate a resolver result that is not the actual resource
            // root. Discovery must still use the path derived from the
            // packaged executable.
            app_tools_dir: root.join("resolver-without-tools"),
            project_dir: root,
            path_dirs: Vec::new(),
        };

        let inventory = discover_tools(ToolConfig::default(), env);

        assert_eq!(inventory.ytdlp.path, Some(tools_dir.join("yt-dlp_macos")));
        assert_eq!(inventory.ffmpeg.path, Some(tools_dir.join("ffmpeg")));
        assert_eq!(inventory.ffprobe.path, Some(tools_dir.join("ffprobe")));
        assert_eq!(inventory.js_runtime.path, Some(tools_dir.join("deno")));
    }

    #[test]
    fn locates_macos_tools_from_tauri_resource_directory() {
        let resources_dir = PathBuf::from("/Applications/YTLoadster.app/Contents/Resources");

        assert_eq!(
            macos_resource_tools_dir(&resources_dir),
            resources_dir.join("tools")
        );
    }

    #[test]
    fn reports_missing_tools_with_setup_action() {
        let root = unique_temp_dir();
        let inventory = discover_tools(
            ToolConfig::default(),
            ToolEnvironment::for_project_with_platform(root, ToolPlatform::Windows),
        );

        assert_eq!(inventory.ytdlp.state, ToolState::Missing);
        assert!(inventory.ytdlp.setup_action.is_some());
    }

    #[test]
    fn discovers_deno_as_javascript_runtime() {
        let root = temp_dir_with_file("deno.exe");
        let env = ToolEnvironment::for_project_with_platform(root.clone(), ToolPlatform::Windows);

        let inventory = discover_tools(ToolConfig::default(), env);

        assert_eq!(inventory.js_runtime.name, "deno");
        assert_eq!(inventory.js_runtime.path, Some(root.join("deno.exe")));
    }

    #[test]
    fn discovers_node_as_javascript_runtime_fallback() {
        let root = temp_dir_with_file("node.exe");
        let env = ToolEnvironment::for_project_with_platform(root.clone(), ToolPlatform::Windows);

        let inventory = discover_tools(ToolConfig::default(), env);

        assert_eq!(inventory.js_runtime.name, "node");
        assert_eq!(inventory.js_runtime.path, Some(root.join("node.exe")));
    }

    fn temp_dir_with_file(file_name: &str) -> PathBuf {
        let dir = unique_temp_dir();
        fs::write(dir.join(file_name), b"test").unwrap();
        dir
    }

    fn temp_dir_with_nested_file(relative_path: &str) -> PathBuf {
        let dir = unique_temp_dir();
        let file_path = dir.join(relative_path);
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        fs::write(file_path, b"test").unwrap();
        dir
    }

    fn unique_temp_dir() -> PathBuf {
        let mut dir = std::env::temp_dir();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        dir.push(format!("ytloadster-tools-test-{now}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[allow(dead_code)]
    fn assert_path_exists(path: &Path) {
        assert!(path.exists(), "{} should exist", path.display());
    }
}
