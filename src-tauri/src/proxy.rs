use crate::storage::{get_string_setting, upsert_string_setting, Settings};
use rusqlite::Connection;
use tokio::io::AsyncWriteExt;
use tokio::process::Child;
use url::{Host, Url};

#[cfg(target_os = "macos")]
use security_framework::os::macos::keychain::SecKeychain;

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "YTLoadster Proxy";
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "proxy-password";

pub fn validate_host(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if value.len() > 253 || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("settings-error:invalid-proxy-host".to_string());
    }
    Host::parse(value).map_err(|_| "settings-error:invalid-proxy-host".to_string())?;
    Ok(value.to_string())
}

pub fn validate_username(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.len() > 256 || value.chars().any(char::is_control) {
        return Err("settings-error:invalid-proxy-username".to_string());
    }
    Ok(value.to_string())
}

pub fn validate_password(value: &str) -> Result<(), String> {
    if value.len() > 1024 || value.chars().any(char::is_control) {
        return Err("settings-error:invalid-proxy-password".to_string());
    }
    Ok(())
}

pub fn url_for_settings(
    settings: &Settings,
    password: Option<&str>,
) -> Result<Option<String>, String> {
    match settings.proxy_mode.as_str() {
        "system" => Ok(None),
        // "none" means that YTLoadster does not add its own proxy. The child
        // process still follows the operating system network route, including
        // VPN tunnels and proxy clients configured at the system level.
        "none" => Ok(None),
        mode @ ("http" | "https" | "socks5") => {
            let host = validate_host(&settings.proxy_host)?;
            if host.is_empty() || settings.proxy_port == 0 {
                return Err("settings-error:incomplete-proxy".to_string());
            }
            let mut url = Url::parse(&format!("{mode}://localhost"))
                .map_err(|_| "settings-error:invalid-proxy".to_string())?;
            url.set_host(Some(&host))
                .map_err(|_| "settings-error:invalid-proxy-host".to_string())?;
            url.set_port(Some(settings.proxy_port))
                .map_err(|_| "settings-error:invalid-proxy-port".to_string())?;
            if !settings.proxy_username.is_empty() {
                url.set_username(&settings.proxy_username)
                    .map_err(|_| "settings-error:invalid-proxy-username".to_string())?;
                if let Some(password) = password {
                    url.set_password(Some(password))
                        .map_err(|_| "settings-error:invalid-proxy-password".to_string())?;
                }
            }
            Ok(Some(url.into()))
        }
        _ => Err("settings-error:invalid-proxy-mode".to_string()),
    }
}

pub fn add_config_args(args: &mut Vec<String>, proxy_url: Option<&str>) {
    if proxy_url.is_some() {
        args.splice(0..0, ["--config-locations".to_string(), "-".to_string()]);
    }
}

pub async fn write_config(child: &mut Child, proxy_url: Option<&str>) -> Result<(), String> {
    let Some(proxy_url) = proxy_url else {
        return Ok(());
    };
    let mut stdin = child.stdin.take().ok_or("proxy-error:stdin-unavailable")?;
    let config = format!(
        "--proxy {}\n",
        serde_json::to_string(proxy_url).map_err(|_| "proxy-error:invalid-config")?
    );
    stdin
        .write_all(config.as_bytes())
        .await
        .map_err(|_| "proxy-error:stdin-write".to_string())?;
    stdin
        .shutdown()
        .await
        .map_err(|_| "proxy-error:stdin-close".to_string())
}

