<div align="center">

# SSHNet Share

**用受管理的 SSH 反向隧道，把本机代理端点带到远端 SSH 服务器的 Windows 桌面客户端。**

[![License: PolyForm NC 1.0.0](https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6.svg)](#平台支持)
[![Release: v0.1.1](https://img.shields.io/badge/release-v0.1.1-brightgreen.svg)](https://github.com/superheroYu/sshnet-share/releases/latest)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131.svg)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![Rust 2021](https://img.shields.io/badge/Rust-2021-DEA584.svg)](https://www.rust-lang.org)

[English](README.md) · **简体中文**

</div>

---

SSHNet Share 是一个 Windows 桌面客户端，用受管理的 SSH 反向隧道把一个或多个本机代理端点带到远端服务器环境，让服务器上的命令行、开发工具和服务进程可以按需使用不同的本机网络出口，而不需要在服务器上部署代理服务。

<table>
  <tr>
    <td width="170"><b>当前发布版本</b></td>
    <td><code>v0.1.1</code></td>
  </tr>
  <tr>
    <td><b>仓库地址</b></td>
    <td><a href="https://github.com/superheroYu/sshnet-share">github.com/superheroYu/sshnet-share</a></td>
  </tr>
  <tr>
    <td><b>许可证</b></td>
    <td>采用 <a href="LICENSE">PolyForm Noncommercial License 1.0.0</a> 以 source-available 方式公开源码，允许非商业使用；商业使用需要获得 superheroYu 的单独授权 &mdash; 请通过 <a href="https://github.com/superheroYu/sshnet-share/issues">issue</a> 联系。</td>
  </tr>
</table>

---

## 界面截图

### 配置列表

![配置列表页面，展示多个 SSH 反向隧道配置](assets/screenshots/profiles_zh.png)

### 运行视图

| 活动连接 | 日志 |
|:---:|:---:|
| ![活动连接页面，展示运行中的隧道](assets/screenshots/connections_zh.png) | ![日志页面，展示筛选和导出控件](assets/screenshots/logs_zh.png) |

## 平台支持

SSHNet Share `v0.1.1` **仅支持 Windows**。当前的安装包、更新器流程、凭据存储和 OpenSSH 行为检查都面向 Windows 桌面环境。

## 技术栈

| 层 | 组件 |
|:---|:---|
| **桌面外壳** | Tauri 2 &mdash; Rust 后端 + WebView 前端 |
| **前端** | React 19 · TypeScript · Vite · lucide-react |
| **后端** | Rust 2021 · serde / serde_json · zeroize · windows-sys · zip |
| **Windows 集成** | OpenSSH Client · Credential Manager · 系统托盘 · 开机自启动 · 通知 · 文件对话框 · 单实例 · 更新器 |
| **打包发布** | Tauri NSIS 安装包 · 签名 updater 产物 · GitHub Releases |
| **验证方式** | Rust 单元测试 · Playwright E2E · TypeScript build · clippy |

## 架构概览

- **React UI** 负责桌面体验：配置管理、活动连接、日志、设置、通知、诊断和面向发布的文案。
- **Rust 后端** 负责系统相关能力：配置校验与存储、凭据引用、OpenSSH 参数构造、Host Key 信任、隧道生命周期、进程清理、日志、诊断和更新检查。
- **每个配置** 负责一个本机代理端点和一个远端 loopback 端口。运行多个配置即可实现多端口、多代理端点的路由，覆盖不同本地代理、远端端口或 SSH 服务器。
- **每条隧道** 由受管理的 Windows OpenSSH 子进程承载，使用显式 argv、应用专属 `known_hosts`、隐藏控制台窗口，以及等价于 `ssh.exe -N -T -R <remote>:<local>` 的反向转发。
- **前后端** 通过 Tauri commands 和 events 通信。状态变化和日志会推送到 UI，让长期运行的隧道无需打开 shell 也能被观察。
- **用户数据** 默认保留在本地。配置、日志、known hosts、启动偏好和诊断 ZIP 存放在应用数据 / 日志目录下；诊断数据需要用户手动导出，并在分享前进行脱敏。

## 技术架构图

### 整体组件关系

```mermaid
flowchart LR
  classDef user fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f
  classDef ui fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a8a
  classDef backend fill:#fed7aa,stroke:#ea580c,stroke-width:2px,color:#7c2d12
  classDef storage fill:#f3f4f6,stroke:#6b7280,stroke-width:1px,color:#374151
  classDef tunnel fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#4c1d95
  classDef remote fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d

  User(["用户"]):::user

  subgraph LocalHost["本地 Windows 主机"]
    UI["React UI"]:::ui
    Backend["Rust 后端"]:::backend
    SSH["ssh.exe<br/>(Windows OpenSSH)"]:::tunnel
    LocalProxies(["本地代理端点<br/>127.0.0.1:本地端口"]):::tunnel
    Profiles[("配置 JSON")]:::storage
    Secrets[("Credential Manager")]:::storage
    KnownHosts[("known_hosts")]:::storage
    LogFiles[("日志文件")]:::storage
    Updater(["Tauri updater"]):::storage
  end

  subgraph RemoteHost["远端 SSH 主机"]
    Server["SSH 服务器"]:::remote
    RemoteApps(["远端 shell / 工具 / 服务"]):::remote
  end

  User --> UI
  UI -->|"Tauri commands"| Backend
  Backend -->|"events / logs"| UI
  Backend --> Profiles
  Backend --> Secrets
  Backend --> KnownHosts
  Backend --> LogFiles
  Backend --> Updater
  Backend ==>|"启动并监控"| SSH
  SSH ==>|"SSH 会话"| Server
  RemoteApps -->|"127.0.0.1:远端端口"| Server
  Server -.->|"反向通道"| SSH
  SSH -->|"127.0.0.1:本地端口"| LocalProxies

  style LocalHost fill:#f8fafc,stroke:#94a3b8,stroke-dasharray:5 5,color:#475569
  style RemoteHost fill:#f8fafc,stroke:#94a3b8,stroke-dasharray:5 5,color:#475569
```

### 隧道启动和运行流程

```mermaid
sequenceDiagram
  autonumber
  participant UI as React UI
  participant Backend as Rust 后端
  participant SSH as ssh.exe
  participant Server as SSH 服务器
  participant Remote as 远端应用
  participant Proxy as 本地代理

  Note over UI,SSH: 启动
  UI->>Backend: 启动指定配置的隧道
  Backend->>Backend: 校验配置、路径、Host Key 和端口
  Backend->>SSH: 使用显式 argv 启动隐藏 ssh.exe
  SSH->>Server: 建立 SSH 会话和反向转发
  Backend-->>UI: 推送 connecting / running 状态事件

  Note over Remote,Proxy: 反向流量
  Remote->>Server: 连接服务器 loopback 远端端口
  Server->>SSH: 通过 SSH channel 转发流量
  SSH->>Proxy: 连接本地代理端口

  Note over SSH,UI: 监控与生命周期
  SSH-->>Backend: stdout、stderr 和退出状态
  Backend-->>UI: 推送日志、失败、重连和停止状态
```

## 功能

**隧道管理**
- 多配置、多端口 SSH 反向隧道管理。
- 可为不同本地代理、远端端口、SSH 用户或 SSH 服务器建立独立配置。
- 自动重连，并支持手动停止后取消重连。
- 活动连接页面，展示每条隧道的运行详情。

**认证与主机信任**
- 支持密钥、Windows OpenSSH `ssh-agent` 和密码认证。
- 可选将 SSH 密码保存到 Windows Credential Manager。
- 使用应用专属 `known_hosts` 进行 Host Key 扫描、信任和变更确认。

**可观测性**
- 完整日志页面，支持配置筛选、等级筛选、日期范围、预览、脱敏导出和日志存储大小查看。
- 配置页和连接页内置轻量运行日志条。
- 通知中心保留事件历史。
- 本地诊断 ZIP 导出，便于手动提交问题。

**桌面体验**
- 支持浅色 / 深色主题，并可跟随系统颜色模式。
- 支持可选开机自启动，并提供适合托盘常驻的开机静默启动模式。

**分发**
- Windows NSIS 安装包和 Tauri updater 流程。

## 安装

首个公开测试版本会通过 GitHub Releases 分发 Windows NSIS 安装包。

> [!WARNING]
> 早期版本不会进行 Windows 代码签名。Windows 可能显示 **Unknown Publisher** 或 **SmartScreen** 提示。请只安装从项目 Release 页面或维护者确认渠道下载的版本。

自动更新已接入 Tauri updater，更新检查地址为：

```text
https://github.com/superheroYu/sshnet-share/releases/latest/download/latest.json
```

## 反馈和诊断

> [!NOTE]
> SSHNet Share 不会自动上传遥测、分析数据、崩溃报告、日志或诊断数据。

提交问题时，可以在帮助面板中导出诊断 ZIP。ZIP 会保存在本地应用日志目录下，需要用户手动提交。它包含环境信息、配置摘要、日志存储信息和隐私安全的诊断日志；**不**包含真实主机名、用户名、配置名、私钥路径、密码、令牌或原始日志正文。

Bug 和反馈请提交到 <https://github.com/superheroYu/sshnet-share/issues>。

> [!IMPORTANT]
> 请不要在公开 issue 中粘贴私钥、密码、原始诊断包，或未脱敏的主机 / 用户信息。

## 开发

**前置要求**

- Node.js 和 npm
- Rust stable MSVC toolchain
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime
- Windows OpenSSH Client

**安装依赖并启动桌面应用**

```powershell
npm install
npm run tauri dev
```

**运行验证**

```powershell
npm run build
npm run test:e2e
& $env:USERPROFILE\.cargo\bin\cargo.exe test --locked
& $env:USERPROFILE\.cargo\bin\cargo.exe clippy --all-targets --locked -- -D warnings
git diff --check
```

**本地构建 Windows 安装包**

请参考 [`docs/package-build.md`](docs/package-build.md)。文档中区分了两种构建方式：带签名 key 的 release-like updater 产物构建，以及通过临时配置关闭 updater artifacts 的本地安装 smoke build。

## 文档

| 文档 | 用途 |
|:---|:---|
| [`README.md`](README.md) | 英文 README |
| [`LICENSE`](LICENSE) | PolyForm Noncommercial License 1.0.0 和必要声明 |
| [`CHANGELOG.md`](CHANGELOG.md) | 发布记录 |
| [`SECURITY.md`](SECURITY.md) | 漏洞报告和诊断隐私政策 |
| [`docs/file-navigation.md`](docs/file-navigation.md) | 按功能定位代码入口 |
| [`docs/release.md`](docs/release.md) | 发布和更新器检查清单 |
| [`docs/dev-start.md`](docs/dev-start.md) | 不安装应用，直接从源码启动 |
| [`docs/package-build.md`](docs/package-build.md) | 本地 Windows 安装包构建教程 |
| [`docs/smoke-test.md`](docs/smoke-test.md) | 发布前有限 smoke test |

---

<div align="center">
<sub>以 <a href="LICENSE">PolyForm Noncommercial License 1.0.0</a> 公开源码</sub>
</div>
