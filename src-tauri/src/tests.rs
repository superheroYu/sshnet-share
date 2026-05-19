use super::*;
use std::{
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_ssh_home(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be valid")
        .as_nanos();
    let home = env::temp_dir().join(format!(
        "sshnet-share-{name}-{}-{suffix}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&home);
    fs::create_dir_all(home.join(".ssh")).expect("test .ssh dir should be created");
    home
}

fn write_ssh_config_file(home: &Path, relative: &str, raw: &str) -> PathBuf {
    let path = home.join(".ssh").join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("test config parent should be created");
    }
    fs::write(&path, raw).expect("test config file should be written");
    path
}

#[test]
fn known_host_marker_brackets_non_default_ports() {
    let mut profile = default_profile();
    profile.id = "server-example".to_string();
    profile.ssh_host = "server.example".to_string();
    profile.ssh_port = 2222;

    assert_eq!(known_host_marker(&profile), "sshnet-server-example");

    profile.ssh_port = 22;
    assert_eq!(known_host_marker(&profile), "sshnet-server-example");
}

#[test]
fn normalize_host_key_rewrites_host_marker() {
    let mut profile = default_profile();
    profile.id = "server-example".to_string();
    profile.ssh_host = "server.example".to_string();
    profile.ssh_port = 2222;

    let normalized =
        normalize_host_key_line(&profile, "[server.example]:2222 ssh-ed25519 AQID").unwrap();

    assert_eq!(normalized, "sshnet-server-example ssh-ed25519 AQID");
    assert!(normalize_host_key_line(&profile, "other.example ssh-ed25519 AQID").is_none());
}

#[test]
fn ssh_fallback_known_host_lines_are_converted_to_scan_lines() {
    let mut profile = default_profile();
    profile.id = "server-example".to_string();
    profile.ssh_host = "server.example".to_string();
    profile.ssh_port = 2222;

    let converted = ssh_fallback_known_host_line_to_scan_line(
        &profile,
        "sshnet-server-example ssh-ed25519 AQID",
    )
    .unwrap();

    assert_eq!(converted, "[server.example]:2222 ssh-ed25519 AQID");
    assert_eq!(
        normalize_host_key_line(&profile, &converted).unwrap(),
        "sshnet-server-example ssh-ed25519 AQID"
    );
}

#[test]
fn unsupported_kex_errors_enable_ssh_fallback() {
    assert!(ssh_keyscan_needs_ssh_fallback(
        "choose_kex: unsupported KEX method sntrup761x25519-sha512@openssh.com"
    ));
    assert!(ssh_keyscan_needs_ssh_fallback(
        "choose_kex: Unsupported kex algorithm sntrup761x25519-sha512@openssh.com"
    ));
    assert!(ssh_keyscan_needs_ssh_fallback(
        "Unable to negotiate with 10.0.0.1 port 22: no matching key exchange method found."
    ));
    assert!(ssh_keyscan_needs_ssh_fallback(
        "Unable to negotiate with 10.0.0.1 port 22: no matching KEX method found."
    ));
    assert!(!ssh_keyscan_needs_ssh_fallback("Connection timed out"));
}

#[test]
fn known_host_key_set_id_is_order_independent() {
    let first = parse_known_host_key("sshnet-a ssh-ed25519 AQID").unwrap();
    let second = parse_known_host_key("sshnet-a ssh-rsa AQIDBA").unwrap();

    assert!(first.key_id.starts_with("ssh-ed25519:SHA256:"));
    assert_eq!(
        known_host_key_set_id(&[first.clone(), second.clone()]),
        known_host_key_set_id(&[second, first])
    );
    assert_eq!(known_host_trust_action(&[], "empty", "anything"), "new");
}

#[test]
fn known_host_trust_action_detects_replacements() {
    let existing = parse_known_host_key("sshnet-a ssh-ed25519 AQID").unwrap();
    let scanned = parse_known_host_key("sshnet-a ssh-ed25519 AQIDBA").unwrap();
    let existing_id = known_host_key_set_id(std::slice::from_ref(&existing));
    let scanned_id = known_host_key_set_id(std::slice::from_ref(&scanned));

    assert_eq!(
        known_host_trust_action(std::slice::from_ref(&existing), &existing_id, &existing_id),
        "unchanged"
    );
    assert_eq!(
        known_host_trust_action(&[existing], &existing_id, &scanned_id),
        "replace"
    );
}

#[test]
fn redact_log_line_masks_profile_values_and_secrets() {
    let mut profile = default_profile();
    profile.name = "Client Alpha".to_string();
    profile.ssh_host = "ssh.client.example".to_string();
    profile.ssh_user = "alice".to_string();
    profile.private_key_path = "C:\\Users\\Alice\\.ssh\\id_ed25519".to_string();

    let (redacted, count) = redact_log_line(
            "Client Alpha alice@ssh.client.example -i C:\\Users\\Alice\\.ssh\\id_ed25519 SHA256:abcdef Bearer token123 Authorization: Bearer secret",
            &[profile],
        );

    assert!(count >= 6);
    assert!(!redacted.contains("Client Alpha"));
    assert!(!redacted.contains("ssh.client.example"));
    assert!(!redacted.contains("id_ed25519"));
    assert!(!redacted.contains("SHA256:abcdef"));
    assert!(!redacted.contains("token123"));
    assert!(!redacted.contains("Bearer secret"));
}

#[test]
fn redact_log_line_masks_password_and_passphrase_prompts() {
    let profile = default_profile();
    let (redacted, count) = redact_log_line(
        "alice@host's password: hunter2",
        std::slice::from_ref(&profile),
    );
    assert!(count >= 1);
    assert!(!redacted.contains("hunter2"));
    assert!(redacted.contains("password:"));

    let (redacted, count) =
        redact_log_line("Password: my secret value", std::slice::from_ref(&profile));
    assert!(count >= 1);
    assert!(!redacted.contains("my secret value"));
    assert!(redacted.contains("Password:"));

    let (redacted, count) = redact_log_line(
        "Enter passphrase for key '/home/alice/.ssh/id': p@ss w0rd",
        std::slice::from_ref(&profile),
    );
    assert!(count >= 1);
    assert!(!redacted.contains("p@ss w0rd"));
    assert!(redacted.contains("Enter passphrase"));

    // Benign messages without colon should NOT be redacted by the password pattern.
    let (redacted, _) = redact_log_line("Permission denied (publickey,password).", &[profile]);
    assert!(redacted.contains("publickey,password"));
}

#[test]
fn diagnostic_profiles_summary_omits_sensitive_profile_fields() {
    let mut profile = default_profile();
    profile.id = "profile-secret".to_string();
    profile.name = "Client Alpha".to_string();
    profile.ssh_host = "secret.example.com".to_string();
    profile.ssh_user = "alice".to_string();
    profile.auth_method = AuthMethod::Password;
    profile.private_key_path = "C:\\Users\\Alice\\.ssh\\id_ed25519".to_string();
    profile.local_proxy_port = 2334;
    profile.ssh_port = 2222;
    profile.remote_proxy_port = 27890;
    profile.reconnect_enabled = true;
    profile.remember_ssh_password = true;

    let summary = diagnostic_profiles_summary(&[profile]);
    let json = serde_json::to_string(&summary).expect("diagnostic summary should serialize");

    assert!(json.contains("\"profileCount\":1"));
    assert!(json.contains("\"authMethod\":\"password\""));
    assert!(json.contains("\"localProxyPort\":2334"));
    assert!(json.contains("\"sshPort\":2222"));
    assert!(json.contains("\"remoteProxyPort\":27890"));
    assert!(json.contains("\"reconnectEnabled\":true"));
    assert!(json.contains("\"hasPrivateKeyPath\":true"));
    assert!(!json.contains("Client Alpha"));
    assert!(!json.contains("secret.example.com"));
    assert!(!json.contains("alice"));
    assert!(!json.contains("id_ed25519"));
    assert!(!json.contains("hunter2"));
    assert!(!json.to_lowercase().contains("token"));
}

#[test]
fn diagnostic_log_lines_omit_raw_messages_and_profile_ids() {
    let entry = TunnelLogEntry {
        id: 7,
        timestamp_ms: 123_456,
        level: "ERROR".to_string(),
        source: "ssh_stderr".to_string(),
        profile_id: Some("profile-secret".to_string()),
        message:
            "Client Alpha alice@secret.example.com -i C:\\Users\\Alice\\.ssh\\id_ed25519 token123"
                .to_string(),
    };

    let line = format_diagnostic_log_entry(&entry);

    assert!(line.contains("123456 [ERROR]"));
    assert!(line.contains("source=ssh_stderr"));
    assert!(line.contains("profile=linked"));
    assert!(line.contains("message=<omitted-for-privacy>"));
    assert!(!line.contains("profile-secret"));
    assert!(!line.contains("Client Alpha"));
    assert!(!line.contains("secret.example.com"));
    assert!(!line.contains("alice"));
    assert!(!line.contains("id_ed25519"));
    assert!(!line.contains("token123"));

    let legacy = format_diagnostic_legacy_log_line();
    assert!(legacy.contains("message=<omitted-for-privacy>"));
    assert!(!legacy.contains("Client Alpha"));
}

#[test]
fn diagnostic_zip_contains_fixed_files() {
    let dir = temp_ssh_home("diagnostic-zip");
    let path = dir.join("bundle.zip");
    let contents = [
        ("manifest.json", "{}".to_string()),
        ("environment.json", "{}".to_string()),
        ("profiles-summary.json", "{}".to_string()),
        ("log-storage.json", "{}".to_string()),
        ("logs/redacted.log", "redacted".to_string()),
        ("README.txt", "readme".to_string()),
    ];

    write_diagnostic_zip(&path, &contents).expect("diagnostic zip should be written");

    let file = fs::File::open(&path).expect("diagnostic zip should exist");
    let mut archive = zip::ZipArchive::new(file).expect("diagnostic zip should open");
    let mut names = archive.file_names().map(str::to_string).collect::<Vec<_>>();
    names.sort();

    assert_eq!(
        names,
        vec![
            "README.txt",
            "environment.json",
            "log-storage.json",
            "logs/redacted.log",
            "manifest.json",
            "profiles-summary.json",
        ]
    );

    let mut redacted = String::new();
    archive
        .by_name("logs/redacted.log")
        .expect("redacted log should exist")
        .read_to_string(&mut redacted)
        .expect("redacted log should be readable");
    assert_eq!(redacted, "redacted");

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn diagnostic_zip_payload_omits_sensitive_profile_and_log_data() {
    let dir = temp_ssh_home("diagnostic-privacy");
    let path = dir.join("bundle.zip");
    let mut profile = default_profile();
    profile.id = "profile-secret".to_string();
    profile.name = "Client Alpha".to_string();
    profile.ssh_host = "secret.example.com".to_string();
    profile.ssh_user = "alice".to_string();
    profile.private_key_path = "C:\\Users\\Alice\\.ssh\\id_ed25519".to_string();
    profile.auth_method = AuthMethod::Password;
    let entry = TunnelLogEntry {
        id: 8,
        timestamp_ms: 123_457,
        level: "WARN".to_string(),
        source: "tunnel".to_string(),
        profile_id: Some(profile.id.clone()),
        message: "Client Alpha alice secret.example.com C:\\Users\\Alice\\.ssh\\id_ed25519 hunter2 Bearer secret-token".to_string(),
    };
    let contents = [
        (
            "manifest.json",
            r#"{"automaticUpload":false,"files":["manifest.json","environment.json","profiles-summary.json","log-storage.json","logs/redacted.log","README.txt"]}"#
                .to_string(),
        ),
        (
            "environment.json",
            r#"{"os":"windows","arch":"x86_64","checks":[]}"#.to_string(),
        ),
        (
            "profiles-summary.json",
            serde_json::to_string_pretty(&diagnostic_profiles_summary(&[profile]))
                .expect("diagnostic summary should serialize"),
        ),
        (
            "log-storage.json",
            r#"{"logDir":"<app-log-dir>","currentFile":"<current-log-file>","totalBytes":0,"fileCount":0}"#
                .to_string(),
        ),
        (
            "logs/redacted.log",
            format!("{}\n", format_diagnostic_log_entry(&entry)),
        ),
        ("README.txt", diagnostic_readme()),
    ];

    write_diagnostic_zip(&path, &contents).expect("diagnostic zip should be written");

    let file = fs::File::open(&path).expect("diagnostic zip should exist");
    let mut archive = zip::ZipArchive::new(file).expect("diagnostic zip should open");
    let mut payload = String::new();
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .expect("zip entry should be readable");
        file.read_to_string(&mut payload)
            .expect("zip entry should be text");
        payload.push('\n');
    }

    assert!(!payload.contains("Client Alpha"));
    assert!(!payload.contains("secret.example.com"));
    assert!(!payload.contains("alice"));
    assert!(!payload.contains("profile-secret"));
    assert!(!payload.contains("id_ed25519"));
    assert!(!payload.contains("hunter2"));
    assert!(!payload.contains("secret-token"));
    assert!(payload.contains("message=<omitted-for-privacy>"));
    assert!(payload.contains("\"automaticUpload\":false"));

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn startup_preferences_default_to_silent_launch() {
    assert!(StartupPreferences::default().silent_start_on_boot);

    let parsed = serde_json::from_str::<StartupPreferences>("{}")
        .expect("missing startup preference fields should use defaults");
    assert!(parsed.silent_start_on_boot);

    let disabled = serde_json::from_str::<StartupPreferences>(r#"{"silentStartOnBoot":false}"#)
        .expect("explicit startup preference should parse");
    assert!(!disabled.silent_start_on_boot);
}

#[test]
fn startup_arg_detection_requires_exact_flag() {
    assert!(startup_args_request_silent(["sshnet-share", STARTUP_ARG]));
    assert!(!startup_args_request_silent(["sshnet-share"]));
    assert!(!startup_args_request_silent([
        "sshnet-share",
        "--sshnet-startup=false"
    ]));
}

#[test]
fn validate_profile_rejects_unsafe_remote_ports_and_timeouts() {
    let mut profile = default_profile();
    profile.remote_proxy_port = 80;
    assert!(validate_profile(&profile).is_err());

    profile.remote_proxy_port = 27890;
    profile.connect_timeout_seconds = 2;
    assert!(validate_profile(&profile).is_err());
}

#[test]
fn profile_deserialize_applies_defaults_for_missing_fields() {
    let raw = r#"[{
        "id": "legacy",
        "name": "Legacy",
        "sshHost": "legacy.example.com",
        "sshUser": "deploy"
    }]"#;
    let profiles = serde_json::from_str::<Vec<Profile>>(raw).expect("profile should deserialize");
    let profile = profiles.first().expect("profile should exist");

    assert_eq!(profile.schema_version, 1);
    assert_eq!(profile.local_proxy_host, "127.0.0.1");
    assert_eq!(profile.local_proxy_port, 2334);
    assert_eq!(profile.local_proxy_protocol, ProxyProtocol::Http);
    assert_eq!(profile.ssh_port, 22);
    assert!(matches!(profile.auth_method, AuthMethod::Key));
    assert_eq!(profile.private_key_path, "");
    assert_eq!(
        profile.connect_timeout_seconds,
        DEFAULT_CONNECT_TIMEOUT_SECONDS
    );
    assert_eq!(
        profile.reconnect_interval_seconds,
        DEFAULT_RECONNECT_INTERVAL_SECONDS
    );
    assert_eq!(profile.remote_bind_host, "127.0.0.1");
    assert_eq!(profile.remote_proxy_port, 27890);
    assert_eq!(profile.no_proxy, vec!["localhost", "127.0.0.1", "::1"]);
    assert!(validate_profile(profile).is_ok());
}

#[test]
fn validate_profile_rejects_pageant_auth_for_0_1_0() {
    let mut profile = default_profile();
    profile.auth_method = AuthMethod::Pageant;

    let error = validate_profile(&profile).expect_err("Pageant should be rejected");
    assert!(error.contains("Pageant authentication is not supported"));
}

#[test]
fn validate_profile_rejects_ssh_option_like_target_fields() {
    let mut profile = default_profile();
    profile.ssh_host = "-oProxyCommand=calc.exe".to_string();
    assert!(validate_profile(&profile).is_err());

    profile = default_profile();
    profile.ssh_user = "-oProxyCommand=calc.exe".to_string();
    assert!(validate_profile(&profile).is_err());

    profile = default_profile();
    profile.ssh_host = "example.com -oProxyCommand=calc.exe".to_string();
    assert!(validate_profile(&profile).is_err());

    profile = default_profile();
    profile.ssh_user = "appuser\r\nProxyCommand=calc.exe".to_string();
    assert!(validate_profile(&profile).is_err());
}

#[test]
fn validate_profile_rejects_unsafe_private_key_paths() {
    let mut profile = default_profile();
    profile.private_key_path = "-oProxyCommand=calc.exe".to_string();
    assert!(validate_profile(&profile).is_err());

    profile.private_key_path = "C:\\Users\\user name\\.ssh\\id_ed25519".to_string();
    assert!(validate_profile(&profile).is_err());
}

#[cfg(windows)]
#[test]
fn validate_profile_rejects_network_and_device_private_key_paths() {
    let mut profile = default_profile();
    profile.private_key_path = r"\\server\share\id_ed25519".to_string();
    assert!(validate_profile(&profile).is_err());

    profile.private_key_path = r"\\?\UNC\server\share\id_ed25519".to_string();
    assert!(validate_profile(&profile).is_err());

    profile.private_key_path = r"\\.\NUL".to_string();
    assert!(validate_profile(&profile).is_err());

    profile.private_key_path = r"\\?\C:\Users\user\.ssh\id_ed25519".to_string();
    assert!(validate_profile(&profile).is_ok());
}

#[test]
fn validate_profiles_allows_shared_local_proxy_ports() {
    let mut office = default_profile();
    office.id = "office".to_string();
    office.name = "Office".to_string();
    office.local_proxy_port = 2334;
    office.remote_proxy_port = 27890;

    let mut lab = default_profile();
    lab.id = "lab".to_string();
    lab.name = "Lab".to_string();
    lab.ssh_host = "lab.example.com".to_string();
    lab.local_proxy_port = 2334;
    lab.remote_proxy_port = 27891;

    assert!(validate_profiles(&[office, lab]).is_ok());
}

#[test]
fn validate_profiles_rejects_same_server_remote_port_conflicts() {
    let mut office = default_profile();
    office.id = "office".to_string();
    office.name = "Office".to_string();
    office.ssh_host = "Server.Example.com".to_string();
    office.remote_bind_host = "127.0.0.1".to_string();
    office.remote_proxy_port = 27890;

    let mut conflict = default_profile();
    conflict.id = "lab".to_string();
    conflict.name = "Lab".to_string();
    conflict.ssh_host = "server.example.COM".to_string();
    conflict.remote_bind_host = "127.0.0.1".to_string();
    conflict.remote_proxy_port = 27890;

    let error = validate_profiles(&[office, conflict]).expect_err("remote port should conflict");
    assert!(error.contains("Office"));
}

#[test]
fn validate_profiles_allows_distinct_remote_port_dimensions() {
    let mut base = default_profile();
    base.id = "base".to_string();
    base.name = "Base".to_string();
    base.ssh_host = "server.example.com".to_string();
    base.ssh_port = 22;
    base.remote_bind_host = "127.0.0.1".to_string();
    base.remote_proxy_port = 27890;

    let mut different_host = base.clone();
    different_host.id = "different-host".to_string();
    different_host.ssh_host = "other.example.com".to_string();
    assert!(validate_profiles(&[base.clone(), different_host]).is_ok());

    let mut different_ssh_port = base.clone();
    different_ssh_port.id = "different-ssh-port".to_string();
    different_ssh_port.ssh_port = 2222;
    assert!(validate_profiles(&[base.clone(), different_ssh_port]).is_ok());

    let mut different_remote_port = base.clone();
    different_remote_port.id = "different-remote-port".to_string();
    different_remote_port.remote_proxy_port = 27891;
    assert!(validate_profiles(&[base, different_remote_port]).is_ok());
}

#[test]
fn build_ssh_args_uses_strict_app_known_hosts() {
    let profile = default_profile();
    let args = build_ssh_args(&profile, Path::new("known_hosts"));

    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "-o" && pair[1] == "StrictHostKeyChecking=yes"));
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "-o" && pair[1] == "UserKnownHostsFile=known_hosts"));
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "-o" && pair[1] == "HostKeyAlias=sshnet-default"));
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "-o" && pair[1] == "ConnectTimeout=10"));
    assert!(!args.iter().any(|arg| arg == "ClearAllForwardings=yes"));
    assert!(args
        .windows(2)
        .any(|pair| { pair[0] == "-R" && pair[1] == "127.0.0.1:27890:127.0.0.1:2334" }));
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "-l" && pair[1] == "appuser"));
    assert_eq!(args.last().map(String::as_str), Some("example.com"));
    assert!(!args.iter().any(|arg| arg == "appuser@example.com"));
}

