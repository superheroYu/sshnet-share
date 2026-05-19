use super::*;

pub(super) fn resolve_local_proxy_for_tunnel(profile: &Profile) -> Result<Profile, String> {
    let direct_probe = probe_local_proxy_protocol(
        profile.local_proxy_port,
        &profile.local_proxy_host,
        &profile.local_proxy_protocol,
    );
    if direct_probe.reachable {
        if let Some(protocol) = direct_probe.protocol {
            let mut effective_profile = profile.clone();
            effective_profile.local_proxy_protocol = protocol;
            return Ok(effective_profile);
        }
    }

    let direct_probe = probe_local_proxy_port(profile.local_proxy_port, &profile.local_proxy_host);
    if direct_probe.reachable {
        if let Some(protocol) = direct_probe.protocol {
            let mut effective_profile = profile.clone();
            effective_profile.local_proxy_protocol = protocol;
            return Ok(effective_profile);
        }
    }

    let discovery = discover_local_proxies_inner(profile);
    let Some(candidate) = discovery.candidates.first() else {
        return Err(format!("本地代理不可用：{}", discovery.detail));
    };

    let mut effective_profile = profile.clone();
    effective_profile.local_proxy_port = candidate.port;
    effective_profile.local_proxy_protocol = candidate.protocol.clone();
    Ok(effective_profile)
}

pub(super) fn discover_local_proxies_inner(profile: &Profile) -> LocalProxyDiscoveryResult {
    let candidates = local_proxy_detection_ports(profile);
    let mut scanned_ports = Vec::new();
    let mut detected = Vec::new();

    for candidate in candidates {
        push_unique_port(&mut scanned_ports, candidate.port);
        let preferred_probe =
            probe_local_proxy_protocol(candidate.port, "127.0.0.1", &profile.local_proxy_protocol);
        let probe = if preferred_probe.protocol.is_some() || !preferred_probe.reachable {
            preferred_probe
        } else {
            probe_local_proxy_port(candidate.port, "127.0.0.1")
        };
        if let Some(protocol) = probe.protocol {
            if probe.reachable {
                detected.push(LocalProxyCandidate {
                    host: "127.0.0.1".to_string(),
                    port: candidate.port,
                    protocol,
                    source: candidate.source,
                    detail: probe.detail,
                });
            }
        }
    }

    let detail = if detected.is_empty() {
        format!(
            "未在 {} 个候选端口中识别到 HTTP 或 SOCKS5 本地代理。",
            scanned_ports.len()
        )
    } else {
        format!(
            "检测到 {} 个本地代理候选，已优先选择 127.0.0.1:{}。",
            detected.len(),
            detected[0].port
        )
    };

    LocalProxyDiscoveryResult {
        candidates: detected,
        scanned_ports,
        detail,
    }
}

pub(super) fn local_proxy_detection_ports(profile: &Profile) -> Vec<ProxyPortCandidate> {
    let mut candidates = Vec::new();
    push_proxy_port_candidate(&mut candidates, profile.local_proxy_port, "current profile");

    for port in windows_system_proxy_ports() {
        push_proxy_port_candidate(&mut candidates, port, "Windows system proxy");
    }

    for port in environment_proxy_ports() {
        push_proxy_port_candidate(&mut candidates, port, "environment proxy");
    }

    for port in COMMON_LOCAL_PROXY_PORTS {
        push_proxy_port_candidate(&mut candidates, *port, "common proxy port");
    }

    candidates
}

pub(super) fn push_proxy_port_candidate(
    candidates: &mut Vec<ProxyPortCandidate>,
    port: u16,
    source: &str,
) {
    if port == 0 {
        return;
    }

    if let Some(existing) = candidates
        .iter_mut()
        .find(|candidate| candidate.port == port)
    {
        if !existing.source.split(", ").any(|item| item == source) {
            existing.source.push_str(", ");
            existing.source.push_str(source);
        }
        return;
    }

    candidates.push(ProxyPortCandidate {
        port,
        source: source.to_string(),
    });
}

pub(super) fn push_unique_port(ports: &mut Vec<u16>, port: u16) {
    if port != 0 && !ports.contains(&port) {
        ports.push(port);
    }
}

#[cfg(windows)]
pub(super) fn windows_system_proxy_ports() -> Vec<u16> {
    let Ok(output) = hidden_command("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v",
            "ProxyServer",
        ])
        .output()
    else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    proxy_ports_from_text(&raw)
}

#[cfg(not(windows))]
pub(super) fn windows_system_proxy_ports() -> Vec<u16> {
    Vec::new()
}

pub(super) fn environment_proxy_ports() -> Vec<u16> {
    let mut ports = Vec::new();
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ] {
        if let Ok(value) = env::var(key) {
            for port in proxy_ports_from_text(&value) {
                push_unique_port(&mut ports, port);
            }
        }
    }
    ports
}

