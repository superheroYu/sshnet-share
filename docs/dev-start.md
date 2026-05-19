# Development Start Guide

Date: 2026-05-20

This guide explains how to start SSHNet Share from source without installing the NSIS package.

## When To Use This

Use the development app when you want to:

- Check UI or CSS changes with hot reload.
- Test Tauri commands before building an installer.
- Reproduce a bug without touching the installed application files.

The dev app is not a packaged release. It runs the frontend through Vite and the desktop shell through `cargo run`.

## Prerequisites

- Windows.
- Node.js and npm.
- Rust MSVC toolchain.
- Microsoft C++ Build Tools.
- Microsoft Edge WebView2 Runtime.
- Windows OpenSSH Client.
- Project dependencies installed with `npm ci` or `npm install`.

Make Cargo available in the current PowerShell session:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo --version
```

If Cargo is not on `PATH`, `npm run tauri dev` can fail with:

```text
failed to run 'cargo metadata' command to get workspace directory
```

## Normal Foreground Start

Run from the repository root:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri dev
```

Expected behavior:

- Vite starts at `http://127.0.0.1:1420`.
- Tauri runs `cargo run`.
- A desktop window named `SSHNet Share` opens from `target/debug/sshnet-share.exe`.
- Frontend changes usually hot reload.
- Rust backend changes usually trigger a dev rebuild.

Keep this terminal open while testing. Press `Ctrl+C` to stop the dev app.

## Hidden Background Start

Use this when you want the dev app window without keeping a visible PowerShell window open:

```powershell
$repo = (Get-Location).Path
$log = Join-Path $env:TEMP "sshnet-tauri-dev.log"
$err = Join-Path $env:TEMP "sshnet-tauri-dev.err.log"
Remove-Item -LiteralPath $log,$err -Force -ErrorAction SilentlyContinue

$script = @"
`$env:PATH = "`$env:USERPROFILE\.cargo\bin;`$env:PATH"
Set-Location -LiteralPath "$repo"
npm run tauri dev
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))

Start-Process powershell `
  -WindowStyle Hidden `
  -RedirectStandardOutput $log `
  -RedirectStandardError $err `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded)
```

Read logs:

```powershell
Get-Content "$env:TEMP\sshnet-tauri-dev.log" -Tail 80
Get-Content "$env:TEMP\sshnet-tauri-dev.err.log" -Tail 120
```

## Confirm It Is Running

```powershell
Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess

Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -match "tauri dev|vite --host 127.0.0.1|target\\debug\\sshnet-share.exe"
  } |
  Select-Object ProcessId,Name,CommandLine
```

Expected process set:

- `node.exe` for Tauri CLI.
- `node.exe` for Vite.
- `sshnet-share.exe` from `target/debug`.
- `msedgewebview2.exe` child processes.

## Stop The Dev App

Preferred path:

1. Close the SSHNet Share dev window.
2. Press `Ctrl+C` in the terminal running `npm run tauri dev`.

If you started it hidden, stop only the processes that clearly belong to this repository:

```powershell
$repo = (Get-Location).Path

Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine.Contains($repo) -and
    $_.CommandLine -match "tauri dev|vite --host 127.0.0.1|target\\debug\\sshnet-share.exe"
  } |
  Select-Object ProcessId,Name,CommandLine
```

Then stop the matching process IDs:

```powershell
Stop-Process -Id <process id> -Force
```

Avoid broad commands such as killing every `node.exe`; other tools may be using Node.

## Dev App Data

The dev app uses the same Tauri identifier as the packaged app:

```text
com.sshnet.share
```

That means dev and installed builds may read the same app config directory, profiles, known hosts, logs, and saved Windows Credential Manager entries.

For safe testing:

- Use test profiles first.
- Avoid saving production SSH passwords while testing.
- Do not run the installed app and dev app at the same time.
- Export or back up important profiles before destructive tests.

## Troubleshooting

### Port 1420 Is Already In Use

Find the process:

```powershell
Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

If it is an old SSHNet dev process, stop it and run `npm run tauri dev` again.

### Tauri Window Does Not Open

Check the dev logs first:

```powershell
Get-Content "$env:TEMP\sshnet-tauri-dev.err.log" -Tail 120
```

Common causes:

- Cargo is not on `PATH`.
- Rust is still compiling; wait for `Finished dev profile`.
- WebView2 runtime is missing.
- Another dev instance is still running.

### Frontend Only

For pure UI inspection in a browser, you can run:

```powershell
npm run dev -- --host 127.0.0.1 --port 1420
```

This does not start Tauri and most backend commands will not work. Use `npm run tauri dev` for real desktop behavior.

## Verification After Starting

Quick checks:

- Open Profiles, Connections, Logs, and Settings.
- Confirm no console window appears when environment checks run.
- Confirm Host Key scan and tunnel start use the current Rust backend.
- Confirm CSS changes hot reload in the dev window.

For regression checks:

```powershell
npm run build
npm run test:e2e
& $env:USERPROFILE\.cargo\bin\cargo.exe test --locked
& $env:USERPROFILE\.cargo\bin\cargo.exe clippy --all-targets --locked -- -D warnings
git diff --check
```