#[test]
fn password_auth_uses_askpass_safe_ssh_options() {
    let mut profile = default_profile();
    profile.auth_method = AuthMethod::Password;
    profile.private_key_path = "C:\\Users\\user\\.ssh\\id_ed25519".to_string();
    let args = build_ssh_args(&profile, Path::new("known_hosts"));

    assert!(validate_auth_secret(&profile, None).is_err());
    assert!(validate_auth_secret(&profile, Some("secret")).is_ok());
    assert_eq!(
        ssh_startup_check_duration(&profile),
        Duration::from_secs(DEFAULT_CONNECT_TIMEOUT_SECONDS as u64)
            + SSH_STARTUP_CHECK_PASSWORD_EXTRA
    );
    assert!(args.iter().any(|arg| arg == "-v"));
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "-o" && pair[1] == "BatchMode=no"));
    assert!(args.windows(2).any(|pair| {
        pair[0] == "-o" && pair[1] == "PreferredAuthentications=password,keyboard-interactive"
    }));
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "-o" && pair[1] == "PubkeyAuthentication=no"));
    assert!(args
        .windows(2)
        .any(|pair| pair[0] == "-o" && pair[1] == "NumberOfPasswordPrompts=1"));
    assert!(!args.iter().any(|arg| arg == "-i"));
    assert!(!args.iter().any(|arg| arg == "secret"));
}

