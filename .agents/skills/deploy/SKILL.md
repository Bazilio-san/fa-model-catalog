---
name: deploy
description: Deploy and maintain fa-model-catalog locally and on Linux as a systemd service without a database.
---

# Model catalog deployment

Before deployment or maintenance, read package.json, config/config.example.yaml, scripts/remote.js, and root update.cjs.
Resolve connection and deployment values from this skill's config/config.local.yaml; servers.local.md defines aliases.
Never print private files or keys. Never include them in Git, archives, npm packages, or command arguments.
Create keys with fa-web-access. All consumers share access.clients[0].keys[0].token from the private settings.

## Configuration

Keep connection, runtime, access, and deployment values in config/config.local.yaml following config/config.example.yaml.
The wrapper accepts `--config <path>` to select another private file and works independently of its caller's directory.
The remote section defines SSH connection, public hostname, and repository. The server section defines loopback settings
and persistent catalog/access paths. The deployment section defines the checkout, service, branch, public HTTPS port,
existing nginx site, managed nginx snippet, and local catalog source. Keep real domains and paths out of public examples.
Only access and server sections are uploaded separately to /etc/<service>/access.yaml and server.yaml.
Never upload the complete local settings or the remote section. Do not duplicate keys in another local file.

The existing nginx site must already serve the configured hostname and port with a valid certificate.
The wrapper adds an include to its HTTPS server and manages only the exact routes `/v1/models/resolve`
and `/model-catalog/health`. It tests nginx before reloading and restores changed configuration if the test fails.
Do not replace a shared virtual host, certificate, root location, or another application's routes.

## Commands

Run `node .agents/skills/deploy/scripts/remote.js <command>` from the checkout:

| Command         | Purpose                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| inspect         | Check target identity, tools, existing nginx site, and loopback port.                          |
| deploy          | Clone Git code, provision persistent data and systemd, start, configure nginx, and verify.     |
| check           | Fetch Git state and report whether the server needs synchronization; do not restart.           |
| update          | Update the selected Git commit through root update.cjs, then verify the public endpoint.       |
| start / restart | Use the same updater with a forced restart, even when the commit is unchanged.                 |
| stop            | Stop only this project's service.                                                              |
| status / logs   | Read service state, readiness, installed commit, or recent logs.                               |
| push-catalog    | Validate and atomically replace the catalog from deployment.catalogSource.                     |
| push-access     | Validate and atomically replace access keys from the private settings.                         |
| push-config     | Replace runtime settings, reconcile nginx routes, and force an update/restart.                 |
| verify          | Check systemd, internal/public readiness, access denial, authenticated model lookup, and logs. |

## Git updates

Deploy code only from Git. Never upload a working tree or npm archive as server code.
Run npm run quality and install the npm archive in a separate verification project before initial deployment.
Commit and push reviewed project changes; do not include unrelated user changes or private files.
The wrapper requires clean tracked local files and a local commit present in the configured origin branch.
It fetches that commit on the server and refreshes update.cjs from Git before invoking it under an exclusive lock.
Keep update.cjs executable in Git with mode 100755.

The updater synchronizes tracked server files with git reset --hard to the selected commit.
It preserves ignored settings, the active catalog, dependencies, and untracked data; it does not run git clean.
Only changed package manifests or missing dependencies require npm ci --omit=dev --ignore-scripts.
There is no build step, compiler, or database. Validate runtime files before restarting only this project's service.
A failed update leaves .runtime/update-pending.json so the next run repeats necessary steps.
Code updates use update.cjs; keep the wrapper focused on connection, provisioning, configuration, and verification.

## Persistent data and migration

Keep catalog.yaml at the configured checkout root, ignored by Git. catalog.example.yaml is the public format example.
Initial deployment installs the validated catalog source and access settings; repeat deployments preserve existing data.
Only push-catalog and push-access replace existing persistent data. Runtime settings use push-config or deploy.
Never stop another service if the configured loopback port is occupied.

For a server move, validate and preserve the old catalog and access keys in private settings first.
Deploy and verify the new endpoint before stopping the old service. Remove only the identified old service's unit,
nginx rules, runtime, and checkout after checking hostname, unit paths, and repository ownership.
Never remove another application's virtual host, shared certificate, or unrelated files.

## Verification and client address

The client HTTP endpoint is `POST /v1/models/resolve` with JSON and bearer authentication.
For the package client, baseUrl is the HTTPS origin; it appends /v1/models/resolve automatically.
Readiness is /health internally and /model-catalog/health on the shared HTTPS site.
Verify a real model resolves with the configured shared key and an unauthenticated request returns 401.
Inspect recent service errors. Do not claim success from an exit code alone. Remove temporary test credentials on failure.
This skill does not independently authorize npm publication or changes to consumers.
