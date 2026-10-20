# GitHub Actions and TOS publication

[中文](ci-tos-release.md)

GitHub Actions uploads installers and provenance. Models is the sole desktop update channel
authority. Administrators enter exact versions, channels and permanent installer URLs at
`https://ai.hozonauto.com/platform/desktop-releases`, validate them, then explicitly publish.
No second installer upload is required.

## Triggers and versions

Ordinary dev/main pushes run checks. An exact version tag builds candidates. Merge dev into
main, commit the version, tag that commit with the exact version without a v prefix, then push.
A workflow_dispatch on the same tagged main selects candidate or release. Current versions
append `-beta.YYYYMMDDHHmm` to the exact Harness sourceVersion, including prereleases such as
`0.2.1-rc.2-beta.202610202356`. Release selects code signing; it does not select stable.

The publisher reruns release-contract.mjs, checking main ancestry, exact tag, committed inputs,
App/root versions and the pinned Harness commit against GITHUB_SHA/UPSTREAM_SHA. Stable needs
a separately supported non-prerelease build contract; never strip a beta suffix to promote it.
Historical 2.x to Harness 0.x is an explicit manual migration, never an automatic downgrade.

## Configuration ownership

The effective signer lives in the private deployment repository under
`docker-helm.dofe.ai/apps/sensteed-agent/`. GitHub Secrets are materialized CI copies, never the
source of truth. Keys must not enter application source, installers or logs. Pull requests
receive no upload/signing credentials. The pinned TOS SDK is CI-only.

| Configuration | Purpose |
| --- | --- |
| TOS_ACCESS_KEY_ID / TOS_SECRET_ACCESS_KEY | Upload authority |
| TOS_BUCKET | Fixed dofe-public |
| TOS_REGION / TOS_ENDPOINT | Region and native HTTPS service endpoint |
| TOS_PUBLIC_BASE_URL | Permanent HTTPS bucket-root origin, exactly matching Models configuration |
| DESKTOP_RELEASE_MANIFEST_SIGNING_KEY_ID | Provenance signer identifier |
| DESKTOP_RELEASE_MANIFEST_SIGNING_KEY_PEM | Ed25519 PKCS8 private key |

Models receives only public keys through DESKTOP_RELEASE_MANIFEST_PUBLIC_KEYS_JSON. Candidates
with a configured signer also receive signed provenance while their installers remain unsigned.
Unsigned manifests can be stored but cannot be published through Models. Release mode requires
a manifest signer. Partial or invalid signing configuration fails before upload. Node receives
the private key over stdin, never argv, temporary files or output. Provenance signing does not
substitute for Apple code signing or Hub target proof.

Signed macOS releases additionally require MAC_CERT_P12_BASE64, MACOS_SIGN_IDENTITY,
CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID. Missing credentials
never silently downgrade a release. Windows/Linux retain their existing unsigned packaging
and declare that status honestly.

## Artifacts and upload order

```text
sensteed-agent/<yymmddhh>/<exact-version>-<run-id>-<attempt>/
  macos/*.dmg
  windows/*-Setup.exe
  windows/*-Portable.zip
  linux/*.AppImage
  linux/*.deb
  manifest.json
  manifest.sig.json  # when a provenance signer is configured
```

The five targets are darwin arm64 DMG installed; win32 x64 EXE installed and ZIP portable;
linux x64 AppImage portable and DEB installed. Each artifact is limited to 4 GiB and hashed
as a stream. Manifest formatVersion=2 binds product, generation, exact version/appVersion/tag,
harnessVersion, both source commits, run/attempt, sizes, SHA-256, permanent URLs and code-signing
status. It contains no temporary authorization URLs.

Upload all installers, verify HEAD size/hash metadata, write an immutable manifest, then write
the detached Ed25519 signature over its exact UTF-8 bytes. SDK GenericInput propagates
x-tos-forbid-overwrite to multipart creation and completion. Failed attempts can leave partial
objects; Models rejects missing or invalid evidence. Retries use a new attempt directory.
Historical objects are not deleted.

## Models integration and compatibility

The Actions summary lists permanent source URLs. Source objects may remain private: Models
reads them using its fixed TOS client, verifies the trusted manifest and complete target set,
then copies into immutable objects under yootun-agent/releases/ and rechecks bytes. A URL is
not authority; arbitrary or temporary URLs and metadata-only hashes are insufficient.

CI no longer reads or writes sensteed-agent/channels/*.json. The desktop reads Models; the
source audit found no desktop consumer of the old TOS pointer. Historical pointers remain.
Any external consumer must migrate to Models or an explicit read-only projection of Models
revisions; never restore a second channel writer. Clients select v2 artifact IDs by exact
OS/architecture/format/installation mode and require SHA-256. Portable packages never invoke
NSIS, and Linux packaging does not imply an implemented automatic installer.

Upload, Models validation, publication and device activation are separate acceptance stages.
Models administrative actions retain SSO platform-superadmin enforcement.

## Local validation

```sh
node --test scripts/ci/resolve-source.test.mjs scripts/release-contract.test.mjs
python3 -B -m unittest discover -s scripts/ci -p 'test_*.py'
corepack pnpm check:layout
```

Unit tests use in-memory TOS doubles and ephemeral synthetic signers. Native builds, code
signing, actual TOS no-overwrite behavior and Models import require their real environments.
