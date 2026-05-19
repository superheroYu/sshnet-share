# SSHNet Share Release Guide

Date: 2026-05-20

This document describes the planned `0.1.0` GitHub Release flow. Prefer building and testing `v0.1.0-rc.0` first, then publish `v0.1.0` after smoke testing the release-candidate artifacts.

## Release Shape

- Version: `0.1.0`
- Channel: GitHub Release
- License: PolyForm Noncommercial License 1.0.0
- Windows package: NSIS `.exe`
- Updater: Tauri v2 updater with signed updater artifacts
- Code signing: deferred for early test builds
- Release workflow: `.github/workflows/release.yml`, triggered by tags matching `v*`

## Version Files

Keep these in sync before tagging:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src/lib/appInfo.ts`

Current expected value: `0.1.0`.

## Updater Configuration

`src-tauri/tauri.conf.json` currently has:

- `bundle.targets: ["nsis"]`
- `bundle.createUpdaterArtifacts: true`
- updater public key in `plugins.updater.pubkey`
- passive Windows install mode
- release endpoint:
  `https://github.com/superheroYu/sshnet-share/releases/latest/download/latest.json`

The release workflow has a fail-fast guard that blocks publishing if the old placeholder endpoint reappears.

The updater signing public key is committed in `tauri.conf.json`. The private key must not be committed. The private key stored in GitHub Secrets must match the committed public key; if a new keypair is generated, update `plugins.updater.pubkey` at the same time.

Generate a signing key when needed:

```powershell
npm run tauri -- signer generate --write-keys "$env:USERPROFILE\.tauri\sshnet-share-updater.key"
```

Store the private key content in GitHub Secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key was generated with a password

For local updater artifact builds, load the private key into the environment:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\sshnet-share-updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<your key password or empty string>"
npm run tauri build -- --ci --runner "$env:USERPROFILE\.cargo\bin\cargo.exe"
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

## GitHub Actions Release Workflow

Tag `v*` triggers `.github/workflows/release.yml`.

The workflow runs on `windows-latest` and performs:

1. Checkout.
2. Node setup.
3. Rust `1.95.0` setup with clippy.
4. `npm ci`.
5. Release guard for endpoint placeholders and updater signing key secret.
6. Playwright Chromium install.
7. `npm run build`.
8. `cargo test --locked`.
9. `cargo clippy --all-targets --locked -- -D warnings`.
10. `npm run test:e2e`.
11. Tauri NSIS build through `tauri-apps/tauri-action@fce9c6108b31ea247710505d3aaaa893ee6768d4`.
12. Upload installer, updater artifacts, and `latest.json` to a draft GitHub Release.

The generated release is a draft. Inspect artifacts before publishing.

## Unsigned Windows Builds

Early `0.1.0` builds are not Windows code-signed.

Release notes must clearly say:

- Windows may show Unknown Publisher.
- Windows SmartScreen may warn before installation.
- Users should only install builds from the official release page or a maintainer-confirmed channel.

Do not imply that updater signing is the same as Windows code signing. The updater signature protects update artifacts. It does not remove Unknown Publisher prompts from the installer.

## Licensing And Security

- `LICENSE` uses PolyForm Noncommercial License 1.0.0 with required notices.
- Commercial use requires separate authorization from superheroYu through GitHub Issues.
- `SECURITY.md` is the current reporting policy. Do not request secrets, raw diagnostic bundles, or unredacted host/user details in public issues.

## Public Repository History

Before making the repository public, decide whether GitHub should contain the full local development history.

If the public repository should start from a clean source snapshot, publish from an orphan branch or a clean exported directory instead of pushing the private development branch directly. Confirm the public branch history contains only intended commits before switching the GitHub repository from private to public.

## Release Checklist

1. Confirm version is `0.1.0` in all version files.
2. Confirm the updater endpoint points to `superheroYu/sshnet-share`.
3. Confirm GitHub Secrets are configured.
4. Run local regression:

```powershell
npm run build
npm run test:e2e
& $env:USERPROFILE\.cargo\bin\cargo.exe test --locked
& $env:USERPROFILE\.cargo\bin\cargo.exe clippy --all-targets --locked -- -D warnings
git diff --check
```

5. Confirm the release repository placeholder guard returns no matches.
6. Run `docs/smoke-test.md`.
7. Create and push the release-candidate tag:

```powershell
git tag v0.1.0-rc.0
git push origin v0.1.0-rc.0
```

8. Wait for the Release workflow.
9. Inspect draft release assets:
   - NSIS installer `.exe`
   - updater signature files
   - `latest.json`
10. Keep the `v0.1.0-rc.0` GitHub Release as a draft while inspecting artifacts. If external testers need access, publish it as a pre-release and clearly mark it as a release candidate.
11. Install the release-candidate build and run `docs/smoke-test.md`.
12. Confirm the tagged source archive and repository contain `LICENSE`, `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `SECURITY.md`, and `assets/screenshots/`.
13. Confirm release notes include unsigned Windows warning and manual diagnostics/no auto-upload language.
14. If the release candidate is good, create and push the final release tag:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

15. Wait for the final Release workflow.
16. Inspect the final draft release assets.
17. Publish the final draft release.