#[test]
fn ssh_startup_signal_detects_auth_and_forward_success() {
    assert_eq!(
        ssh_startup_signal(
            "Authenticated to 10.201.90.109 ([10.201.90.109]:22) using \"password\"."
        ),
        Some(SshStartupSignal::Authenticated)
    );
    assert_eq!(
        ssh_startup_signal(
            "debug1: remote forward success for: listen 127.0.0.1:12334, connect 127.0.0.1:2334"
        ),
        Some(SshStartupSignal::RemoteForwardReady)
    );
    assert_eq!(
        ssh_startup_signal("Permission denied, please try again."),
        None
    );
}

#[test]
fn ssh_verbose_success_lines_are_not_logged_as_errors() {
    assert_eq!(
        ssh_output_log_level(
            "ERROR",
            "Authenticated to 10.201.90.109 ([10.201.90.109]:22) using \"password\"."
        ),
        "INFO"
    );
    assert_eq!(
        ssh_output_log_level("ERROR", "Permission denied, please try again."),
        "ERROR"
    );
    assert_eq!(
        ssh_output_log_level("ERROR", "OpenSSH_for_Windows_9.5p2, LibreSSL 3.8.2"),
        "INFO"
    );
    assert!(is_ssh_verbose_noise(
        "debug1: remote forward success for: listen 127.0.0.1:12334"
    ));
}