pub(super) fn proxy_ports_from_text(raw: &str) -> Vec<u16> {
    let mut ports = Vec::new();
    for item in raw.split(|ch: char| ch == ';' || ch == ',' || ch.is_whitespace()) {
        let endpoint = item
            .split_once('=')
            .map(|(_, value)| value)
            .unwrap_or(item)
            .trim();
        if let Some(port) = parse_local_proxy_port(endpoint) {
            push_unique_port(&mut ports, port);
        }
    }
    ports
}

pub(super) fn parse_local_proxy_port(endpoint: &str) -> Option<u16> {
    let mut text = endpoint.trim().trim_matches('"').trim_matches('\'');
    if text.is_empty() {
        return None;
    }

    if let Some((_, rest)) = text.split_once("://") {
        text = rest;
    }
    if let Some((_, rest)) = text.rsplit_once('@') {
        text = rest;
    }
    text = text.split(['/', '?', '#']).next().unwrap_or(text);

    if let Some(port_raw) = text.strip_prefix("[::1]:") {
        return parse_proxy_port(port_raw);
    }

    let (host, port_raw) = text.rsplit_once(':')?;
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1") {
        return None;
    }

    parse_proxy_port(port_raw)
}

pub(super) fn parse_proxy_port(port_raw: &str) -> Option<u16> {
    let port = port_raw.trim().parse::<u16>().ok()?;
    (port != 0).then_some(port)
}

pub(super) fn probe_local_proxy_protocol(
    port: u16,
    host: &str,
    protocol: &ProxyProtocol,
) -> ProxyProbeResult {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    if TcpStream::connect_timeout(&address, Duration::from_millis(700)).is_err() {
        return ProxyProbeResult {
            reachable: false,
            protocol: None,
            detail: format!("无法连接 {host}:{port}"),
        };
    }

    let matched = match protocol {
        ProxyProtocol::Http => probe_http_proxy(address),
        ProxyProtocol::Socks5 => probe_socks5(address),
    };

    if matched {
        return ProxyProbeResult {
            reachable: true,
            protocol: Some(protocol.clone()),
            detail: format!("{host}:{port} 可达，当前配置的 {:?} 协议可用。", protocol),
        };
    }

    ProxyProbeResult {
        reachable: true,
        protocol: None,
        detail: format!(
            "{host}:{port} 可达，但当前配置的 {:?} 协议未响应。",
            protocol
        ),
    }
}

pub(super) fn probe_local_proxy_port(port: u16, host: &str) -> ProxyProbeResult {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    if TcpStream::connect_timeout(&address, Duration::from_millis(700)).is_err() {
        return ProxyProbeResult {
            reachable: false,
            protocol: None,
            detail: format!("无法连接 {host}:{port}"),
        };
    }

    if probe_socks5(address) {
        return ProxyProbeResult {
            reachable: true,
            protocol: Some(ProxyProtocol::Socks5),
            detail: format!("{host}:{port} 可达，检测到 SOCKS5 握手响应。"),
        };
    }

    if probe_http_proxy(address) {
        return ProxyProbeResult {
            reachable: true,
            protocol: Some(ProxyProtocol::Http),
            detail: format!("{host}:{port} 可达，检测到 HTTP CONNECT 代理响应。"),
        };
    }

    ProxyProbeResult {
        reachable: true,
        protocol: None,
        detail: format!("{host}:{port} 可达，但未识别出 HTTP 或 SOCKS5 代理协议。"),
    }
}

pub(super) fn connect_probe_stream(address: SocketAddr) -> std::io::Result<TcpStream> {
    let stream = TcpStream::connect_timeout(&address, Duration::from_millis(700))?;
    stream.set_read_timeout(Some(Duration::from_millis(700)))?;
    stream.set_write_timeout(Some(Duration::from_millis(700)))?;
    Ok(stream)
}

pub(super) fn probe_socks5(address: SocketAddr) -> bool {
    let Ok(mut stream) = connect_probe_stream(address) else {
        return false;
    };
    if stream.write_all(&[0x05, 0x01, 0x00]).is_err() {
        return false;
    }

    let mut response = [0_u8; 2];
    stream.read_exact(&mut response).is_ok() && response[0] == 0x05 && response[1] != 0xff
}

pub(super) fn probe_http_proxy(address: SocketAddr) -> bool {
    let Ok(mut stream) = connect_probe_stream(address) else {
        return false;
    };

    let request = b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }

    let mut response = [0_u8; 96];
    match stream.read(&mut response) {
        Ok(size) if size > 0 => is_successful_http_connect_response(&response[..size]),
        _ => false,
    }
}

pub(super) fn is_successful_http_connect_response(response: &[u8]) -> bool {
    let raw = String::from_utf8_lossy(response);
    let Some(status_line) = raw.lines().next() else {
        return false;
    };

    let mut parts = status_line.split_whitespace();
    let Some(version) = parts.next() else {
        return false;
    };
    let Some(status_code) = parts.next().and_then(|value| value.parse::<u16>().ok()) else {
        return false;
    };

    version.starts_with("HTTP/") && (200..300).contains(&status_code)
}
