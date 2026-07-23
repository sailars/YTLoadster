use tauri::AppHandle;

#[cfg(not(target_os = "windows"))]
use tauri_plugin_notification::NotificationExt;

#[cfg(target_os = "windows")]
fn notification_registry_path(identifier: &str) -> String {
    format!(r"SOFTWARE\Classes\AppUserModelId\{identifier}")
}

#[cfg(target_os = "windows")]
fn register_windows_notification_identity(
    identifier: &str,
    display_name: &str,
) -> Result<(), String> {
    use windows_registry::CURRENT_USER;

    let key = CURRENT_USER
        .create(notification_registry_path(identifier))
        .map_err(|error| format!("не удалось зарегистрировать источник уведомлений: {error}"))?;
    key.set_string("DisplayName", display_name)
        .map_err(|error| format!("не удалось сохранить имя источника уведомлений: {error}"))?;
    key.set_string("IconBackgroundColor", "0")
        .map_err(|error| format!("не удалось сохранить оформление уведомлений: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn show_system_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    let title = title.trim();
    let body = body.trim();
    if title.is_empty() || body.is_empty() {
        return Err("заголовок и текст уведомления не должны быть пустыми".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let identifier = &app.config().identifier;
        let display_name = app.config().product_name.as_deref().unwrap_or("YTLoadster");
        register_windows_notification_identity(identifier, display_name)?;
        tauri_winrt_notification::Toast::new(identifier)
            .title(title)
            .text1(body)
            .show()
            .map_err(|error| format!("Windows не удалось показать уведомление: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|error| format!("не удалось показать системное уведомление: {error}"))
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    #[test]
    fn builds_current_user_aumid_registry_path() {
        assert_eq!(
            super::notification_registry_path("com.ytloadster.desktop"),
            r"SOFTWARE\Classes\AppUserModelId\com.ytloadster.desktop"
        );
    }
}