#[test]
fn stale_ssh_version_log_entries_are_normalized_for_view() {
    let entry = TunnelLogEntry {
        id: 1,
        timestamp_ms: 1,
        level: "ERROR".to_string(),
        source: "ssh_stderr".to_string(),
        profile_id: None,
        message: "OpenSSH_for_Windows_9.5p2, LibreSSL 3.8.2".to_string(),
    };

    assert_eq!(normalize_log_entry_level(entry).level, "INFO");
}

#[test]
fn profile_save_preserves_newer_last_connected_at() {
    let mut incoming = default_profile();
    incoming.id = "profile-a".to_string();
    incoming.name = "Edited name".to_string();
    incoming.last_connected_at = None;

    let mut previous = incoming.clone();
    previous.name = "Old name".to_string();
    previous.last_connected_at = Some(42_000);

    let mut profiles = vec![incoming];
    merge_profile_server_fields(&mut profiles, &[previous]);

    assert_eq!(profiles[0].name, "Edited name");
    assert_eq!(profiles[0].last_connected_at, Some(42_000));

    profiles[0].last_connected_at = Some(99_000);
    let mut older_previous = profiles[0].clone();
    older_previous.last_connected_at = Some(42_000);
    merge_profile_server_fields(&mut profiles, &[older_previous]);

    assert_eq!(profiles[0].last_connected_at, Some(99_000));
}

