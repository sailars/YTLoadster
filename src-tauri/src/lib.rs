pub mod auth;
pub mod downloads;
pub mod filesystem;
pub mod notifications;
pub mod power;
pub mod storage;
pub mod tools;
pub mod tray;
pub mod updates;
pub mod ytdlp;

use tauri::Manager;

#[derive(Debug, serde::Serialize)]
pub struct AppStatus {
    pub name: String,
    pub ready: bool,
    pub platform: String,
}

#[tauri::command]
fn get_app_status() -> AppStatus {
    AppStatus {
        name: "YTLoadster".to_string(),
        ready: true,
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !is_http_url(url) {
        return Err("разрешены только ссылки http и https".to_string());
    }

    let (program, args) = external_url_command(url);
    std::process::Command::new(program)
        .args(args)
        .spawn()
        .map_err(|err| format!("не удалось запустить браузер: {err}"))?;
    Ok(())
}

fn is_http_url(value: &str) -> bool {
    let Some((scheme, rest)) = value.split_once("://") else {
        return false;
    };
    (scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https"))
        && !rest.is_empty()
        && !rest
            .chars()
            .any(|character| character.is_whitespace() || character == '\0')
}

fn external_url_command(url: &str) -> (&'static str, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        (
            "rundll32.exe",
            vec!["url.dll,FileProtocolHandler".to_string(), url.to_string()],
        )
    }

    #[cfg(target_os = "macos")]
    {
        ("open", vec![url.to_string()])
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        ("xdg-open", vec![url.to_string()])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_http_and_https_urls() {
        assert!(is_http_url("https://www.youtube.com/watch?v=test"));
        assert!(is_http_url("http://example.com"));
        assert!(!is_http_url("file:///C:/Documents"));
        assert!(!is_http_url("https://example.com/path with spaces"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn opens_urls_with_the_windows_protocol_handler() {
        let (program, args) = external_url_command("https://www.youtube.com/watch?v=test");

        assert_eq!(program, "rundll32.exe");
        assert_eq!(
            args,
            vec![
                "url.dll,FileProtocolHandler",
                "https://www.youtube.com/watch?v=test"
            ]
        );
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(tray::handle_window_event)
        .setup(|app| {
            let storage =
                storage::Storage::open_default(app.handle()).map_err(std::io::Error::other)?;
            let settings = storage
                .get_settings()
                .unwrap_or_else(|_| storage::Settings::default());
            let download_manager = downloads::DownloadManager::with_settings(
                settings.concurrency,
                settings.fragment_concurrency,
            );
            download_manager.set_retry_settings(
                settings.download_retries,
                settings.file_access_retries,
                settings.fragment_retries,
            );
            let sleep_inhibitor =
                power::SleepInhibitor::new(settings.prevent_system_sleep_while_downloading);
            match power::install_wake_listener(sleep_inhibitor.clone()) {
                Ok(listener) => app.manage(listener),
                Err(error) => {
                    eprintln!("could not install wake listener: {error}");
                    false
                }
            };
            let lifecycle = tray::AppLifecycle::new(settings.minimize_to_tray);
            let tray =
                tray::TrayController::install(app, lifecycle.clone(), settings.minimize_to_tray)
                    .unwrap_or_else(|error| {
                        eprintln!("could not create tray icon: {error}");
                        tray::TrayController::unavailable(app.handle(), lifecycle.clone())
                    });
            app.manage(download_manager);
            app.manage(sleep_inhibitor);
            app.manage(lifecycle);
            app.manage(tray);
            app.manage(ytdlp::YtdlpRuntimeSettings::new(
                settings.effective_custom_user_agent(),
            ));
            app.manage(storage);
            app.manage(auth::YoutubeAuthManager::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            filesystem::get_available_disk_space,
            open_external_url,
            auth::cancel_youtube_auth,
            auth::cancel_youtube_webview_auth,
            auth::clear_youtube_auth,
            auth::complete_youtube_auth,
            auth::get_youtube_webview_auth_state,
            auth::get_youtube_auth_window_state,
            auth::get_youtube_auth_status,
            auth::prepare_youtube_auth_capture,
            auth::sign_out_youtube,
            auth::start_youtube_auth,
            auth::start_youtube_webview_auth,
            notifications::show_system_notification,
            downloads::cancel_all_jobs,
            downloads::cancel_job,
            downloads::clear_jobs,
            downloads::enqueue_download,
            downloads::enqueue_download_batch,
            downloads::get_jobs,
            downloads::open_download_folder,
            downloads::pause_all_jobs,
            downloads::pause_job,
            downloads::remove_job,
            downloads::resume_all_jobs,
            downloads::resume_job,
            downloads::retry_job,
            storage::check_history_duplicates,
            storage::clear_history,
            storage::get_default_download_dir,
            storage::get_history,
            storage::get_settings,
            storage::remove_history_item,
            storage::update_settings,
            tray::set_tray_locale,
            tools::get_tool_status,
            updates::check_for_updates,
            ytdlp::probe_playlist,
            ytdlp::probe_playlist_item,
            ytdlp::probe_url
        ])
        .build(tauri::generate_context!())
        .expect("failed to build YTLoadster");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } => {
            let lifecycle = app_handle.state::<tray::AppLifecycle>();
            if lifecycle.begin_cleanup() {
                app_handle.state::<downloads::DownloadManager>().shutdown();
                app_handle.state::<power::SleepInhibitor>().shutdown();
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => tray::show_main_window(app_handle),
        _ => {}
    });
}
