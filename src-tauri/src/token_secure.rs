//! OAuth 토큰 — OS 보안 저장소(keyring) + 제한된 로컬 파일 폴백
//!
//! Windows: Credential Manager (1차) · `%APPDATA%/업무 대시보드/.gcal-tokens.sec` (2차, 0600/DACL)

use std::path::{Path, PathBuf};

const KEYRING_SERVICE: &str = "com.work.dashboard";
const KEYRING_ACCOUNT: &str = "gcal-oauth-tokens";
const APP_DIR_NAME: &str = "업무 대시보드";
const LEGACY_FILE: &str = "gcal-tokens.json";
const FALLBACK_FILE: &str = ".gcal-tokens.sec";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

fn app_token_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("data_dir() 실패")?;
    Ok(base.join(APP_DIR_NAME))
}

fn legacy_token_path() -> Result<PathBuf, String> {
    Ok(app_token_dir()?.join(LEGACY_FILE))
}

fn fallback_token_path() -> Result<PathBuf, String> {
    Ok(app_token_dir()?.join(FALLBACK_FILE))
}

fn json_has_refresh_token(payload: &str) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(payload).map_err(|e| e.to_string())?;
    if v.get("refresh_token")
        .and_then(|t| t.as_str())
        .is_some_and(|s| !s.is_empty())
    {
        Ok(())
    } else {
        Err("refresh_token 없음".into())
    }
}

fn load_keyring_raw() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn save_keyring_raw(payload: &str) -> Result<(), String> {
    entry()?.set_password(payload).map_err(|e| e.to_string())
}

fn ensure_app_dir() -> Result<(), String> {
    std::fs::create_dir_all(app_token_dir()?).map_err(|e| e.to_string())
}

fn save_fallback_file(payload: &str) -> Result<(), String> {
    ensure_app_dir()?;
    let path = fallback_token_path()?;
    std::fs::write(&path, payload).map_err(|e| e.to_string())?;
    // Windows: icacls 가 직후 읽기를 막는 경우가 있어 Unix 만 0600 적용
    #[cfg(unix)]
    restrict_path_permissions(&path)?;
    Ok(())
}

fn load_fallback_file() -> Result<Option<String>, String> {
    let path = fallback_token_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if json_has_refresh_token(&content).is_ok() {
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

fn load_tokens_internal() -> Result<Option<String>, String> {
    if let Ok(Some(p)) = load_keyring_raw() {
        if json_has_refresh_token(&p).is_ok() {
            return Ok(Some(p));
        }
    }
    load_fallback_file()
}

fn clear_fallback_file() -> Result<(), String> {
    let path = fallback_token_path()?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 저장된 토큰 JSON (keyring → 폴백 파일)
#[tauri::command]
pub fn token_secure_load() -> Result<Option<String>, String> {
    load_tokens_internal()
}

/// 토큰 저장 + Rust 내부에서 즉시 읽기 검증 → 저장된 JSON 반환
#[tauri::command]
pub fn token_secure_save(payload: String) -> Result<String, String> {
    json_has_refresh_token(&payload)?;

    if let Ok(legacy) = legacy_token_path() {
        let _ = std::fs::remove_file(&legacy);
    }

    let _ = save_keyring_raw(&payload);
    save_fallback_file(&payload)?;

    match load_tokens_internal()? {
        Some(p) => Ok(p),
        None => {
            let path = fallback_token_path()?;
            Err(format!(
                "저장 후 읽기 실패 — 폴백 경로: {}",
                path.display()
            ))
        }
    }
}

/// keyring + 폴백 + 레거시 삭제
#[tauri::command]
pub fn token_secure_clear() -> Result<(), String> {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
    clear_fallback_file()?;
    if let Ok(legacy) = legacy_token_path() {
        let _ = std::fs::remove_file(&legacy);
    }
    Ok(())
}

#[tauri::command]
pub fn token_secure_restrict_file(path: String) -> Result<(), String> {
    restrict_path_permissions(Path::new(&path))
}

/// 레거시 `gcal-tokens.json` → keyring/폴백 이관 (앱 기동 1회만 호출)
#[tauri::command]
pub fn token_secure_migrate_legacy(path: String) -> Result<String, String> {
    let path = Path::new(&path);

    if load_keyring_raw()
        .ok()
        .flatten()
        .is_some_and(|j| json_has_refresh_token(&j).is_ok())
        || load_fallback_file().ok().flatten().is_some()
    {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
        return Ok("already_secure".into());
    }

    if !path.exists() {
        return Ok("not_found".into());
    }

    let content = read_legacy_file(path)?;
    json_has_refresh_token(&content)?;
    let _ = save_keyring_raw(&content);
    save_fallback_file(&content)?;
    std::fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok("migrated".into())
}

#[tauri::command]
pub fn token_secure_remove_legacy(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_legacy_file(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(c) => Ok(c),
        Err(_) => {
            repair_legacy_file_acl(path)?;
            std::fs::read_to_string(path).map_err(|e| e.to_string())
        }
    }
}

fn repair_legacy_file_acl(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let path_str = path.to_string_lossy().to_string();
        Command::new("icacls")
            .args([&path_str, "/reset"])
            .status()
            .map_err(|e| e.to_string())?;
        let user = std::env::var("USERNAME").map_err(|e| e.to_string())?;
        Command::new("icacls")
            .args([&path_str, &format!("/grant:r {}:(F)", user)])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(())
    }
}

fn restrict_path_permissions(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
        let mut perms = meta.permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        let path_str = path.to_string_lossy().to_string();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| {
            std::env::var("USERPROFILE")
                .ok()
                .and_then(|p| p.rsplit('\\').next().map(String::from))
                .unwrap_or_default()
        });
        if user.is_empty() {
            return Err("USERNAME을 확인할 수 없습니다".into());
        }
        Command::new("icacls")
            .args([&path_str, "/inheritance:r"])
            .status()
            .map_err(|e| e.to_string())?;
        Command::new("icacls")
            .args([&path_str, &format!("/grant:r {}:(F)", user)])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        Ok(())
    }
}