#[test]
fn normalize_profiles_preserves_empty_profile_store() {
    let mut profiles = Vec::new();
    normalize_profiles(&mut profiles);

    assert!(profiles.is_empty());
}

#[test]
fn classify_ssh_failure_produces_actionable_messages() {
    let auth_logs = vec![
        "Permission denied, please try again.".to_string(),
        "Permission denied (publickey,password).".to_string(),
    ];
    assert_eq!(
        classify_ssh_failure(&auth_logs),
        Some("SSH 认证失败：请检查用户名、密码/密钥，或服务器是否允许当前认证方式。")
    );

    let timeout_logs =
        vec!["ssh: connect to host example.com port 22: Connection timed out".to_string()];
    assert_eq!(
        classify_ssh_failure(&timeout_logs),
        Some("SSH 连接超时：请检查服务器地址、端口、防火墙或网络连通性。")
    );

    let forwarding_logs =
        vec!["Warning: remote port forwarding failed for listen port 12334".to_string()];
    assert_eq!(
        classify_ssh_failure(&forwarding_logs),
        Some("SSH 反向隧道建立失败：远端端口可能已被占用，请换一个端口或先在服务器上释放该端口。")
    );

    let prohibited_logs = vec!["administratively prohibited: open failed".to_string()];
    assert_eq!(
        classify_ssh_failure(&prohibited_logs),
        Some(
            "SSH 反向隧道被服务器拒绝：服务器的 sshd 配置可能禁用了 TCP 转发（AllowTcpForwarding/GatewayPorts），请联系服务器管理员。"
        )
    );

    assert_eq!(
        classify_ssh_failure(&["some unrelated error".to_string()]),
        None
    );
}

#[test]
fn tray_task_reservation_rejects_concurrent_tasks() {
    let manager = TunnelManager::default();
    assert!(reserve_tray_task(&manager, "启动全部配置").is_ok());
    assert!(reserve_tray_task(&manager, "停止全部隧道").is_err());
    clear_tray_task(&manager);
    assert!(reserve_tray_task(&manager, "停止全部隧道").is_ok());
    clear_tray_task(&manager);
}

#[test]
fn log_export_filter_matches_level_profile_and_source() {
    let entry = TunnelLogEntry {
        id: 1,
        timestamp_ms: 10,
        level: "ERROR".to_string(),
        source: "ssh_stderr".to_string(),
        profile_id: Some("profile-office".to_string()),
        message: "Permission denied".to_string(),
    };

    assert!(log_entry_matches_filter(
        &entry,
        Some(&LogExportFilter {
            levels: vec!["ERROR".to_string()],
            profile_id: Some("profile-office".to_string()),
            source: Some("ssh_stderr".to_string()),
            from_timestamp_ms: None,
            to_timestamp_ms: None,
        }),
    ));
    assert!(!log_entry_matches_filter(
        &entry,
        Some(&LogExportFilter {
            levels: vec!["WARN".to_string()],
            profile_id: Some("profile-office".to_string()),
            source: Some("ssh_stderr".to_string()),
            from_timestamp_ms: None,
            to_timestamp_ms: None,
        }),
    ));
    assert!(!log_entry_matches_filter(
        &entry,
        Some(&LogExportFilter {
            levels: vec!["ERROR".to_string()],
            profile_id: Some("profile-home".to_string()),
            source: Some("ssh_stderr".to_string()),
            from_timestamp_ms: None,
            to_timestamp_ms: None,
        }),
    ));
    assert!(!log_entry_matches_filter(
        &entry,
        Some(&LogExportFilter {
            levels: vec!["ERROR".to_string()],
            profile_id: Some("profile-office".to_string()),
            source: Some("app".to_string()),
            from_timestamp_ms: None,
            to_timestamp_ms: None,
        }),
    ));
}

