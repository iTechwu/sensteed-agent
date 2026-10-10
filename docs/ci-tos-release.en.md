# GitHub Actions and TOS publication

[中文](ci-tos-release.md)

GitHub Actions builds installers; `dofe-public` stores the final artifacts. GitHub Artifacts is a one-day transfer store between platform jobs and the publisher. Pull requests neither receive TOS credentials nor upload to TOS.

## Triggers

- Product changes on `dev` or `master`: build and upload candidates without updating a channel.
- Actions → CI → Run workflow: select `publish_kind=candidate` for candidates, or `release` on `dev` or `master` for a release.
- Push a `v<package.json version>` tag: publish a release. The tag must exactly match the root package version.
- Documentation changes skip product builds; manual runs and version tags always run product checks.

Releases support `X.Y.Z` (stable) and `X.Y.Z-beta.N` (beta). macOS requires Developer ID signing, notarization, and the existing installer verification. Windows and Linux retain their current unsigned packaging; the manifest records signing status. Use candidate mode without Apple credentials; releases never silently fall back to unsigned macOS builds.

## GitHub configuration

Repository Settings → Secrets and variables → Actions:

| Name | Type | Value |
| --- | --- | --- |
| `TOS_ACCESS_KEY_ID` | Secret | TOS Access Key |
| `TOS_SECRET_ACCESS_KEY` | Secret | TOS Secret Key |
| `TOS_BUCKET` | Variable or Secret | `dofe-public`, also the default |
| `TOS_REGION` | Variable or Secret | Bucket region |
| `TOS_ENDPOINT` | Variable or Secret | Public TOS endpoint, hostname or HTTPS URL; official S3 and bucket domains are normalized to the native service endpoint in the same region |
| `TOS_PUBLIC_BASE_URL` | Variable or Secret | HTTPS download domain mapped to the bucket root, without temporary signing parameters |

Non-sensitive configuration prefers Variables and also accepts Secrets. GitHub may mask a download domain stored as a Secret, making log or summary links incomplete; move that configuration to Variables for clickable links. Credentials reach only preflight and upload steps. CI uses a pinned official Python TOS SDK with multipart upload and CRC verification. Neither the SDK nor upload credentials are bundled into the App.

Signed macOS releases additionally require six Secrets: `MAC_CERT_P12_BASE64`, `MACOS_SIGN_IDENTITY`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. The P12 must contain a Developer ID Application certificate and private key; the Apple password is an app-specific password.

The upload account needs object write, read/HEAD, and multipart permissions on the target prefix; releases also read and write channel indexes. The workflow does not change bucket ACLs, public access policies, CORS, or CDN configuration. The download domain must already permit public reads of the published prefix.

## Artifacts and publication order

```text
sensteed-agent/candidates/<desktop-sha>/<run-id>-<attempt>/
sensteed-agent/releases/<beta|stable>/<version>/<run-id>-<attempt>/
sensteed-agent/channels/<beta|stable>.json
```

Each directory contains an Apple Silicon arm64 DMG under `macos/`, x64 Setup EXE and Portable ZIP under `windows/`, x64 AppImage and DEB under `linux/`, and `manifest.json`. The TOS publisher accepts only the `-arm64.dmg` Mac suffix and records `arch: arm64` in the manifest. The manifest also records sizes, SHA-256 hashes, download URLs, signing status, desktop and Harness commits, run ID, and attempt number.

The workflow resolves the branch declared by `upstream.json` once. Every platform downloads that SHA and verifies `sourceVersion`. Publication requires the product gate, all three platform packaging gates, and the Windows sibling-workspace gate to succeed.

Order: upload five installers → verify remote sizes and SHA-256 metadata → write the version manifest → update the release channel. Installers use long cache lifetimes; channels use `no-store`. Release versions must increase. Conditional writes prevent concurrent publishers from overwriting a channel. Candidates never write channels. Failed uploads may leave partial objects but cannot announce an incomplete release; retrying failed Actions jobs uses a new attempt directory.

Channel publishers run serially. GitHub concurrency may replace a pending job, so intermediate candidates are not guaranteed to upload; manually rerun a required version. Historical packages remain available; the workflow does not delete TOS objects.

## Downloads and client updates

After publication, find package and manifest information in the Actions run summary. GitHub Secrets cannot be read back locally; local checks can inspect names only. Actions preflight uploads a tiny probe using multipart upload and checks it with HEAD to validate permissions, region, network, and endpoint configuration. The probe remains at `sensteed-agent/diagnostics/<run-id>-<attempt>/probe.txt` without changing release manifests or channels. Error logs retain redacted service error codes, request IDs, and the failed stage.

The TOS channel manifest is a publication output, not a replacement for the existing client version API. This change does not modify the online update service or client download allowlist. App updates require the service to read manifests and serve version-pinned downloads and SHA-256 hashes. Redirecting to TOS/CDN also requires new clients to allow the exact download domain. Existing clients can use a proxy on their original trusted domain, but cannot follow redirects to unapproved domains.

Channels reject equal versions and downgrades. Keep older packages and publish a higher-version repair for a bad release. Emergency online-service switching is a separate release operation.

## Local validation

```sh
node --test scripts/ci/resolve-source.test.mjs
python3 -B -m unittest discover -s scripts/ci -p 'test_*.py'
corepack pnpm check:layout
```

Unit tests use an in-memory TOS double and upload no real files. Platform builds, signing, notarization, and TOS uploads run on the corresponding GitHub runners.
