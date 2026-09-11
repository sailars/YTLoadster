use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpace {
    pub available: u64,
    pub total: u64,
}

#[tauri::command]
pub fn get_available_disk_space(path: String) -> Result<DiskSpace, String> {
    let existing_path = nearest_existing_path(Path::new(path.trim()))?;
    available_space(&existing_path)
}

fn nearest_existing_path(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("путь к папке не указан".to_string());
    }
    let mut candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|err| format!("не удалось определить текущую папку: {err}"))?
            .join(path)
    };
    loop {
        if candidate.exists() {
            if candidate.is_file() {
                candidate.pop();
            }
            return Ok(candidate);
        }
        if !candidate.pop() {
            return Err("не удалось найти диск для выбранной папки".to_string());
        }
    }
}

#[cfg(windows)]
fn available_space(path: &Path) -> Result<DiskSpace, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide_path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut available = 0_u64;
    let mut total = 0_u64;
    unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(wide_path.as_ptr()),
            Some(&mut available),
            Some(&mut total),
            None,
        )
    }
    .map_err(|err| format!("не удалось определить свободное место: {err}"))?;
    Ok(DiskSpace { available, total })
}

#[cfg(unix)]
fn available_space(path: &Path) -> Result<DiskSpace, String> {
    use std::ffi::CString;
    use std::mem::MaybeUninit;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| "путь к папке содержит недопустимый символ".to_string())?;
    let mut statistics = MaybeUninit::<libc::statvfs>::uninit();
    let result = unsafe { libc::statvfs(path.as_ptr(), statistics.as_mut_ptr()) };
    if result != 0 {
        return Err(format!(
            "не удалось определить свободное место: {}",
            std::io::Error::last_os_error()
        ));
    }
    let statistics = unsafe { statistics.assume_init() };
    Ok(DiskSpace {
        available: (statistics.f_bavail as u64).saturating_mul(statistics.f_frsize as u64),
        total: (statistics.f_blocks as u64).saturating_mul(statistics.f_frsize as u64),
    })
}

#[cfg(not(any(windows, unix)))]
fn available_space(_path: &Path) -> Result<DiskSpace, String> {
    Err("определение свободного места не поддерживается на этой платформе".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_the_nearest_existing_parent() {
        let root = std::env::temp_dir();
        let missing = root.join("ytloadster-missing-folder").join("nested");

        assert_eq!(nearest_existing_path(&missing).unwrap(), root);
    }

    #[test]
    fn reports_free_and_total_space_for_an_existing_directory() {
        let space =
            get_available_disk_space(std::env::temp_dir().to_string_lossy().into_owned()).unwrap();

        assert!(space.available > 0);
        assert!(space.total >= space.available);
    }
}