#[test]
fn log_export_filter_matches_date_range() {
    let entry = TunnelLogEntry {
        id: 1,
        timestamp_ms: 1_000,
        level: "INFO".to_string(),
        source: "app".to_string(),
        profile_id: None,
        message: "Windowed message".to_string(),
    };

    assert!(log_entry_matches_filter(
        &entry,
        Some(&LogExportFilter {
            levels: vec!["INFO".to_string()],
            profile_id: None,
            source: None,
            from_timestamp_ms: Some(900),
            to_timestamp_ms: Some(1_100),
        }),
    ));
    assert!(!log_entry_matches_filter(
        &entry,
        Some(&LogExportFilter {
            levels: vec!["INFO".to_string()],
            profile_id: None,
            source: None,
            from_timestamp_ms: Some(1_001),
            to_timestamp_ms: None,
        }),
    ));
    assert!(!log_entry_matches_filter(
        &entry,
        Some(&LogExportFilter {
            levels: vec!["INFO".to_string()],
            profile_id: None,
            source: None,
            from_timestamp_ms: None,
            to_timestamp_ms: Some(999),
        }),
    ));
}

#[test]
fn legacy_log_lines_only_export_without_specific_filters() {
    assert_eq!(
        format_log_export_line("legacy line", None),
        Some("legacy line".to_string())
    );
    assert_eq!(
        format_log_export_line(
            "legacy line",
            Some(&LogExportFilter {
                levels: vec!["INFO".to_string(), "WARN".to_string(), "ERROR".to_string()],
                profile_id: None,
                source: None,
                from_timestamp_ms: None,
                to_timestamp_ms: None,
            }),
        ),
        Some("legacy line".to_string())
    );
    assert_eq!(
        format_log_export_line(
            "legacy line",
            Some(&LogExportFilter {
                levels: vec!["ERROR".to_string()],
                profile_id: None,
                source: None,
                from_timestamp_ms: None,
                to_timestamp_ms: None,
            }),
        ),
        None
    );
    assert_eq!(
        format_log_export_line(
            "legacy line",
            Some(&LogExportFilter {
                levels: vec!["INFO".to_string(), "WARN".to_string(), "ERROR".to_string()],
                profile_id: Some("profile-office".to_string()),
                source: None,
                from_timestamp_ms: None,
                to_timestamp_ms: None,
            }),
        ),
        None
    );
}

#[test]
fn filtered_log_export_can_fall_back_to_memory_buffer() {
    let manager = TunnelManager::default();
    push_tunnel_log_with_source_to_store(
        &manager.logs,
        "WARN",
        "ssh_stderr",
        Some("profile-home"),
        "Home warning",
    );
    push_tunnel_log_with_source_to_store(
        &manager.logs,
        "ERROR",
        "ssh_stderr",
        Some("profile-office"),
        "Office error",
    );
    push_tunnel_log_with_source_to_store(&manager.logs, "ERROR", "app", None, "App error");

    let filter = LogExportFilter {
        levels: vec!["ERROR".to_string()],
        profile_id: Some("profile-office".to_string()),
        source: None,
        from_timestamp_ms: None,
        to_timestamp_ms: None,
    };
    let mut exported_lines = Vec::new();
    let mut redaction_count = 0;
    append_memory_logs_for_export(
        &manager,
        Some(&filter),
        &[],
        &mut exported_lines,
        &mut redaction_count,
    )
    .expect("memory export should succeed");

    assert_eq!(exported_lines.len(), 1);
    assert!(exported_lines[0].contains("profile=profile-office"));
    assert!(exported_lines[0].contains("Office error"));

    let app_filter = LogExportFilter {
        levels: vec!["ERROR".to_string()],
        profile_id: None,
        source: Some("app".to_string()),
        from_timestamp_ms: None,
        to_timestamp_ms: None,
    };
    exported_lines.clear();
    append_memory_logs_for_export(
        &manager,
        Some(&app_filter),
        &[],
        &mut exported_lines,
        &mut redaction_count,
    )
    .expect("memory app export should succeed");

    assert_eq!(exported_lines.len(), 1);
    assert!(exported_lines[0].contains("app"));
    assert!(exported_lines[0].contains("App error"));
}

#[test]
fn cancel_all_reconnect_tasks_returns_pending_profiles() {
    let manager = TunnelManager::default();
    let mut profile = default_profile();
    profile.id = "profile-reconnect".to_string();
    profile.reconnect_enabled = true;

    manager
        .reconnects
        .lock()
        .expect("reconnect lock should open")
        .insert(
            profile.id.clone(),
            ReconnectTask {
                profile,
                attempt: 2,
                generation: 1,
                next_attempt_at: Instant::now() + Duration::from_secs(10),
            },
        );

    let cancelled =
        cancel_all_reconnect_tasks(&manager).expect("reconnect cancellation should succeed");

    assert_eq!(cancelled.len(), 1);
    assert_eq!(cancelled[0].id, "profile-reconnect");
    assert!(manager
        .reconnects
        .lock()
        .expect("reconnect lock should open")
        .is_empty());
}

