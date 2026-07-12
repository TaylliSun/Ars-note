# Ars-note v1.5.64 build guide

## Requirements

- Windows 10/11 x64
- Node.js 22.12 or newer
- npm 10 or newer
- PowerShell 5.1 or newer

Docker is needed only when validating the self-hosted Compose deployment.

## Install dependencies

```powershell
cd C:\path\to\ars-note
npm ci
```

## Development

```powershell
npm run electron:dev
```

`npm run dev` starts only the renderer at `http://127.0.0.1:5173`. It does not provide Electron file-system APIs.

## Verification

```powershell
npm run typecheck
npm test
npm --prefix server test
```

## Build commands

| Command | Result |
| --- | --- |
| `npm run build` | Desktop renderer and Electron main-process output |
| `npm --prefix server run build` | Compiled sync server in `server/dist` |
| `npm run pack` | Unpacked Windows application |
| `npm run dist` | Windows NSIS installer |
| `npm run release:full` | Versioned desktop, NAS, documentation, manifest, and checksum bundle |

The Windows installer is written to `release/Ars-note-Setup-1.5.64.exe`. A complete release is written to a timestamped `release/ars-note-release-v1.5.64-*` directory.

## Public release requirements

Before labeling a build as stable:

1. Sign the installer and application binaries with a trusted Windows code-signing certificate.
2. Confirm the software license or EULA and publisher identity.
3. Publish `PRIVACY.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, and `CHECKSUMS-SHA256.txt` with the installer.
4. Validate install, upgrade, uninstall, Vault editing, AI credentials, and a 24-hour multi-device NAS sync run.
5. Verify the final installer with `Get-AuthenticodeSignature` and compare its SHA256 with the published checksum.

Unsigned builds must be labeled beta or release candidate because Windows SmartScreen may warn users.
