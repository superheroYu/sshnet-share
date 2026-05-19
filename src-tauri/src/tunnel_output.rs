use super::*;

pub(super) fn ssh_startup_check_duration(profile: &Profile) -> Duration {
    if matches!(profile.auth_method, AuthMethod::Password) {
        Duration::from_secs(profile.connect_timeout_seconds as u64)
            + SSH_STARTUP_CHECK_PASSWORD_EXTRA
    } else {
        SSH_STARTUP_CHECK_DEFAULT
    }
}

pub(super) fn drain_ssh_startup_signals(
    receiver: &mpsc::Receiver<String>,
) -> Option<SshStartupSignal> {
    let mut strongest_signal = None;
    while let Ok(line) = receiver.try_recv() {
        if let Some(signal) = ssh_startup_signal(&line) {
            if signal == SshStartupSignal::RemoteForwardReady {
                return Some(signal);
            }
            strongest_signal = Some(signal);
        }
    }
    strongest_signal
}

pub(super) fn ssh_startup_signal(line: &str) -> Option<SshStartupSignal> {
    let lower = line.to_ascii_lowercase();
    if lower.contains("remote forward success")
        || lower.contains("allocated port ")
        || lower.contains("forwarding remote")
    {
        return Some(SshStartupSignal::RemoteForwardReady);
    }

    if lower.contains("authenticated to ") || lower.contains("authentication succeeded") {
        return Some(SshStartupSignal::Authenticated);
    }

    None
}

pub(super) fn ssh_password_startup_timeout_detail(
    profile: &Profile,
    recent_logs: &[String],
    startup_signal: Option<SshStartupSignal>,
) -> String {
    let timeout_seconds = ssh_startup_check_duration(profile).as_secs();
    let timeout_reason = if startup_signal == Some(SshStartupSignal::Authenticated) {
        format!(
            "ssh.exe 已完成密码认证，但未在 {timeout_seconds} 秒内确认远程端口监听成功，已停止本次隧道启动。"
        )
    } else {
        format!("ssh.exe 未在 {timeout_seconds} 秒内完成密码认证，已停止本次隧道启动。")
    };
    let raw_detail = if recent_logs.is_empty() {
        timeout_reason
    } else {
        format!("{timeout_reason} 最近输出：{}", recent_logs.join("；"))
    };

    match classify_ssh_failure(recent_logs) {
        Some(summary) => format!("{summary} 原始错误：{raw_detail}"),
        None => raw_detail,
    }
}

pub(super) fn ssh_start_failure_detail(
    exit_status: std::process::ExitStatus,
    recent_logs: &[String],
) -> String {
    let raw_detail = if recent_logs.is_empty() {
        format!("ssh.exe 已退出：{exit_status}")
    } else {
        format!("ssh.exe 已退出：{exit_status}；{}", recent_logs.join("；"))
    };

    match classify_ssh_failure(recent_logs) {
        Some(summary) => format!("{summary} 原始错误：{raw_detail}"),
        None => raw_detail,
    }
}

pub(super) fn classify_ssh_failure(recent_logs: &[String]) -> Option<&'static str> {
    let joined = recent_logs.join("\n").to_ascii_lowercase();
    if joined.trim().is_empty() {
        return None;
    }

    if joined.contains("host key verification failed")
        || joined.contains("remote host identification has changed")
    {
        return Some("SSH Host Key 校验失败：请重新扫描并确认服务器指纹。");
    }

    if ssh_logs_indicate_auth_failure(&joined) {
        return Some("SSH 认证失败：请检查用户名、密码/密钥，或服务器是否允许当前认证方式。");
    }

    if joined.contains("connection timed out") || joined.contains("operation timed out") {
        return Some("SSH 连接超时：请检查服务器地址、端口、防火墙或网络连通性。");
    }

    if joined.contains("connection refused") {
        return Some("SSH 连接被拒绝：请确认服务器 SSH 端口正在监听且防火墙允许连接。");
    }

    if joined.contains("could not resolve hostname")
        || joined.contains("name or service not known")
        || joined.contains("nodename nor servname")
        || joined.contains("temporary failure in name resolution")
    {
        return Some("SSH 主机名解析失败：请检查服务器 Host 是否正确。");
    }

    if joined.contains("network is unreachable") || joined.contains("no route to host") {
        return Some("SSH 网络不可达：请检查本机网络或服务器路由。");
    }

    if joined.contains("administratively prohibited") {
        return Some(
            "SSH 反向隧道被服务器拒绝：服务器的 sshd 配置可能禁用了 TCP 转发（AllowTcpForwarding/GatewayPorts），请联系服务器管理员。",
        );
    }

    if joined.contains("remote port forwarding failed")
        || joined.contains("port forwarding failed")
        || joined.contains("cannot listen to port")
    {
        return Some(
            "SSH 反向隧道建立失败：远端端口可能已被占用，请换一个端口或先在服务器上释放该端口。",
        );
    }

    if joined.contains("askpass")
        || joined.contains("read_passphrase")
        || joined.contains("can't open /dev/tty")
    {
        return Some("SSH 密码输入失败：askpass helper 未能向 ssh.exe 提供本次连接密码。");
    }

    None
}

pub(super) fn ssh_logs_indicate_auth_failure(joined_lowercase_logs: &str) -> bool {
    joined_lowercase_logs.contains("number of password prompts exceeded")
        || joined_lowercase_logs.contains("permission denied")
        || joined_lowercase_logs.contains("authentication failed")
        || joined_lowercase_logs.contains("access denied")
        || joined_lowercase_logs.contains("too many authentication failures")
}

pub(super) fn forget_saved_password_after_auth_failure(
    app: &AppHandle,
    profile: &Profile,
    recent_logs: &[String],
    manager: &TunnelManager,
) {
    if !matches!(profile.auth_method, AuthMethod::Password) || !profile.remember_ssh_password {
        return;
    }

    let joined = recent_logs.join("\n").to_ascii_lowercase();
    if !ssh_logs_indicate_auth_failure(&joined) {
        return;
    }

    match delete_saved_ssh_password(&profile.id) {
        Ok(()) => push_tunnel_log(
            app,
            &manager.logs,
            "INFO",
            Some(&profile.id),
            "已清除认证失败的已保存 SSH 密码。",
        ),
        Err(error) => push_tunnel_log(
            app,
            &manager.logs,
            "WARN",
            Some(&profile.id),
            &format!("清除认证失败的已保存 SSH 密码失败：{error}"),
        ),
    }
}
