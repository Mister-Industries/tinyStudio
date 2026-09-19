# Releasing tinyStudio

Installers for Windows, macOS and Linux are built by GitHub Actions
([.github/workflows/release.yml](../.github/workflows/release.yml)), one runner
per system, and attached to a draft GitHub release.

| System  | File                                                                     | Built on       |
| ------- | ------------------------------------------------------------------------ | -------------- |
| Windows | `tinystudio-<version>-setup.exe` (x64)                                   | windows-latest |
| macOS   | `tinystudio-<version>-arm64.dmg`, `-x64.dmg`                             | macos-latest   |
| Linux   | `tinystudio-<version>-x86_64.AppImage`, `tinystudio_<version>_amd64.deb` | ubuntu-latest  |

Each installer carries only its own system's arduino-cli and language server
([electron-builder.yml](../electron-builder.yml)).

## Before tagging

1. **Everything is pushed that the release depends on.** tinyparts `main` (the
   app replaces its bundled Core pack with GitHub's copy on launch), and the
   tinyService version `package.json` asks for is on npm.
2. **Bundled parts are current:** `npm run parts:sync`, then commit the snapshot.
3. **Version and changelog.** `version` in `package.json` is the release number,
   and `CHANGELOG.md` has a `## <version> (<date>)` section. The release notes
   are built from that section.
4. **Checks pass:** `npm run typecheck`, `npm run lint`, `npm test`.
5. **The release branch is merged into `main`.**

## Dry run

Actions → **Release** → **Run workflow**, on the branch you're releasing. It
builds all installers and keeps them as the run's artifacts, with no release.
Download them from the run's page and try each one.

## Release

```bash
git switch main
git pull
git tag v0.4.0
git push origin v0.4.0
```

The tag has to match `package.json` (`v` + version), or the build stops. When
the three builds finish, a **draft** release appears under Releases with the
installers, `SHA256SUMS.txt` and notes: download instructions, how to get past
the unsigned-app warnings, then the changelog section. Edit it if you like, then
**Publish release**.

To redo a release: delete the draft and the tag (`git push origin :v0.4.0`,
`git tag -d v0.4.0`), fix, and tag again.

## Signing

Nothing is signed with a certificate yet (beta work, GAP-3 in the
[release plan](release-plan.md)):

- **Windows:** SmartScreen says "Windows protected your PC". Users click
  **More info** → **Run anyway**. To sign, add the certificate as `CSC_LINK` and
  `CSC_KEY_PASSWORD` secrets and pass them to the Windows build step
  ([packaging-windows.md](packaging-windows.md#7-code-signing)).
- **macOS:** the app is ad-hoc signed (`identity: '-'`), because Apple Silicon
  won't open an unsigned app at all. Gatekeeper still blocks the first launch;
  users allow it in **System Settings → Privacy & Security → Open Anyway**.
  Proper signing needs an Apple Developer ID certificate, the hardened runtime and
  notarization.
- **Linux:** nothing to sign. The AppImage needs `chmod +x`.

## Building locally

`npm run build:win`, `build:mac` and `build:linux` still work, each on its own
system. The `prebuild` hook fetches arduino-cli for every platform, which fails on
Linux (GNU tar can't unpack the Windows `.zip`); fetch just yours there with
`node scripts/fetch-arduino-cli.mjs linux-x64`, then run `npx electron-vite build`
and `npx electron-builder --linux`. Windows details:
[packaging-windows.md](packaging-windows.md).
