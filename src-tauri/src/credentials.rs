use super::*;

pub(super) fn ssh_password_credential_target(profile_id: &str) -> String {
    format!(
        "SSHNet Share/ssh-password/{}",
        sanitize_host_key_alias(profile_id)
    )
}

#[cfg(windows)]
pub(super) fn utf16_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub(super) fn password_to_blob(password: &str) -> Vec<u8> {
    password
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>()
}

#[cfg(windows)]
pub(super) fn password_from_blob(blob: &[u8]) -> Result<String, String> {
    if !blob.len().is_multiple_of(2) {
        return Err("保存的 SSH 密码数据已损坏。".to_string());
    }
    let mut words = blob
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    let result =
        String::from_utf16(&words).map_err(|_| "保存的 SSH 密码不是有效文本。".to_string());
    words.zeroize();
    result
}

#[cfg(windows)]
pub(super) fn save_saved_ssh_password(profile: &Profile, password: &str) -> Result<(), String> {
    let target = utf16_null(&ssh_password_credential_target(&profile.id));
    let username = utf16_null(&format!("{}@{}", profile.ssh_user, profile.ssh_host));
    let mut blob = password_to_blob(password);
    let blob_size = match blob.len().try_into() {
        Ok(size) => size,
        Err(_) => {
            blob.zeroize();
            return Err("SSH 密码过长，无法保存到 Windows 凭据管理器。".to_string());
        }
    };
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_ptr() as *mut u16,
        CredentialBlobSize: blob_size,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: username.as_ptr() as *mut u16,
        ..Default::default()
    };

    let ok = unsafe { CredWriteW(&credential, 0) };
    blob.zeroize();
    if ok == 0 {
        return Err(format!(
            "保存 SSH 密码到 Windows 凭据管理器失败：{}",
            unsafe { GetLastError() }
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn save_saved_ssh_password(_profile: &Profile, _password: &str) -> Result<(), String> {
    Err("保存 SSH 密码仅支持 Windows 凭据管理器。".to_string())
}

#[cfg(windows)]
struct CredentialHandle(*mut CREDENTIALW);

#[cfg(windows)]
impl Drop for CredentialHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CredFree(self.0.cast()) };
        }
    }
}

#[cfg(windows)]
pub(super) fn read_saved_ssh_password(profile_id: &str) -> Result<Option<String>, String> {
    let target = utf16_null(&ssh_password_credential_target(profile_id));
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if ok == 0 {
        let error = unsafe { GetLastError() };
        if error == ERROR_NOT_FOUND {
            return Ok(None);
        }
        return Err(format!("读取已保存 SSH 密码失败：{error}"));
    }

    if credential.is_null() {
        return Ok(None);
    }
    let credential = CredentialHandle(credential);

    let result = unsafe {
        let credential_ref = &*credential.0;
        if credential_ref.CredentialBlobSize == 0 {
            return Ok(Some(String::new()));
        }
        if credential_ref.CredentialBlob.is_null() {
            return Err("保存的 SSH 密码数据已损坏。".to_string());
        }
        let blob = std::slice::from_raw_parts(
            credential_ref.CredentialBlob,
            credential_ref.CredentialBlobSize as usize,
        );
        password_from_blob(blob).map(Some)
    };
    result
}

#[cfg(not(windows))]
pub(super) fn read_saved_ssh_password(_profile_id: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(windows)]
pub(super) fn saved_ssh_password_exists(profile_id: &str) -> Result<bool, String> {
    let target = utf16_null(&ssh_password_credential_target(profile_id));
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if ok == 0 {
        let error = unsafe { GetLastError() };
        if error == ERROR_NOT_FOUND {
            return Ok(false);
        }
        return Err(format!("读取已保存 SSH 密码失败：{error}"));
    }
    if !credential.is_null() {
        unsafe { CredFree(credential.cast()) };
    }
    Ok(true)
}

#[cfg(not(windows))]
pub(super) fn saved_ssh_password_exists(_profile_id: &str) -> Result<bool, String> {
    Ok(false)
}

#[cfg(windows)]
pub(super) fn delete_saved_ssh_password(profile_id: &str) -> Result<(), String> {
    let target = utf16_null(&ssh_password_credential_target(profile_id));
    let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if ok == 0 {
        let error = unsafe { GetLastError() };
        if error == ERROR_NOT_FOUND {
            return Ok(());
        }
        return Err(format!("删除已保存 SSH 密码失败：{error}"));
    }
    Ok(())
}

#[cfg(not(windows))]
pub(super) fn delete_saved_ssh_password(_profile_id: &str) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub(super) fn has_saved_ssh_password(profile_id: String) -> Result<bool, String> {
    saved_ssh_password_exists(&profile_id)
}

#[tauri::command]
pub(super) fn forget_saved_ssh_password(profile_id: String) -> Result<(), String> {
    delete_saved_ssh_password(&profile_id)
}

pub(super) fn cleanup_saved_passwords_after_profile_save(
    previous: &[Profile],
    current: &[Profile],
) -> Result<(), String> {
    let current_saved_ids = current
        .iter()
        .filter(|profile| {
            matches!(profile.auth_method, AuthMethod::Password) && profile.remember_ssh_password
        })
        .map(|profile| profile.id.as_str())
        .collect::<HashSet<_>>();

    let mut ids_to_forget = previous
        .iter()
        .filter(|profile| !current_saved_ids.contains(profile.id.as_str()))
        .map(|profile| profile.id.clone())
        .collect::<HashSet<_>>();

    for profile in current {
        if !matches!(profile.auth_method, AuthMethod::Password) || !profile.remember_ssh_password {
            ids_to_forget.insert(profile.id.clone());
        }
    }

    for profile_id in ids_to_forget {
        delete_saved_ssh_password(&profile_id)?;
    }
    Ok(())
}
