# Changelog

## 0.1.2 - 2026-06-20

- Added a floating status overlay: a frameless, always-on-top translucent window that shows each connection's live status, ports, and uptime. Toggle it from the title bar button, the Settings page, or the tray menu.

## 0.1.1 - 2026-05-20

- Fixed the system tray right-click menu so it follows the selected interface language.

## 0.1.0 - 2026-05-19

- First public Windows test release candidate for SSHNet Share.
- Added multi-profile SSH reverse tunnel management with key, OpenSSH ssh-agent, and password authentication.
- Added app-managed `known_hosts` scan/trust/replace flow, auto reconnect, tray actions, logs, notification history, diagnostic ZIP export, NSIS packaging, and Tauri updater wiring.
- Hardened SSH argument handling to reject option-like host/user/key path values and avoid `user@host` argv ambiguity.
- Added source-available noncommercial licensing under PolyForm Noncommercial 1.0.0.

