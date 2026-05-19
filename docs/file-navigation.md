# SSHNet Share File Navigation

Date: 2026-05-20

This guide answers: "If I need to change a feature, which files should I inspect first?"

## Entry Points

| File | Purpose |
| --- | --- |
| `src/main.tsx` | React entry point. |
| `src/App.tsx` | Thin frontend shell that connects `useAppController` and `AppView`. |
| `src/features/app/AppView.tsx` | Main UI composition: titlebar, navigation, workspace, runtime log dock, modals, notification/help/more panels, editor/details panels. |
| `src-tauri/src/main.rs` | Tauri process entry and SSH askpass helper entry. |
| `src-tauri/src/lib.rs` | Rust library entry that exports `run()`. |
| `src-tauri/src/app.rs` | Tauri builder, plugin registration, command registration, tray setup, window lifecycle, shared structs/constants. |

## Frontend State And Hooks

| File | Purpose |
| --- | --- |
| `src/hooks/useAppController.ts` | Main app state, profile actions, tunnel actions, section switching, status polling fallback, `sshnet-status-changed` listener. |
| `src/hooks/useAppLogs.ts` | Runtime logs, Logs page filters, preview/export/clear/open folder, `sshnet-log-entry` listener. |
| `src/hooks/useAppEvents.ts` | Notification center event history and `sshnet-event` listener. |
| `src/hooks/useDiagnosticBundle.ts` | Diagnostic ZIP export and reveal-in-file-manager action. |
| `src/hooks/useAppUpdates.ts` | Startup silent update check, manual update check, user-confirmed download/install/relaunch, update events. |
| `src/hooks/useKnownHostsController.ts` | Host Key scan, trust, replacement confirmation, request race guard. |
| `src/hooks/useSshPasswordPrompt.ts` | SSH password dialog promise lifecycle. |
| `src/types/domain.ts` | Shared TypeScript DTOs. |
| `src/i18n/localeText.ts` | Chinese/English UI text and `LocaleText` type. |

## Frontend Views

| File | Purpose |
| --- | --- |
| `src/features/profiles/ProfilesWorkspace.tsx` | Profiles table, Active Connections table, toolbar, search, filter popover, row actions, empty states, connection topology. |
| `src/features/connections/ConnectionDetailsPanel.tsx` | Active tunnel details panel: duration, PID, stop, copy commands, view logs, edit profile. |
| `src/features/editor/EditorPanel.tsx` | Profile editor: general/advanced tabs, proxy tools, SSH config, Host Key, command previews, private key picker. |
| `src/features/logViewer/LogPage.tsx` | Dedicated Logs page with productized log view. |
| `src/features/logViewer/LogControls.tsx` | Logs page controls: profile/source filter, level filter, date range, preview, export, open folder, clear. |
| `src/features/settings/SettingsPage.tsx` | Language, theme, startup behavior, default profile settings, update controls. |

## Frontend Utilities

| File | Purpose |
| --- | --- |
| `src/lib/appSettings.ts` | Settings defaults, localStorage normalization, color mode, default profile constraints. |
| `src/lib/appInfo.ts` | App version, author, repository URL for help/about UI. |
| `src/lib/profile.ts` | Profile factory, fallback profile, validation, initial environment checks. |
| `src/lib/display.ts` | Backend detail translation, error display, profile names, Host Key fingerprint formatting. |
| `src/lib/sshPreview.ts` | SSH command preview and remote server command generation. |

## Styles

| File | Purpose |
| --- | --- |
| `src/App.css` | CSS import entry. |
| `src/styles/base.css` | Design tokens, base elements, fonts, focus styles. |
| `src/styles/layout.css` | App shell, titlebar, main panel, statusbar, quick panels, connection topology. |
| `src/styles/controls.css` | Buttons, inputs, selects, switches, shared control states. |
| `src/styles/profiles.css` | Profile/connection tables, row states, checkboxes, row actions, empty states. |
| `src/styles/connections.css` | Connection details panel and Active Connections-specific layout. |
| `src/styles/editor.css` | Editor panel, forms, Host Key UI, proxy tools, command preview. |
| `src/styles/logs.css` | Runtime log dock, dedicated Logs page, log controls, preview panel, log line styling. |
| `src/styles/settings.css` | Settings page cards and update controls. |
| `src/styles/modal.css` | Password, confirmation, and discard-change dialogs. |
| `src/styles/theme-light.css` | Light theme overrides. Must remain imported last. |

## Backend Modules