#[test]
fn log_storage_size_counts_exports_recursively() {
    let root = temp_ssh_home("log-storage-size");
    let log_dir = root.join("logs");
    fs::create_dir_all(log_dir.join("exports")).expect("exports dir should be created");
    fs::write(log_dir.join("current.jsonl"), "abc").expect("current log should be written");
    fs::write(log_dir.join("exports").join("export.log"), "defgh")
        .expect("export log should be written");

    let (bytes, files) = log_storage_size(&log_dir).expect("storage size should be read");

    assert_eq!(bytes, 8);
    assert_eq!(files, 2);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn app_event_store_assigns_ids_and_keeps_recent_events() {
    let store = AppEventStore::default();

    for index in 0..105 {
        let event = push_app_event_to_store(
            &store,
            if index % 2 == 0 { "INFO" } else { "WARN" },
            "tray",
            "Test event",
            "Local event only",
            Some("profile-test"),
        )
        .expect("event should be stored");
        assert_eq!(event.id, index + 1);
    }

    let events = app_event_snapshot(&store).expect("event snapshot should be read");

    assert_eq!(events.len(), 100);
    assert_eq!(events.first().map(|event| event.id), Some(6));
    assert_eq!(events.last().map(|event| event.id), Some(105));
    assert_eq!(
        events.last().and_then(|event| event.profile_id.as_deref()),
        Some("profile-test")
    );
}

#[test]
fn app_event_store_normalizes_frontend_recorded_input() {
    let store = AppEventStore::default();
    let long_message = "x".repeat(300);
    let event = push_app_event_to_store(
        &store,
        "DEBUG",
        "unexpected-category",
        "  Title\r\nwith controls  ",
        &long_message,
        None,
    )
    .expect("event should be stored");

    assert_eq!(event.level, "INFO");
    assert_eq!(event.category, "app");
    assert_eq!(event.title, "Title  with controls");
    assert_eq!(event.message.chars().count(), 240);
}

#[test]
fn parse_ssh_config_hosts_reads_aliases_and_options() {
    let hosts = parse_ssh_config_hosts(
        r#"
Host office office-short *.internal !blocked
  HostName ssh.example.com
  User appuser
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host lab
  HostName 192.0.2.10
  Port not-a-number

Host *
  User fallback
  Port 22
"#,
        Path::new("C:\\Users\\tester"),
    );

    assert_eq!(hosts.len(), 3);
    assert_eq!(hosts[0].alias, "office");
    assert_eq!(hosts[0].host_name.as_deref(), Some("ssh.example.com"));
    assert_eq!(hosts[0].user.as_deref(), Some("appuser"));
    assert_eq!(hosts[0].port, Some(2222));
    assert!(hosts[0].identity_file.as_deref().is_some_and(|path| {
        path.ends_with(r".ssh\id_ed25519") || path.ends_with(".ssh/id_ed25519")
    }));
    assert_eq!(hosts[1].alias, "office-short");
    assert_eq!(hosts[2].alias, "lab");
    assert_eq!(hosts[2].host_name.as_deref(), Some("192.0.2.10"));
    assert_eq!(hosts[2].user.as_deref(), Some("fallback"));
    assert_eq!(hosts[2].port, Some(22));
}

#[test]
fn parse_ssh_config_hosts_supports_equals_quotes_and_first_value_wins() {
    let hosts = parse_ssh_config_hosts(
        r#"
Host quoted
  HostName=ssh.example.com
  User = first
  User second
  IdentityFile "~\.ssh\id#ed25519"

Match host *
  User ignored

Host none-key
  IdentityFile none
"#,
        Path::new("C:\\Users\\tester"),
    );

    assert_eq!(hosts.len(), 2);
    assert_eq!(hosts[0].alias, "quoted");
    assert_eq!(hosts[0].host_name.as_deref(), Some("ssh.example.com"));
    assert_eq!(hosts[0].user.as_deref(), Some("first"));
    assert!(hosts[0]
        .identity_file
        .as_deref()
        .is_some_and(|path| path.ends_with(r".ssh\id#ed25519")));
    assert_eq!(hosts[1].alias, "none-key");
    assert_eq!(hosts[1].identity_file, None);
}

#[test]
fn parse_ssh_config_hosts_applies_global_defaults_and_explicit_none() {
    let hosts = parse_ssh_config_hosts(
        r#"
User global-user

Host none-key
  IdentityFile none

Host inherited
  HostName inherited.example.com

Host *
  Port = 2222
  IdentityFile ~/.ssh/fallback
"#,
        Path::new("C:\\Users\\tester"),
    );

    assert_eq!(hosts.len(), 2);
    assert_eq!(hosts[0].alias, "none-key");
    assert_eq!(hosts[0].user.as_deref(), Some("global-user"));
    assert_eq!(hosts[0].port, Some(2222));
    assert_eq!(hosts[0].identity_file, None);
    assert_eq!(hosts[1].alias, "inherited");
    assert_eq!(hosts[1].user.as_deref(), Some("global-user"));
    assert_eq!(hosts[1].port, Some(2222));
    assert!(hosts[1]
        .identity_file
        .as_deref()
        .is_some_and(|path| path.ends_with(r".ssh\fallback") || path.ends_with(".ssh/fallback")));
}

#[test]
fn parse_ssh_config_include_expands_in_place_and_sorts_globs() {
    let home = temp_ssh_home("include-in-place");
    write_ssh_config_file(
        &home,
        "config",
        r#"
Host prod
  User first
  Include prod.conf
  HostName prod.example.com

Include conf.d/*.conf
"#,
    );
    write_ssh_config_file(
        &home,
        "prod.conf",
        r#"
User second
Port 2200
"#,
    );
    write_ssh_config_file(
        &home,
        "conf.d/10-defaults.conf",
        r#"
Host *
  IdentityFile ~/.ssh/id_ed25519
"#,
    );
    write_ssh_config_file(
        &home,
        "conf.d/20-lab.conf",
        r#"
Host lab
  HostName lab.example.com
"#,
    );

    let hosts = parse_ssh_config_hosts_from_file(&home.join(".ssh").join("config"), &home)
        .expect("include config should parse");

    assert_eq!(hosts.len(), 2);
    assert_eq!(hosts[0].alias, "prod");
    assert_eq!(hosts[0].user.as_deref(), Some("first"));
    assert_eq!(hosts[0].port, Some(2200));
    assert_eq!(hosts[0].host_name.as_deref(), Some("prod.example.com"));
    assert!(hosts[0].identity_file.as_deref().is_some_and(|path| {
        path.ends_with(r".ssh\id_ed25519") || path.ends_with(".ssh/id_ed25519")
    }));
    assert_eq!(hosts[1].alias, "lab");
    assert_eq!(hosts[1].host_name.as_deref(), Some("lab.example.com"));

    let _ = fs::remove_dir_all(home);
}

#[test]
fn parse_ssh_config_include_relative_paths_use_root_ssh_dir() {
    let home = temp_ssh_home("include-relative");
    write_ssh_config_file(&home, "config", "Include nested/one.conf\n");
    write_ssh_config_file(&home, "nested/one.conf", "Include two.conf\n");
    write_ssh_config_file(
        &home,
        "two.conf",
        r#"
Host root-two
  HostName root-two.example.com
"#,
    );
    write_ssh_config_file(
        &home,
        "nested/two.conf",
        r#"
Host nested-two
  HostName nested-two.example.com
"#,
    );

    let hosts = parse_ssh_config_hosts_from_file(&home.join(".ssh").join("config"), &home)
        .expect("relative include config should parse");

    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].alias, "root-two");
    assert_eq!(hosts[0].host_name.as_deref(), Some("root-two.example.com"));

    let _ = fs::remove_dir_all(home);
}

#[test]
fn parse_ssh_config_include_skips_cycles_and_match_includes() {
    let home = temp_ssh_home("include-cycle");
    write_ssh_config_file(
        &home,
        "config",
        r#"
Include a.conf
Match host *
  Include match.conf
Host final
  HostName final.example.com
"#,
    );
    write_ssh_config_file(
        &home,
        "a.conf",
        r#"
Host loop
  HostName loop.example.com
Include b.conf
"#,
    );
    write_ssh_config_file(
        &home,
        "b.conf",
        r#"
Include a.conf
Host from-b
  HostName from-b.example.com
"#,
    );
    write_ssh_config_file(
        &home,
        "match.conf",
        r#"
Host should-not-load
  HostName should-not-load.example.com
"#,
    );

    let hosts = parse_ssh_config_hosts_from_file(&home.join(".ssh").join("config"), &home)
        .expect("cyclic include config should parse");
    let aliases = hosts
        .iter()
        .map(|host| host.alias.as_str())
        .collect::<Vec<_>>();

    assert_eq!(aliases, vec!["loop", "from-b", "final"]);
    assert!(!aliases.contains(&"should-not-load"));

    let _ = fs::remove_dir_all(home);
}

#[test]
fn parse_ssh_config_include_match_state_leaks_across_included_files() {
    let home = temp_ssh_home("include-match-state");
    write_ssh_config_file(
        &home,
        "config",
        r#"
Include match-start.conf
Include after-match.conf
Host visible
  HostName visible.example.com
"#,
    );
    write_ssh_config_file(&home, "match-start.conf", "Match host *\n");
    write_ssh_config_file(
        &home,
        "after-match.conf",
        r#"
Host should-not-load
  HostName should-not-load.example.com
"#,
    );

    let hosts = parse_ssh_config_hosts_from_file(&home.join(".ssh").join("config"), &home)
        .expect("match state include config should parse");
    let aliases = hosts
        .iter()
        .map(|host| host.alias.as_str())
        .collect::<Vec<_>>();

    assert_eq!(aliases, vec!["visible"]);

    let _ = fs::remove_dir_all(home);
}

#[test]
fn parse_ssh_config_include_supports_home_absolute_and_multiple_patterns() {
    let home = temp_ssh_home("include-home-absolute");
    let absolute = write_ssh_config_file(
        &home,
        "absolute.conf",
        r#"
Host absolute-host
  HostName absolute.example.com
"#,
    );
    write_ssh_config_file(
        &home,
        "home.conf",
        r#"
Host home-host
  HostName home.example.com
"#,
    );
    write_ssh_config_file(
        &home,
        "config",
        &format!(
            "Include ~/.ssh/home.conf \"{}\" missing/*.conf\n",
            absolute.display()
        ),
    );

    let hosts = parse_ssh_config_hosts_from_file(&home.join(".ssh").join("config"), &home)
        .expect("home and absolute include config should parse");
    let aliases = hosts
        .iter()
        .map(|host| host.alias.as_str())
        .collect::<Vec<_>>();

    assert_eq!(aliases, vec!["home-host", "absolute-host"]);

    let _ = fs::remove_dir_all(home);
}

#[test]
fn proxy_ports_from_text_finds_local_loopback_ports() {
    let ports = proxy_ports_from_text(
        "http=127.0.0.1:2334;https=localhost:2334;socks=[::1]:1080;bad=192.168.1.8:7890",
    );

    assert_eq!(ports, vec![2334, 1080]);
}

#[test]
fn local_proxy_detection_ports_include_profile_and_common_ports() {
    let mut profile = default_profile();
    profile.local_proxy_port = 4567;
    let ports = local_proxy_detection_ports(&profile)
        .into_iter()
        .map(|candidate| candidate.port)
        .collect::<Vec<_>>();

    assert_eq!(ports[0], 4567);
    assert!(ports.contains(&2334));
}

#[test]
fn http_connect_probe_accepts_only_success_status_codes() {
    assert!(is_successful_http_connect_response(
        b"HTTP/1.1 200 Connection established\r\n\r\n"
    ));
    assert!(is_successful_http_connect_response(
        b"HTTP/1.1 204 Connection established\r\n\r\n"
    ));
    assert!(!is_successful_http_connect_response(
        b"HTTP/1.1 400 Bad Request\r\n\r\n"
    ));
    assert!(!is_successful_http_connect_response(
        b"HTTP/1.1 405 Method Not Allowed\r\n\r\n"
    ));
    assert!(!is_successful_http_connect_response(
        b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"
    ));
}
