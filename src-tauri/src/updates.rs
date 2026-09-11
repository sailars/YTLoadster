use std::time::Duration;

use reqwest::header::{ACCEPT, CACHE_CONTROL};
use semver::Version;
use tauri::AppHandle;

const LATEST_RELEASE_API_URL: &str =
    "https://api.github.com/repos/sailars/YTLoadster/releases/latest";
const LATEST_RELEASE_PAGE_URL: &str = "https://github.com/sailars/YTLoadster/releases/latest";
const MAX_RELEASE_RESPONSE_SIZE: u64 = 128 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
}

#[derive(Debug, serde::Deserialize)]
struct GitHubRelease {
    tag_name: String,
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let client = reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .user_agent(format!("YTLoadster/{current_version}"))
        .build()
        .map_err(|_| update_check_error())?;

    let response = client
        .get(LATEST_RELEASE_API_URL)
        .header(ACCEPT, "application/vnd.github+json")
        .header(CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|_| update_check_error())?;

    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > MAX_RELEASE_RESPONSE_SIZE)
    {
        return Err(update_check_error());
    }

    let response_body = response.bytes().await.map_err(|_| update_check_error())?;
    if response_body.len() as u64 > MAX_RELEASE_RESPONSE_SIZE {
        return Err(update_check_error());
    }

    let release: GitHubRelease =
        serde_json::from_slice(&response_body).map_err(|_| update_check_error())?;
    evaluate_release(&current_version, &release.tag_name)
}

fn evaluate_release(current_version: &str, release_tag: &str) -> Result<UpdateCheckResult, String> {
    let current = parse_version(current_version)?;
    let latest = parse_version(release_tag)?;

    Ok(UpdateCheckResult {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        update_available: latest > current,
        release_url: LATEST_RELEASE_PAGE_URL.to_string(),
    })
}

fn parse_version(value: &str) -> Result<Version, String> {
    let value = value.trim();
    let value = value
        .strip_prefix('v')
        .or_else(|| value.strip_prefix('V'))
        .unwrap_or(value);
    Version::parse(value).map_err(|_| update_check_error())
}

fn update_check_error() -> String {
    "не удалось проверить наличие обновлений".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_a_newer_stable_release() {
        let result = evaluate_release("0.1.0", "v0.1.1").unwrap();

        assert_eq!(result.current_version, "0.1.0");
        assert_eq!(result.latest_version, "0.1.1");
        assert!(result.update_available);
        assert_eq!(result.release_url, LATEST_RELEASE_PAGE_URL);
    }

    #[test]
    fn treats_the_same_or_older_release_as_current() {
        assert!(!evaluate_release("0.1.1", "0.1.1").unwrap().update_available);
        assert!(
            !evaluate_release("0.1.1", "v0.1.0")
                .unwrap()
                .update_available
        );
    }

    #[test]
    fn compares_prerelease_versions_with_semver_rules() {
        assert!(
            evaluate_release("0.1.1-beta.1", "v0.1.1")
                .unwrap()
                .update_available
        );
    }

    #[test]
    fn rejects_a_release_tag_without_a_semantic_version() {
        assert_eq!(
            evaluate_release("0.1.0", "latest").unwrap_err(),
            update_check_error()
        );
    }
}
