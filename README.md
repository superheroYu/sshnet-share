<div align="center">

# SSHNet Share

**A Windows desktop client that brings local proxy endpoints to remote SSH servers via managed reverse tunnels.**

[![License: PolyForm NC 1.0.0](https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6.svg)](#platform-support)
[![Release: v0.1.1](https://img.shields.io/badge/release-v0.1.1-brightgreen.svg)](https://github.com/superheroYu/sshnet-share/releases/latest)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131.svg)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![Rust 2021](https://img.shields.io/badge/Rust-2021-DEA584.svg)](https://www.rust-lang.org)

**English** · [简体中文](README.zh-CN.md)

</div>

---

SSHNet Share is a Windows desktop client that brings one or more local proxy endpoints to remote SSH server environments through managed reverse tunnels, so server-side shells, developer tools, and services can use selected local network egress paths without deploying proxy services on the server.

<table>
  <tr>
    <td width="170"><b>Latest release</b></td>
    <td><code>v0.1.1</code></td>
  </tr>
  <tr>
    <td><b>Repository</b></td>
    <td><a href="https://github.com/superheroYu/sshnet-share">github.com/superheroYu/sshnet-share</a></td>
  </tr>
  <tr>
    <td><b>License</b></td>
    <td>Source-available under <a href="LICENSE">PolyForm Noncommercial License 1.0.0</a>. Noncommercial use is allowed; commercial use requires separate authorization from superheroYu &mdash; <a href="https://github.com/superheroYu/sshnet-share/issues">open an issue</a> to discuss.</td>
  </tr>
</table>

---

## Screenshots

### Profiles

![Profiles page showing multiple SSH reverse tunnel profiles](assets/screenshots/profiles.png)

### Runtime Views

| Active Connections | Logs |
|:---:|:---:|
| ![Active Connections page showing running tunnels](assets/screenshots/connections.png) | ![Logs page with filters and export controls](assets/screenshots/logs.png) |

## Platform Support

SSHNet Share `v0.1.1` is **Windows-only**. The current packaging, updater workflow, credential storage, and OpenSSH behavior checks target Windows desktop environments.

## Tech Stack

| Layer | Components |
|:---|:---|
| **Desktop shell** | Tauri 2 &mdash; Rust backend with a WebView frontend |
| **Frontend** | React 19 · TypeScript · Vite · lucide-react |
| **Backend** | Rust 2021 · serde / serde_json · zeroize · windows-sys · zip |
| **Windows integration** | OpenSSH Client · Credential Manager · tray · autostart · notifications · file dialogs · single-instance · updater hooks |
| **Packaging** | Tauri NSIS installer · signed updater artifacts · GitHub Releases |
| **Verification** | Rust unit tests · Playwright E2E · TypeScript build · clippy |

## Architecture Overview

- **React UI** owns the desktop experience: profile management, active connections, logs, settings, notifications, diagnostics, and release-facing copy.
- **Rust backend** owns privileged and system-facing work: profile validation and storage, credential references, OpenSSH argument construction, host key trust, tunnel lifecycle, process cleanup, logging, diagnostics, and updater checks.
- **Profiles** each own one local proxy endpoint and one remote loopback port. Running multiple profiles provides multi-port and multi-proxy routing across different local proxies, remote ports, or SSH servers.
- **Tunnels** are managed Windows OpenSSH child processes using explicit argv, app-owned `known_hosts`, hidden console windows, and reverse forwarding equivalent to `ssh.exe -N -T -R <remote>:<local>`.
- **IPC** flows through Tauri commands and events. Status changes and log entries are pushed to the UI so long-running tunnels can be monitored without shell access.
- **User data** stays local by default. Profiles, logs, known hosts, startup preferences, and diagnostic ZIPs are stored under the app data / log directories; diagnostics are exported manually and redacted before sharing.

## Architecture Diagrams

### High-level component map

```mermaid
flowchart LR
  classDef user fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f
  classDef ui fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a8a
  classDef backend fill:#fed7aa,stroke:#ea580c,stroke-width:2px,color:#7c2d12
  classDef storage fill:#f3f4f6,stroke:#6b7280,stroke-width:1px,color:#374151
  classDef tunnel fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#4c1d95
  classDef remote fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d

  User(["User"]):::user

  subgraph LocalHost["Local Windows host"]
    UI["React UI"]:::ui
    Backend["Rust backend"]:::backend
    SSH["ssh.exe<br/>(Windows OpenSSH)"]:::tunnel
    LocalProxies(["Local proxy endpoints<br/>127.0.0.1:local_port"]):::tunnel
    Profiles[("Profiles JSON")]:::storage
    Secrets[("Credential Manager")]:::storage
    KnownHosts[("known_hosts")]:::storage
    LogFiles[("Log files")]:::storage
    Updater(["Tauri updater"]):::storage
  end

  subgraph RemoteHost["Remote SSH host"]
    Server["SSH server"]:::remote
    RemoteApps(["Remote shell / tools / services"]):::remote
  end

  User --> UI
  UI -->|"Tauri commands"| Backend
  Backend -->|"events / logs"| UI
  Backend --> Profiles
  Backend --> Secrets
  Backend --> KnownHosts
  Backend --> LogFiles
  Backend --> Updater
  Backend ==>|"spawn / monitor"| SSH
  SSH ==>|"SSH session"| Server
  RemoteApps -->|"127.0.0.1:remote_port"| Server
  Server -.->|"reverse channel"| SSH
  SSH -->|"127.0.0.1:local_port"| LocalProxies

  style LocalHost fill:#f8fafc,stroke:#94a3b8,stroke-dasharray:5 5,color:#475569
  style RemoteHost fill:#f8fafc,stroke:#94a3b8,stroke-dasharray:5 5,color:#475569
```

### Tunnel startup and runtime flow

```mermaid
sequenceDiagram
  autonumber
  participant UI as React UI
  participant Backend as Rust backend
  participant SSH as ssh.exe
  participant Server as SSH server
  participant Remote as Remote apps
  participant Proxy as Local proxy

  Note over UI,SSH: Startup
  UI->>Backend: Start tunnel for profile
  Backend->>Backend: Validate profile, paths, host key, ports
  Backend->>SSH: Spawn hidden ssh.exe with explicit argv
  SSH->>Server: Open SSH session and reverse forward
  Backend-->>UI: Push connecting / running status events

  Note over Remote,Proxy: Reverse traffic
  Remote->>Server: Connect to remote loopback port
  Server->>SSH: Forward traffic through SSH channel
  SSH->>Proxy: Connect to local proxy port

  Note over SSH,UI: Monitoring and lifecycle
  SSH-->>Backend: stdout, stderr, and exit status
  Backend-->>UI: Push logs, failures, reconnects, stopped status
```

## Features

**Tunnel management**
- Multi-profile, multi-port SSH reverse tunnel management.
- Separate profiles for different local proxies, remote ports, SSH users, or SSH servers.
- Auto reconnect with manual stop cancellation.
- Active Connections view with per-tunnel details.

**Authentication and host trust**
- Key, Windows OpenSSH `ssh-agent`, and password authentication.
- Optional SSH password storage in Windows Credential Manager.
- Host Key scan, trust, and replacement confirmation using an app-owned `known_hosts`.

**Observability**
- Productized Logs page with profile filter, level filter, date range, preview, redacted export, and log storage size.
- Lightweight runtime log dock on profile and connection pages.
- Notification center event history.
- Local diagnostic ZIP export for manual issue reports.

**Desktop experience**
- Light and dark themes with system color mode support.
- Optional start on boot, with a silent startup mode for tray-first workflows.

**Distribution**
- Windows NSIS installer and Tauri updater wiring.

## Installation

The first public test build will be distributed through GitHub Releases as a Windows NSIS installer.

> [!WARNING]
> Early builds are not Windows code-signed. Windows may show **Unknown Publisher** or **SmartScreen** prompts. Only install builds downloaded from the project release page or another maintainer-confirmed channel.

Automatic update support is wired through Tauri updater and checks:

```text
https://github.com/superheroYu/sshnet-share/releases/latest/download/latest.json
```

## Feedback And Diagnostics

> [!NOTE]
> SSHNet Share does not automatically upload telemetry, analytics, crash reports, logs, or diagnostic data.

When reporting an issue, use the Help panel to export a diagnostic ZIP. The ZIP is saved locally under the app log directory and must be submitted manually by the user. It contains environment metadata, profile summaries, log storage information, and privacy-safe diagnostic logs. It does **not** include real host names, user names, profile names, private key paths, passwords, tokens, or raw log message bodies.

Report bugs and feedback at <https://github.com/superheroYu/sshnet-share/issues>.

> [!IMPORTANT]
> Do not paste private keys, passwords, raw diagnostic bundles, or unredacted host / user information into public issues.

## Development

**Prerequisites**

- Node.js and npm
- Rust stable MSVC toolchain
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime
- Windows OpenSSH Client

**Install dependencies and run the desktop app**

```powershell
npm install
npm run tauri dev
```

**Run verification**

```powershell
npm run build
npm run test:e2e
& $env:USERPROFILE\.cargo\bin\cargo.exe test --locked
& $env:USERPROFILE\.cargo\bin\cargo.exe clippy --all-targets --locked -- -D warnings
git diff --check
```

**Build a Windows package locally**

See [`docs/package-build.md`](docs/package-build.md) for the two supported build modes: release-like updater artifacts with a signing key, or an install-only local smoke build with updater artifacts disabled by a temporary config override.

## Documentation

| Document | Purpose |
|:---|:---|
| [`README.zh-CN.md`](README.zh-CN.md) | Simplified Chinese README |
| [`LICENSE`](LICENSE) | PolyForm Noncommercial License 1.0.0 and required notices |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting and diagnostic privacy policy |
| [`docs/file-navigation.md`](docs/file-navigation.md) | Where to start for each feature area |
| [`docs/release.md`](docs/release.md) | Release and updater checklist |
| [`docs/dev-start.md`](docs/dev-start.md) | Run the app from source without installing |
| [`docs/package-build.md`](docs/package-build.md) | Local Windows installer build tutorial |
| [`docs/smoke-test.md`](docs/smoke-test.md) | Finite pre-release smoke test |

---

<div align="center">
<sub>Source-available under <a href="LICENSE">PolyForm Noncommercial License 1.0.0</a></sub>
</div>
