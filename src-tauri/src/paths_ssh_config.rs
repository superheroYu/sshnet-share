use super::*;

pub(super) fn profiles_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| format!("定位配置目录失败：{error}"))?
        .join(PROFILES_FILE_NAME))
}

pub(super) fn legacy_profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| format!("定位配置目录失败：{error}"))?
        .join(LEGACY_PROFILE_FILE_NAME))
}

pub(super) fn known_hosts_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| format!("定位 known_hosts 目录失败：{error}"))?
        .join(KNOWN_HOSTS_FILE_NAME))
}

pub(super) fn user_ssh_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .home_dir()
        .map_err(|error| format!("定位用户主目录失败：{error}"))?
        .join(".ssh")
        .join("config"))
}

pub(super) fn parse_ssh_config_hosts_from_file(
    path: &Path,
    home: &Path,
) -> Result<Vec<SshConfigHost>, String> {
    let ssh_dir = home.join(".ssh");
    let mut state = SshConfigIncludeState::default();
    let lines = load_ssh_config_lines(path, home, &ssh_dir, 0, &mut state)?;
    Ok(parse_ssh_config_hosts(&lines.join("\n"), home))
}

#[derive(Default)]
pub(super) struct SshConfigIncludeState {
    active_paths: HashSet<PathBuf>,
    files_read: usize,
    bytes_read: u64,
    in_match: bool,
}

pub(super) fn load_ssh_config_lines(
    path: &Path,
    home: &Path,
    ssh_dir: &Path,
    depth: usize,
    state: &mut SshConfigIncludeState,
) -> Result<Vec<String>, String> {
    if depth > MAX_SSH_CONFIG_INCLUDE_DEPTH || state.files_read >= MAX_SSH_CONFIG_INCLUDE_FILES {
        return Ok(Vec::new());
    }

    let metadata = match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return Ok(Vec::new()),
    };
    if metadata.len() > MAX_SSH_CONFIG_FILE_BYTES
        || state.bytes_read.saturating_add(metadata.len()) > MAX_SSH_CONFIG_FILE_BYTES
    {
        return Ok(Vec::new());
    }

    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("定位 SSH config 失败 {}：{error}", path.display()))?;
    let active_key = ssh_config_active_path_key(&canonical);
    if !state.active_paths.insert(active_key.clone()) {
        return Ok(Vec::new());
    }

    state.files_read += 1;
    state.bytes_read += metadata.len();
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("读取 SSH config 失败 {}：{error}", path.display()))?;
    let mut lines = Vec::new();

    for raw_line in raw.lines() {
        let line = strip_ssh_config_comment(raw_line);
        let line = line.trim();
        let directive = split_ssh_config_directive(line);

        if let Some((keyword, value)) = directive {
            let keyword = keyword.to_ascii_lowercase();
            match keyword.as_str() {
                "host" => {
                    state.in_match = false;
                    lines.push(raw_line.to_string());
                    continue;
                }
                "match" => {
                    state.in_match = true;
                    lines.push(raw_line.to_string());
                    continue;
                }
                "include" if !state.in_match => {
                    for pattern in split_ssh_config_words(&value) {
                        for include_path in ssh_config_include_paths(&pattern, home, ssh_dir) {
                            lines.extend(load_ssh_config_lines(
                                &include_path,
                                home,
                                ssh_dir,
                                depth + 1,
                                state,
                            )?);
                        }
                    }
                    continue;
                }
                _ => {}
            }
        }

        lines.push(raw_line.to_string());
    }

    state.active_paths.remove(&active_key);
    Ok(lines)
}

pub(super) fn ssh_config_active_path_key(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(path.display().to_string().to_ascii_lowercase())
    }

    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

pub(super) fn ssh_config_include_paths(pattern: &str, home: &Path, ssh_dir: &Path) -> Vec<PathBuf> {
    let Some(pattern_path) = resolve_ssh_config_include_pattern(pattern, home, ssh_dir) else {
        return Vec::new();
    };
    let options = MatchOptions {
        case_sensitive: !cfg!(windows),
        require_literal_separator: false,
        require_literal_leading_dot: false,
    };
    let Ok(matches) = glob_with(&pattern_path.to_string_lossy(), options) else {
        return Vec::new();
    };

    let mut paths = matches
        .filter_map(Result::ok)
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    #[cfg(windows)]
    paths.sort_by_key(|path| path.display().to_string().to_ascii_lowercase());
    #[cfg(not(windows))]
    paths.sort_by_key(|path| path.display().to_string());
    paths
}

