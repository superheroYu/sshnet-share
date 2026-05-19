use super::*;

pub(super) fn check_profile_store(app: &AppHandle) -> EnvironmentCheck {
    match profiles_path(app).and_then(|path| {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("配置目录不可写 {}：{error}", parent.display()))?;
            Ok(format!("配置目录：{}", parent.display()))
        } else {
            Err("无法定位配置目录".to_string())
        }
    }) {
        Ok(detail) => EnvironmentCheck {
            key: "profile",
            label: "Profile Store",
            status: "ready",
            detail,
        },
        Err(error) => EnvironmentCheck {
            key: "profile",
            label: "Profile Store",
            status: "error",
            detail: error,
        },
    }
}

pub(super) fn check_ssh() -> EnvironmentCheck {
    match hidden_command("ssh").arg("-V").output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = if stderr.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                stderr.trim().to_string()
            };

            EnvironmentCheck {
                key: "ssh",
                label: "OpenSSH Client",
                status: if output.status.success() {
                    "ready"
                } else {
                    "warning"
                },
                detail,
            }
        }
        Err(error) => EnvironmentCheck {
            key: "ssh",
            label: "OpenSSH Client",
            status: "error",
            detail: format!("未找到 ssh.exe：{error}"),
        },
    }
}

pub(super) fn check_ssh_keyscan() -> EnvironmentCheck {
    match hidden_command("ssh-keyscan").arg("-?").output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = if stderr.trim().is_empty() {
                stdout
                    .trim()
                    .lines()
                    .next()
                    .unwrap_or("ssh-keyscan 可用")
                    .to_string()
            } else {
                stderr
                    .trim()
                    .lines()
                    .next()
                    .unwrap_or("ssh-keyscan 可用")
                    .to_string()
            };

            EnvironmentCheck {
                key: "sshKeyscan",
                label: "ssh-keyscan",
                status: "ready",
                detail,
            }
        }
        Err(error) => EnvironmentCheck {
            key: "sshKeyscan",
            label: "ssh-keyscan",
            status: "error",
            detail: format!("未找到 ssh-keyscan.exe：{error}"),
        },
    }
}
