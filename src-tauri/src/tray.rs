use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(target_os = "windows")]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{App, AppHandle, Manager, Runtime, State, Wry};

const TRAY_ID: &str = "ytloadster-tray";
const OPEN_ITEM_ID: &str = "tray-open";
const QUIT_ITEM_ID: &str = "tray-quit";

#[derive(Clone)]
pub struct AppLifecycle {
    minimize_to_tray: Arc<AtomicBool>,
    tray_available: Arc<AtomicBool>,
    exit_requested: Arc<AtomicBool>,
    cleanup_started: Arc<AtomicBool>,
}

impl AppLifecycle {
    pub fn new(minimize_to_tray: bool) -> Self {
        Self {
            minimize_to_tray: Arc::new(AtomicBool::new(minimize_to_tray)),
            tray_available: Arc::new(AtomicBool::new(false)),
            exit_requested: Arc::new(AtomicBool::new(false)),
            cleanup_started: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn should_hide_on_close(&self) -> bool {
        self.minimize_to_tray.load(Ordering::SeqCst)
            && self.tray_available.load(Ordering::SeqCst)
            && !self.exit_requested.load(Ordering::SeqCst)
    }

    pub fn request_exit(&self) {
        self.exit_requested.store(true, Ordering::SeqCst);
    }

    pub fn begin_cleanup(&self) -> bool {
        !self.cleanup_started.swap(true, Ordering::SeqCst)
    }
}

pub struct TrayController {
    app: AppHandle,
    lifecycle: AppLifecycle,
    open_item: Option<MenuItem<Wry>>,
    quit_item: Option<MenuItem<Wry>>,
}

impl TrayController {
    pub fn install(app: &mut App, lifecycle: AppLifecycle, enabled: bool) -> Result<Self, String> {
        let open_item =
            MenuItem::with_id(app, OPEN_ITEM_ID, "Открыть YTLoadster", true, None::<&str>)
                .map_err(|error| error.to_string())?;
        let separator = PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?;
        let quit_item = MenuItem::with_id(app, QUIT_ITEM_ID, "Выйти", true, None::<&str>)
            .map_err(|error| error.to_string())?;
        let menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])
            .map_err(|error| error.to_string())?;

        let mut builder = TrayIconBuilder::with_id(TRAY_ID)
            .menu(&menu)
            .tooltip("YTLoadster")
            .show_menu_on_left_click(cfg!(target_os = "macos"));
        #[cfg(target_os = "macos")]
        {
            builder = builder.icon(macos_template_icon()).icon_as_template(true);
        }
        #[cfg(not(target_os = "macos"))]
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }

        let tray = builder
            .on_menu_event(|app, event| match event.id().as_ref() {
                OPEN_ITEM_ID => show_main_window(app),
                QUIT_ITEM_ID => request_exit(app),
                _ => {}
            })
            .on_tray_icon_event(|tray, _event| {
                #[cfg(target_os = "windows")]
                if matches!(
                    _event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                ) {
                    show_main_window(tray.app_handle());
                }
            })
            .build(app)
            .map_err(|error| error.to_string())?;
        tray.set_visible(enabled)
            .map_err(|error| error.to_string())?;
        lifecycle.tray_available.store(true, Ordering::SeqCst);

        Ok(Self {
            app: app.handle().clone(),
            lifecycle,
            open_item: Some(open_item),
            quit_item: Some(quit_item),
        })
    }

    pub fn unavailable(app: &AppHandle, lifecycle: AppLifecycle) -> Self {
        lifecycle.tray_available.store(false, Ordering::SeqCst);
        Self {
            app: app.clone(),
            lifecycle,
            open_item: None,
            quit_item: None,
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.lifecycle
            .minimize_to_tray
            .store(enabled, Ordering::SeqCst);
        let Some(tray) = self.app.tray_by_id(TRAY_ID) else {
            self.lifecycle.tray_available.store(false, Ordering::SeqCst);
            return;
        };
        match tray.set_visible(enabled) {
            Ok(()) => self.lifecycle.tray_available.store(true, Ordering::SeqCst),
            Err(error) => {
                self.lifecycle.tray_available.store(false, Ordering::SeqCst);
                eprintln!("could not change tray icon visibility: {error}");
            }
        }
    }

    pub fn set_locale(&self, locale: &str) {
        let english = locale.eq_ignore_ascii_case("en");
        if let Some(item) = &self.open_item {
            let _ = item.set_text(if english {
                "Open YTLoadster"
            } else {
                "Открыть YTLoadster"
            });
        }
        if let Some(item) = &self.quit_item {
            let _ = item.set_text(if english { "Quit" } else { "Выйти" });
        }
    }
}

pub fn handle_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let lifecycle = window.state::<AppLifecycle>();
        if lifecycle.should_hide_on_close() {
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("could not hide the main window: {error}");
            }
        }
    }
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn request_exit<R: Runtime>(app: &AppHandle<R>) {
    app.state::<AppLifecycle>().request_exit();
    app.exit(0);
}

#[tauri::command]
pub fn set_tray_locale(locale: String, tray: State<'_, TrayController>) {
    tray.set_locale(&locale);
}

#[cfg(target_os = "macos")]
fn macos_template_icon() -> tauri::image::Image<'static> {
    const SIZE: i32 = 32;
    let mut rgba = vec![0_u8; (SIZE * SIZE * 4) as usize];
    for (from, to) in [
        ((5, 7), (13, 16)),
        ((20, 7), (13, 16)),
        ((13, 16), (13, 26)),
        ((18, 7), (28, 7)),
        ((23, 8), (23, 26)),
    ] {
        draw_line(&mut rgba, SIZE, from, to, 2);
    }
    tauri::image::Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

#[cfg(target_os = "macos")]
fn draw_line(rgba: &mut [u8], size: i32, from: (i32, i32), to: (i32, i32), radius: i32) {
    let (mut x, mut y) = from;
    let dx = (to.0 - from.0).abs();
    let sx = if from.0 < to.0 { 1 } else { -1 };
    let dy = -(to.1 - from.1).abs();
    let sy = if from.1 < to.1 { 1 } else { -1 };
    let mut error = dx + dy;
    loop {
        for offset_y in -radius..=radius {
            for offset_x in -radius..=radius {
                if offset_x * offset_x + offset_y * offset_y > radius * radius {
                    continue;
                }
                let pixel_x = x + offset_x;
                let pixel_y = y + offset_y;
                if pixel_x < 0 || pixel_y < 0 || pixel_x >= size || pixel_y >= size {
                    continue;
                }
                let index = ((pixel_y * size + pixel_x) * 4) as usize;
                rgba[index..index + 4].copy_from_slice(&[0, 0, 0, 255]);
            }
        }
        if (x, y) == to {
            break;
        }
        let doubled = 2 * error;
        if doubled >= dy {
            error += dy;
            x += sx;
        }
        if doubled <= dx {
            error += dx;
            y += sy;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_is_hidden_only_when_tray_is_enabled_and_available() {
        let lifecycle = AppLifecycle::new(true);
        assert!(!lifecycle.should_hide_on_close());
        lifecycle.tray_available.store(true, Ordering::SeqCst);
        assert!(lifecycle.should_hide_on_close());
        lifecycle.request_exit();
        assert!(!lifecycle.should_hide_on_close());
    }

    #[test]
    fn cleanup_can_start_only_once() {
        let lifecycle = AppLifecycle::new(false);
        assert!(lifecycle.begin_cleanup());
        assert!(!lifecycle.begin_cleanup());
    }
}