pub(super) fn resolve_ssh_config_include_pattern(
    pattern: &str,
    home: &Path,
    ssh_dir: &Path,
) -> Option<PathBuf> {
    let pattern = clean_ssh_config_value(pattern);
    if pattern.is_empty() {
        return None;
    }
    if pattern == "~" {
        return Some(home.to_path_buf());
    }
    if let Some(rest) = pattern
        .strip_prefix("~/")
        .or_else(|| pattern.strip_prefix("~\\"))
    {
        return Some(home.join(rest));
    }
    if pattern.starts_with('~') {
        return None;
    }

    let path = PathBuf::from(&pattern);
    if path.is_absolute() {
        Some(path)
    } else {
        Some(ssh_dir.join(path))
    }
}

pub(super) fn parse_ssh_config_hosts(raw: &str, home: &Path) -> Vec<SshConfigHost> {
    let mut blocks = Vec::<SshConfigHostBlock>::new();
    let mut current: Option<SshConfigHostBlock> = None;
    let mut in_match = false;

    for raw_line in raw.lines() {
        let line = strip_ssh_config_comment(raw_line);
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Some((keyword, value)) = split_ssh_config_directive(line) else {
            continue;
        };
        let keyword = keyword.to_ascii_lowercase();

        if keyword == "host" {
            if let Some(block) = current.take() {
                blocks.push(block);
            }
            current = Some(SshConfigHostBlock {
                patterns: split_ssh_config_words(&value),
                ..Default::default()
            });
            in_match = false;
            continue;
        }

        if keyword == "match" {
            if let Some(block) = current.take() {
                blocks.push(block);
            }
            in_match = true;
            continue;
        }

        if in_match {
            continue;
        }

        if current.is_none() {
            current = Some(SshConfigHostBlock {
                patterns: vec!["*".to_string()],
                ..Default::default()
            });
        }

        if let Some(block) = current.as_mut() {
            apply_ssh_config_directive(block, &keyword, &value, home);
        }
    }

    if let Some(block) = current {
        blocks.push(block);
    }

    let aliases = ssh_config_aliases(&blocks);
    let mut hosts = Vec::new();
    for alias in aliases {
        let mut host = SshConfigHost {
            alias,
            host_name: None,
            user: None,
            port: None,
            identity_file: None,
        };
        let mut identity_file = None;

        for block in &blocks {
            if ssh_config_block_matches(&block.patterns, &host.alias) {
                apply_ssh_config_block_defaults(&mut host, &mut identity_file, block);
            }
        }
        if let Some(SshConfigIdentityFile::File(path)) = identity_file {
            host.identity_file = Some(path);
        }
        hosts.push(host);
    }

    hosts
}

pub(super) fn ssh_config_aliases(blocks: &[SshConfigHostBlock]) -> Vec<String> {
    let mut aliases = Vec::new();
    let mut seen = HashSet::new();
    for block in blocks {
        for pattern in &block.patterns {
            if pattern.starts_with('!')
                || pattern.contains('*')
                || pattern.contains('?')
                || pattern.contains('%')
            {
                continue;
            }
            if seen.insert(pattern.to_ascii_lowercase()) {
                aliases.push(pattern.clone());
            }
        }
    }
    aliases
}

pub(super) fn apply_ssh_config_directive(
    block: &mut SshConfigHostBlock,
    keyword: &str,
    value: &str,
    home: &Path,
) {
    match keyword {
        "hostname" => {
            block
                .host_name
                .get_or_insert_with(|| first_ssh_config_value(value));
        }
        "user" => {
            block
                .user
                .get_or_insert_with(|| first_ssh_config_value(value));
        }
        "port" if block.port.is_none() => {
            if let Ok(port) = first_ssh_config_value(value).parse::<u16>() {
                block.port = Some(port);
            }
        }
        "identityfile" if block.identity_file.is_none() => {
            block.identity_file = expand_identity_file(home, &first_ssh_config_value(value));
        }
        _ => {}
    }
}

