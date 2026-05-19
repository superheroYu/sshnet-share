use super::*;

pub(super) fn validate_auth_secret(
    profile: &Profile,
    auth_secret: Option<&str>,
) -> Result<(), String> {
    if matches!(profile.auth_method, AuthMethod::Password)
        && !profile.remember_ssh_password
        && auth_secret.map(str::is_empty).unwrap_or(true)
    {
        return Err("密码认证需要输入 SSH 密码。".to_string());
    }
    Ok(())
}

pub(super) fn resolve_auth_secret(
    profile: &Profile,
    auth_secret: Option<&str>,
) -> Result<Option<Zeroizing<String>>, String> {
    if !matches!(profile.auth_method, AuthMethod::Password) {
        return Ok(None);
    }

    if let Some(secret) = auth_secret {
        if !secret.is_empty() {
            return Ok(Some(Zeroizing::new(secret.to_string())));
        }
    }

    if profile.remember_ssh_password {
        if let Some(saved) = read_saved_ssh_password(&profile.id)? {
            if !saved.is_empty() {
                return Ok(Some(Zeroizing::new(saved)));
            }
        }
        return Err("未找到已保存的 SSH 密码，请输入密码后再启动。".to_string());
    }

    Err("密码认证需要输入 SSH 密码。".to_string())
}

pub(super) fn build_ssh_args(profile: &Profile, known_hosts_path: &Path) -> Vec<String> {
    let mut args = vec![
        "-N".to_string(),
        "-T".to_string(),
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=30".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
        "-o".to_string(),
        if matches!(profile.auth_method, AuthMethod::Password) {
            "BatchMode=no".to_string()
        } else {
            "BatchMode=yes".to_string()
        },
        "-o".to_string(),
        "StrictHostKeyChecking=yes".to_string(),
        "-o".to_string(),
        format!("UserKnownHostsFile={}", known_hosts_path.display()),
        "-o".to_string(),
        format!("HostKeyAlias={}", host_key_alias(profile)),
        "-o".to_string(),
        format!("ConnectTimeout={}", profile.connect_timeout_seconds),
    ];

    if matches!(profile.auth_method, AuthMethod::Password) {
        args.push("-v".to_string());
        args.extend([
            "-o".to_string(),
            "PreferredAuthentications=password,keyboard-interactive".to_string(),
            "-o".to_string(),
            "PubkeyAuthentication=no".to_string(),
            "-o".to_string(),
            "NumberOfPasswordPrompts=1".to_string(),
        ]);
    }

    args.extend([
        "-R".to_string(),
        format!(
            "{}:{}:{}:{}",
            profile.remote_bind_host,
            profile.remote_proxy_port,
            profile.local_proxy_host,
            profile.local_proxy_port
        ),
        "-p".to_string(),
        profile.ssh_port.to_string(),
    ]);

    if matches!(&profile.auth_method, AuthMethod::Key)
        && !profile.private_key_path.trim().is_empty()
    {
        args.push("-i".to_string());
        args.push(profile.private_key_path.trim().to_string());
    }

    args.push("-l".to_string());
    args.push(profile.ssh_user.trim().to_string());
    args.push(profile.ssh_host.trim().to_string());
    args
}

pub(super) fn configure_ssh_auth(
    command: &mut Command,
    profile: &Profile,
    auth_secret: Option<&str>,
) -> Result<(), String> {
    if !matches!(profile.auth_method, AuthMethod::Password) {
        return Ok(());
    }

    let password = auth_secret.ok_or_else(|| "密码认证需要输入 SSH 密码。".to_string())?;
    let askpass =
        env::current_exe().map_err(|error| format!("定位 SSH_ASKPASS helper 失败：{error}"))?;
    let (askpass_port, askpass_token) = spawn_askpass_broker(password.to_string())?;
    command
        .env("SSHNET_ASKPASS", "1")
        .env("SSHNET_ASKPASS_PORT", askpass_port.to_string())
        .env("SSHNET_ASKPASS_TOKEN", askpass_token)
        .env("SSH_ASKPASS", askpass)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", "sshnet-share");
    Ok(())
}

pub(super) fn spawn_askpass_broker(password: String) -> Result<(u16, String), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("创建 SSH_ASKPASS 密码通道失败：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("配置 SSH_ASKPASS 密码通道失败：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("读取 SSH_ASKPASS 密码通道端口失败：{error}"))?
        .port();
    let token = askpass_token()?;
    let expected_token = token.clone();
    let password = Zeroizing::new(password);

    thread::spawn(move || {
        let deadline = Instant::now() + ASKPASS_BROKER_TIMEOUT;
        while Instant::now() < deadline {
            match listener.accept() {
                Ok((stream, _)) => {
                    if handle_askpass_request(stream, &expected_token, password.as_str()) {
                        break;
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(25));
                }
                Err(_) => break,
            }
        }
    });

    Ok((port, token))
}

pub(super) fn handle_askpass_request(
    mut stream: TcpStream,
    expected_token: &str,
    password: &str,
) -> bool {
    let _ = stream.set_read_timeout(Some(ASKPASS_IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(ASKPASS_IO_TIMEOUT));
    let Ok(reader_stream) = stream.try_clone() else {
        return false;
    };
    let _ = reader_stream.set_read_timeout(Some(ASKPASS_IO_TIMEOUT));
    let mut reader = BufReader::new(reader_stream);
    let mut token = String::new();
    if reader.read_line(&mut token).is_err() {
        return false;
    }
    if token.trim_end_matches(['\r', '\n']) != expected_token {
        return false;
    }
    stream.write_all(password.as_bytes()).is_ok()
}

pub(super) fn askpass_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("生成 SSH_ASKPASS token 失败：{error}"))?;
    let token = general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    bytes.zeroize();
    Ok(token)
}
