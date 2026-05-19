# Local Package Build Guide

Date: 2026-05-20

This guide explains how to build the Windows NSIS installer for SSHNet Share locally.

## Output Files

The local build writes installer artifacts under:

```text
src-tauri/target/release/bundle/nsis/
```

Release-like builds with updater signing enabled should produce:

- `SSHNet Share_0.1.0_x64-setup.exe` - Windows NSIS installer.
- `SSHNet Share_0.1.0_x64-setup.exe.sig` - Tauri updater signature for the installer.

Install-only local smoke builds may produce only the `.exe`. The `.sig` is required for updater/release validation.

## Prerequisites

- Windows.
- Node.js and npm.
- Rust MSVC toolchain.
- Microsoft C++ Build Tools.
- Microsoft Edge WebView2 Runtime.
- Windows OpenSSH Client.
- Project dependencies installed with `npm ci` or `npm install`.

Before building, make sure Cargo is available in the current PowerShell session:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo --version
```

If this is missing, `tauri build` can fail with:

```text
failed to run 'cargo metadata' ... program not found
```

## Updater Signing Key

The private updater signing key must stay outside the repository. The expected local path is:

```text
%USERPROFILE%\.tauri\sshnet-share-updater.key
```

The matching public key is committed in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

To create a keypair for a new environment:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri -- signer generate --write-keys "$env:USERPROFILE\.tauri\sshnet-share-updater.key"
```

If you generate a new keypair, update `src-tauri/tauri.conf.json` with the new public key before publishing releases. Do not commit the private `.key` file.

## Build With Existing Key

Use this when the local private key already exists and you want release-like updater artifacts:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\sshnet-share-updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<your key password>"
npm run tauri build -- --ci --runner "$env:USERPROFILE\.cargo\bin\cargo.exe"
```

If the private key has no password, set the password variable to an empty string:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
```

The environment variables are only set for the current PowerShell session.

## Local Smoke Test Build

For a quick local install test without validating updater artifacts, use a temporary Tauri config override that disables updater artifact generation. Do not commit this temporary file.

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$localConfig = Join-Path $env:TEMP "sshnet-tauri-local-build.json"
@'
{
  "bundle": {
    "createUpdaterArtifacts": false
  }
}
'@ | Set-Content -LiteralPath $localConfig -Encoding UTF8

npm run tauri build -- --config $localConfig --runner "$env:USERPROFILE\.cargo\bin\cargo.exe"
Remove-Item -LiteralPath $localConfig -Force
```

Then install:

```powershell
& "src-tauri\target\release\bundle\nsis\SSHNet Share_0.1.0_x64-setup.exe"
```

Smoke test at least:

- App launches from the installer build.
- No `ssh.exe`, `ssh-keyscan.exe`, or `reg.exe` console window appears while configuring or starting tunnels.
- Host Key scan/trust works.
- Key auth, Windows OpenSSH `ssh-agent`, or password auth works with a test profile.
- Start and stop leave no unexpected tunnel process behind.
- Uninstall is available from Windows Settings.

## Troubleshooting

### Build Hangs After Installer Appears

If `SSHNet Share_0.1.0_x64-setup.exe` appears but `.sig` does not during a release-like build, the build is usually waiting for the updater signing password.

Set:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<your key password>"
```

Then rerun `npm run tauri build`.

If you only need a local install smoke test, use the temporary config override in the Local Smoke Test Build section instead.

### Stop A Stuck Local Build

If a previous build is stuck, inspect recent Node/Tauri processes:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CreationDate -gt (Get-Date).AddHours(-1) } |
  Select-Object ProcessId,CreationDate,CommandLine
```

Stop only the build processes that clearly point to this repository or `tauri build`:

```powershell
Stop-Process -Id <process id> -Force
```

### Rebuild From A Clean Artifact Directory

Remove old local artifacts before rebuilding:

```powershell
Remove-Item -LiteralPath "src-tauri\target\release\bundle\nsis\SSHNet Share_0.1.0_x64-setup.exe" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "src-tauri\target\release\bundle\nsis\SSHNet Share_0.1.0_x64-setup.exe.sig" -Force -ErrorAction SilentlyContinue
```

Then rerun the build command.

## Release Build Checklist

Before using a local package as a release candidate:

```powershell
npm run build
npm run test:e2e
& $env:USERPROFILE\.cargo\bin\cargo.exe test --locked
& $env:USERPROFILE\.cargo\bin\cargo.exe clippy --all-targets --locked -- -D warnings
git diff --check
```

Also confirm:

- The old repository placeholder string is absent from the worktree.
- `src-tauri/tauri.conf.json` points to `https://github.com/superheroYu/sshnet-share/releases/latest/download/latest.json`.
- For release-like builds, both `.exe` and `.exe.sig` are freshly generated.
- For install-only smoke builds, the `.exe` is freshly generated and updater validation is intentionally skipped.
- Release notes mention the installer is not Windows code-signed.