pub(super) fn apply_ssh_config_block_defaults(
    host: &mut SshConfigHost,
    identity_file: &mut Option<SshConfigIdentityFile>,
    block: &SshConfigHostBlock,
) {
    if host.host_name.is_none() {
        host.host_name = block.host_name.clone();
    }
    if host.user.is_none() {
        host.user = block.user.clone();
    }
    if host.port.is_none() {
        host.port = block.port;
    }
    if identity_file.is_none() {
        *identity_file = block.identity_file.clone();
    }
}

pub(super) fn split_ssh_config_directive(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(index) = trimmed.find('=') {
        let keyword = trimmed[..index].trim();
        let value = trimmed[index + 1..].trim();
        if !keyword.is_empty() && !keyword.chars().any(char::is_whitespace) && !value.is_empty() {
            return Some((keyword.to_string(), value.to_string()));
        }
    }

    let index = trimmed.find(char::is_whitespace)?;
    let keyword = trimmed[..index].trim();
    let value = trimmed[index..].trim();
    (!keyword.is_empty() && !value.is_empty()).then_some((keyword.to_string(), value.to_string()))
}

pub(super) fn strip_ssh_config_comment(line: &str) -> String {
    let mut quote = None;
    let mut escaped = false;
    let mut output = String::new();

    for ch in line.chars() {
        if escaped {
            output.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            output.push(ch);
            escaped = true;
            continue;
        }
        if matches!(ch, '"' | '\'') {
            if quote == Some(ch) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(ch);
            }
            output.push(ch);
            continue;
        }
        if ch == '#' && quote.is_none() {
            break;
        }
        output.push(ch);
    }

    output
}

pub(super) fn first_ssh_config_value(value: &str) -> String {
    split_ssh_config_words(value)
        .into_iter()
        .next()
        .unwrap_or_default()
}

pub(super) fn split_ssh_config_words(value: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;

    for ch in value.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            current.push(ch);
            escaped = true;
            continue;
        }
        if matches!(ch, '"' | '\'') {
            if quote == Some(ch) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(ch);
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch.is_whitespace() && quote.is_none() {
            if !current.is_empty() {
                words.push(current);
                current = String::new();
            }
            continue;
        }
        current.push(ch);
    }

    if escaped {
        current.push('\\');
    }
    if !current.is_empty() {
        words.push(current);
    }

    words
}

pub(super) fn clean_ssh_config_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

pub(super) fn expand_identity_file(home: &Path, value: &str) -> Option<SshConfigIdentityFile> {
    let value = clean_ssh_config_value(value);
    if value.is_empty() {
        return None;
    }
    if value.eq_ignore_ascii_case("none") {
        return Some(SshConfigIdentityFile::Disabled);
    }
    if value.contains('%') {
        return Some(SshConfigIdentityFile::File(value));
    }
    if value == "~" {
        return Some(SshConfigIdentityFile::File(home.display().to_string()));
    }
    if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return Some(SshConfigIdentityFile::File(
            home.join(rest).display().to_string(),
        ));
    }

    Some(SshConfigIdentityFile::File(value))
}

pub(super) fn ssh_config_block_matches(patterns: &[String], alias: &str) -> bool {
    let mut positive = false;
    for pattern in patterns {
        if let Some(negative) = pattern.strip_prefix('!') {
            if ssh_config_pattern_matches(negative, alias) {
                return false;
            }
            continue;
        }
        if ssh_config_pattern_matches(pattern, alias) {
            positive = true;
        }
    }
    positive
}

pub(super) fn ssh_config_pattern_matches(pattern: &str, value: &str) -> bool {
    fn matches_inner(pattern: &[u8], value: &[u8]) -> bool {
        if pattern.is_empty() {
            return value.is_empty();
        }

        match pattern[0] {
            b'*' => {
                matches_inner(&pattern[1..], value)
                    || (!value.is_empty() && matches_inner(pattern, &value[1..]))
            }
            b'?' => !value.is_empty() && matches_inner(&pattern[1..], &value[1..]),
            ch => {
                !value.is_empty()
                    && ch.eq_ignore_ascii_case(&value[0])
                    && matches_inner(&pattern[1..], &value[1..])
            }
        }
    }

    matches_inner(pattern.as_bytes(), value.as_bytes())
}
