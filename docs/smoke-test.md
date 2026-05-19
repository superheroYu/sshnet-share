# SSHNet Share Pre-Release Smoke Test

Date: 2026-05-20

This is the finite pre-release smoke test for `0.1.0`.

It intentionally does not try to cover every Windows/OpenSSH/server combination or long-duration reconnect scenario. Those are post-release feedback items.

## Automated Checks

Run from the repository root:

```powershell
npm run build
npm run test:e2e
& $env:USERPROFILE\.cargo\bin\cargo.exe test --locked
& $env:USERPROFILE\.cargo\bin\cargo.exe clippy --all-targets --locked -- -D warnings
git diff --check
```

Expected result: all checks pass. Do not pin this document to exact test counts; the suite changes as coverage grows.

## Packaging Check

With updater signing key available:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\sshnet-share-updater.key" -Raw
npm run tauri build -- --ci --runner "$env:USERPROFILE\.cargo\bin\cargo.exe"
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY
```

Verify that an NSIS installer is created under:

```text
src-tauri/target/release/bundle/nsis/
```

Expected artifact pattern:

```text
SSHNet Share_0.1.0_x64-setup.exe
```

## Manual App Smoke

Use the current development machine and one reachable SSH server.

1. Launch the app.
2. Confirm the Profiles page renders and the runtime log dock is lightweight.
3. Create or edit a profile.
4. Scan Host Key.
5. Trust Host Key.
6. Start tunnel with key auth if available.
7. Confirm status becomes running.
8. Confirm Active Connections shows the running tunnel and details panel opens on row click.
9. Copy SSH command and server command from the details panel.
10. Stop the tunnel from the details panel.
11. Confirm status becomes stopped.

## Multi-Profile And Multi-Port Smoke

Use test profiles only.

1. Create two profiles that use distinct remote ports.
2. Point them at either different local proxy ports or the same local proxy port, depending on the test setup.
3. Start both profiles.
4. Confirm both appear in Active Connections.
5. Confirm each row shows the expected local port, remote port, server, and mode.
6. Stop one profile and confirm the other remains running.
7. Stop the remaining profile and confirm there are no unexpected `ssh.exe` child processes left.

## Desktop Experience Smoke

1. Open Settings.
2. Switch between light, dark, and system color modes.
3. Confirm Profiles, Active Connections, Logs, Settings, dialogs, and the runtime log dock remain readable.
4. Enable start on boot.
5. Confirm the silent start on boot option becomes available.
6. Toggle silent start on boot and confirm the setting round-trips after app restart.
7. Disable start on boot and confirm silent start on boot is disabled in the UI.

## Password Auth Smoke

Only run if a password-auth test server is available.

1. Set auth method to password.
2. Start the profile.
3. Cancel the password dialog and confirm startup is cancelled.
4. Start again and enter a valid password.
5. Confirm the app waits for remote forwarding success before showing running.
6. If Remember password is enabled, confirm the second start can reuse the saved password.
7. Clear saved password and confirm the ordinary confirmation dialog appears.

## Logs Smoke

1. Open the dedicated Logs page.
2. Confirm profile filter, level filter, and date range controls are visible.
3. Use Preview Export.
4. Export logs.
5. Reveal the export folder.
6. Confirm log directory size is shown.
7. Return to Profiles and confirm the runtime log dock still shows full unfiltered log lines.
8. Clear logs and confirm the dialog says disk history/export files are not deleted.

## Notifications Smoke

1. Start or stop a tunnel from tray.
2. Open the notification bell.
3. Confirm the tray result appears in the app event stream.
4. Trigger a log export or diagnostic export.
5. Confirm the event stream includes the result.

## Diagnostic Bundle Smoke

1. Open Help.
2. Export diagnostic bundle.
3. Confirm the app says the bundle is local and not automatically uploaded.
4. Reveal the ZIP in file manager.
5. Inspect the ZIP filenames:
   - `manifest.json`
   - `environment.json`
   - `profiles-summary.json`
   - `log-storage.json`
   - `logs/redacted.log`
   - `README.txt`
6. Confirm it does not contain real host, user, profile name, private key path, password, token, or raw log message body.

## Update Smoke

The updater endpoint is `https://github.com/superheroYu/sshnet-share/releases/latest/download/latest.json`.

1. Confirm Settings has Check for Updates.
2. Confirm automatic startup check does not download or install anything.
3. Confirm download/install requires the user to press the install button.
4. If testing with a real release endpoint, confirm update events appear in the notification stream.

## Out Of Scope For Pre-Release

These are post-release feedback items:

- Multiple Windows versions.
- Different Windows OpenSSH versions.
- `ssh-keyscan` variations.
- askpass variations.
- OpenSSH ssh-agent variations.
- Different server SSH configurations.
- Network disconnect/recovery over long periods.
- Sleep/wake over long periods.
- Server reboot.
- Remote port occupied after reconnect.
- Multi-hour or multi-day reconnect stability.