| File | Purpose |
| --- | --- |
| `src-tauri/src/app.rs` | App assembly, Tauri plugins, commands, shared DTOs, event names. |
| `src-tauri/src/commands.rs` | Thin command exports. |
| `src-tauri/src/profiles.rs` | Profile load/save, legacy migration, validation, normalization, stored password cleanup. |
| `src-tauri/src/tunnel.rs` | Tunnel lifecycle: start, stop, stop all, status query, status event emit, SSH args. |
| `src-tauri/src/tunnel_output.rs` | SSH stdout/stderr reading, startup success signals, failure classification, verbose-noise filtering. |
| `src-tauri/src/tunnel_reconnect.rs` | Auto reconnect, generation cancellation, reconnect worker, monitor thread. |
| `src-tauri/src/ssh_auth.rs` | SSH auth options, askpass broker, password handoff. |
| `src-tauri/src/credentials.rs` | Windows Credential Manager save/read/delete for SSH passwords. |
| `src-tauri/src/known_hosts.rs` | Host Key scan/trust/write/replace with CAS checks. |
| `src-tauri/src/known_hosts_helpers.rs` | Host Key marker, fingerprint, key-set helper logic. |
| `src-tauri/src/proxy.rs` | Local proxy probing/discovery, HTTP CONNECT/SOCKS5 checks, candidate ports. |
| `src-tauri/src/logs.rs` | In-memory logs, disk persistence, rotation, filtering, redaction, export, preview, log storage size, log-entry events. |
| `src-tauri/src/log_commands.rs` | Log Tauri commands: get, append, clear, export, preview, storage info. |
| `src-tauri/src/app_events.rs` | App event ring buffer, `get_app_events`, `record_app_event`, `sshnet-event`. |
| `src-tauri/src/diagnostics.rs` | Local diagnostic ZIP export and privacy-safe bundle content. |
| `src-tauri/src/environment.rs` | OpenSSH, `ssh-keyscan`, WebView2, profile-store checks. |
| `src-tauri/src/startup.rs` | Startup preferences, `--sshnet-startup` detection, silent start on boot behavior. |
| `src-tauri/src/paths_ssh_config.rs` | App paths and `.ssh/config` parsing with Include expansion. |
| `src-tauri/src/tray.rs` | System tray menu, tray notifications, tray task guard, tray start/stop workers. |
| `src-tauri/src/tests.rs` | Rust unit tests. |

## Release And Configuration

| File | Purpose |
| --- | --- |
| `package.json` | npm scripts, frontend dependencies, app version. |
| `src-tauri/Cargo.toml` | Rust dependencies and package version. |
| `src-tauri/tauri.conf.json` | App identifier, window size, NSIS target, updater pubkey/endpoint/artifacts. |
| `src-tauri/capabilities/default.json` | Tauri plugin permissions. |
| `.github/workflows/release.yml` | Tag-triggered Windows release workflow. |
| `docs/release.md` | GitHub Release, NSIS, updater signing key, Secrets, release steps. |
| `docs/dev-start.md` | Start the app from source without installing; includes dev process troubleshooting. |
| `docs/package-build.md` | Local Windows installer build tutorial and troubleshooting. |
| `docs/smoke-test.md` | Finite pre-release smoke test checklist. |
| `assets/screenshots/` | Public README screenshots, split by English and Simplified Chinese variants. |

## Common Change Paths

| Change | Start with |
| --- | --- |
| Profiles table, batch operations, row action buttons | `ProfilesWorkspace.tsx`, `useAppController.ts`, `profiles.rs`, `tunnel.rs` |
| Active Connections page and details panel | `ProfilesWorkspace.tsx`, `ConnectionDetailsPanel.tsx`, `useAppController.ts`, `profiles.css`, `connections.css` |
| Editor fields or validation | `EditorPanel.tsx`, `profile.ts`, `profiles.rs` |
| SSH start/stop/status/reconnect | `useAppController.ts`, `tunnel.rs`, `tunnel_output.rs`, `tunnel_reconnect.rs` |
| Status events | `tunnel.rs`, `tunnel_reconnect.rs`, `tray.rs`, `useAppController.ts` |
| Password auth and saved password | `useSshPasswordPrompt.ts`, `ssh_auth.rs`, `credentials.rs`, `tunnel_output.rs` |
| Host Key trust flow | `useKnownHostsController.ts`, `known_hosts.rs`, `known_hosts_helpers.rs` |
| Local proxy discovery | `EditorPanel.tsx`, `useAppController.ts`, `proxy.rs` |
| Runtime log dock | `AppView.tsx`, `useAppLogs.ts`, `logs.css` |
| Dedicated Logs page | `useAppLogs.ts`, `LogPage.tsx`, `LogControls.tsx`, `logs.rs`, `log_commands.rs` |
| Notification center | `useAppEvents.ts`, `AppView.tsx`, `app_events.rs`, `tray.rs` |
| Diagnostic ZIP | `useDiagnosticBundle.ts`, `AppView.tsx`, `diagnostics.rs` |
| Updates | `SettingsPage.tsx`, `useAppUpdates.ts`, `src-tauri/tauri.conf.json`, `.github/workflows/release.yml` |
| Tray | `tray.rs`, `app.rs`, `app_events.rs` |
| Settings and startup behavior | `SettingsPage.tsx`, `useAppController.ts`, `appSettings.ts`, `startup.rs` |
| Help/about/more panels | `AppView.tsx`, `appInfo.ts`, `localeText.ts`, `layout.css` |
| Chinese/English copy | `localeText.ts`, `display.ts` |
| Theme styling | Relevant `src/styles/*.css`, with light overrides in `theme-light.css` |

## Verification Commands

```powershell
npm run build
npm run test:e2e
& $env:USERPROFILE\.cargo\bin\cargo.exe test --locked
& $env:USERPROFILE\.cargo\bin\cargo.exe clippy --all-targets --locked -- -D warnings
git diff --check
```