pub fn redact_error(message: String, proxy_url: Option<&str>) -> String {
    let message = if proxy_url.is_some() {
        message
            .lines()
            .filter(|line| !line.starts_with("Reading options from STDIN"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        message
    };
    if let Some(url) = proxy_url.filter(|url| !url.is_empty()) {
        let mut redacted = message.replace(url, "[proxy]");
        if let Ok(parsed) = Url::parse(url) {
            for encoded in [parsed.username(), parsed.password().unwrap_or("")] {
                if !encoded.is_empty() {
                    redacted = redacted.replace(encoded, "[secret]");
                    let decoded = percent_encoding::percent_decode_str(encoded).decode_utf8_lossy();
                    if !decoded.is_empty() {
                        redacted = redacted.replace(decoded.as_ref(), "[secret]");
                    }
                }
            }
        }
        redacted
    } else {
        message
    }
}

pub fn save_password(conn: &Connection, password: &str) -> Result<(), String> {
    validate_password(password)?;
    #[cfg(target_os = "windows")]
    {
        let encrypted = if password.is_empty() {
            String::new()
        } else {
            crate::auth::protect_session(password.as_bytes())?
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        upsert_string_setting(conn, "proxy_password_encrypted", &encrypted)?;
    }
    #[cfg(target_os = "macos")]
    {
        let keychain = SecKeychain::default().map_err(|_| "proxy-error:keychain-unavailable")?;
        if password.is_empty() {
            if let Ok((_, item)) =
                keychain.find_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            {
                item.delete();
            }
        } else {
            keychain
                .set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, password.as_bytes())
                .map_err(|_| "proxy-error:keychain-write")?;
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    if !password.is_empty() {
        return Err("proxy-error:unsupported-platform".to_string());
    }
    upsert_string_setting(
        conn,
        "proxy_password_set",
        if password.is_empty() { "false" } else { "true" },
    )
}

pub fn load_password(conn: &Connection) -> Result<Option<String>, String> {
    if get_string_setting(conn, "proxy_password_set")?.as_deref() != Some("true") {
        return Ok(None);
    }
    #[cfg(target_os = "windows")]
    {
        let encrypted = get_string_setting(conn, "proxy_password_encrypted")?
            .ok_or("proxy-error:password-unavailable")?;
        if encrypted.len() % 2 != 0 {
            return Err("proxy-error:password-unavailable".to_string());
        }
        let bytes = (0..encrypted.len())
            .step_by(2)
            .map(|index| {
                u8::from_str_radix(&encrypted[index..index + 2], 16)
                    .map_err(|_| "proxy-error:password-unavailable".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let plaintext = crate::auth::unprotect_session(&bytes)
            .map_err(|_| "proxy-error:password-unavailable".to_string())?;
        return String::from_utf8(plaintext)
            .map(Some)
            .map_err(|_| "proxy-error:password-unavailable".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let keychain = SecKeychain::default().map_err(|_| "proxy-error:keychain-unavailable")?;
        let (password, _) = keychain
            .find_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|_| "proxy-error:password-unavailable")?;
        return String::from_utf8(password.to_owned())
            .map(Some)
            .map_err(|_| "proxy-error:password-unavailable".to_string());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err("proxy-error:unsupported-platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_encoded_authenticated_proxy_without_exposing_password_in_args() {
        let settings = Settings {
            proxy_mode: "socks5".to_string(),
            proxy_host: "127.0.0.1".to_string(),
            proxy_port: 1080,
            proxy_username: "name@example".to_string(),
            ..Settings::default()
        };
        let url = url_for_settings(&settings, Some("p@ ss:word"))
            .unwrap()
            .unwrap();
        assert_eq!(
            url,
            "socks5://name%40example:p%40%20ss%3Aword@127.0.0.1:1080"
        );
        let mut args = vec!["https://example.com".to_string()];
        add_config_args(&mut args, Some(&url));
        assert_eq!(args, ["--config-locations", "-", "https://example.com"]);
        assert!(!args.join(" ").contains("word"));
        for mode in ["http", "https"] {
            let settings = Settings {
                proxy_mode: mode.to_string(),
                ..settings.clone()
            };
            let url = url_for_settings(&settings, Some("p@ ss:word"))
                .unwrap()
                .unwrap();
            assert!(url.starts_with(&format!("{mode}://name%40example:p%40%20ss%3Aword@")));
        }
    }

    #[test]
    fn rejects_host_with_embedded_credentials_or_path() {
        assert!(validate_host("user@host").is_err());
        assert!(validate_host("host/path").is_err());
    }

    #[test]
    fn redacts_encoded_and_plaintext_credentials_from_errors() {
        let url = "http://user%40example:p%40ss@proxy.local:8080/";
        let error = format!("failed {url}, user%40example, user@example, p%40ss, p@ss");
        let redacted = redact_error(error, Some(url));
        assert!(!redacted.contains("user%40example"));
        assert!(!redacted.contains("user@example"));
        assert!(!redacted.contains("p%40ss"));
        assert!(!redacted.contains("p@ss"));
    }

    #[test]
    fn removes_the_stdin_config_prompt_from_proxy_errors() {
        let message = "Reading options from STDIN - EOF to end:\nERROR: unavailable".to_string();
        assert_eq!(redact_error(message, Some("")), "ERROR: unavailable");
    }

    #[test]
    fn no_manual_proxy_keeps_the_system_network_route() {
        let settings = Settings {
            proxy_mode: "none".to_string(),
            ..Settings::default()
        };
        assert_eq!(url_for_settings(&settings, None).unwrap(), None);

        let mut args = vec!["https://example.com".to_string()];
        add_config_args(&mut args, None);
        assert_eq!(args, ["https://example.com"]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn stores_proxy_password_as_dpapi_ciphertext() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .unwrap();
        save_password(&conn, "p@ssword").unwrap();
        let stored = get_string_setting(&conn, "proxy_password_encrypted")
            .unwrap()
            .unwrap();
        assert!(!stored.contains("p@ssword"));
        assert_eq!(load_password(&conn).unwrap().as_deref(), Some("p@ssword"));
    }
}
