# Sealed Host target proof

`run-hub-target-proof.mjs` is the CI parent process. It fetches an already-created
admin proof run from the fixed public Hub origin, downloads every original signed
artifact into a private temporary directory, and verifies its size and SHA-256.
It does not publish, install, mint consumption, or manufacture a compatibility claim.

The tested executable is the packaged Electron binary from the same application
as `resources/app.asar`. The only executed entry is
`app.asar/lib/hub-target-proof-runner.js`, with `ELECTRON_RUN_AS_NODE=1`.
The entry rejects workspace execution, reads compiled release trust anchors,
checks the actual immutable base digest and runtime versions, validates the
signed manifests and complete artifact topology, and invokes the actual Cordis
Loader and filesystem provider against a private composition.

The private Host uses production config editor/settings, credentials, tools,
system prompt, attachments, loopback web server/connection and the sealed product
SSO service/routes. It has no saved identity, model key or business MCP transport.
A missing required service or signed artifact is a failure, not a stubbed success.
Positive loading, corrupt-byte rejection and a real throwing-entry/missing-skill
negative control must all pass; candidate files and the base are rehashed afterward.

The wrapper requires `sandbox-exec` on macOS or `bwrap` on Linux, otherwise fails.
The child has no CI credential environment, signing key, SSO token file, outbound
network, user home, or writable packaged base. Only its private temporary directory
is writable. The real loopback server can bind locally; there is no external route.
Candidate output is not forwarded to CI logs. Windows proof is not implemented.
The CI parent alone signs the canonical result with its separate Ed25519 key.
The script writes `{submission,evidence}` to a new private output file; submission
through the Hub's existing result API is a separate explicit CI step.

```sh
node scripts/run-hub-target-proof.mjs \
  --run-id "$HUB_PROOF_RUN_ID" \
  --session-token-file "$HUB_PROOF_SSO_TOKEN_FILE" \
  --resources "$PACKAGED_RESOURCES_PATH" \
  --electron "$PACKAGED_ELECTRON_EXECUTABLE" \
  --private-key "$HUB_PROOF_CI_KEY_FILE" \
  --output "$HUB_PROOF_SIGNED_RESULT_FILE"
```

Create the base through the repository's normal clean main/tag packaging flow.
Rebuilds, subsequent OS signing, or any immutable-core change produce a different
build identity and require a new run. Source unit tests use ephemeral signing keys
only through the materialization helper; they do not constitute a production
sealed-build proof or demonstrate readiness of all default packages.
