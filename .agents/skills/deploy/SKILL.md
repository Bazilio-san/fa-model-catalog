---
name: deploy
description: Deploy and maintain fa-model-catalog on explicitly selected Linux servers as a systemd service.
---

# Model catalog deployment

For setup, defaults, catalog selection, and command usage, read [REAADME.md](REAADME.md).

Before deployment or maintenance, read package.json, scripts/remote.js, and root update.js.
Select the installation explicitly with `--server <name>`; never assume a default server.
Before working on that installation, read its `configs/<name>/rules.md` and follow its specific instructions.
Never print private files or keys. Never include them in Git, archives, npm packages, or command arguments.
Create keys with fa-web-access. Consumers share access.token in the application's config/local.yaml.

## Configuration

Each installation has its own folder `configs/<name>/` with three required files:

- `config.yaml`: `remote` and `deployment` sections for connection and deployment settings.
- `local.yaml`: `access` and `server` sections for access keys and application settings.
- `rules.md`: installation purpose, network constraints, required checks, and recovery instructions.

For a new installation, copy [configs/_example](configs/_example/) to `configs/<name>/` and fill all three files.
Names must match `[a-z0-9][a-z0-9._-]*`. Real installation folders are ignored by Git; `_example` cannot be selected.
Keep private keys outside the project. Ask only for missing settings; never copy credentials from another project.
The wrapper works independently of its caller's directory. Select the first existing catalog from
`configs/<server>/catalog.yaml`, root `catalog.yaml`, then root `catalog.example.yaml`.
Copy it to the remote project root as `catalog.yaml`.
The remote section defines SSH connection and public hostname. The repository is fixed to this project. Omit deployment.publicPort for HTTPS port 443.
Set it only for a nonstandard HTTPS port. The server section defines loopback settings
and persistent catalog paths. The deployment section defines the checkout, service, branch, public HTTPS port,
existing nginx site and local catalog source. Keep real domains and paths out of
public examples.
Upload the selected local.yaml as `<appDirectory>/config/local.yaml`, containing both `server` and `access`.
There is no separate key file or accessFile setting. Never upload config.yaml or the remote section.
For local startup, use root `config/local.yaml`; `npm start` reads it by default. Keep it outside Git and packages.

Before a remote change, run `show` and match the selected host, branch, checkout, service, and endpoints to the request
and installation rules. `show` reads local settings only and prints no access tokens or private key paths.
For multiple servers, run the requested command separately with each explicit name and report each outcome.
When installations share a host, use distinct checkout paths, service names, loopback ports, and public
hostname/port combinations so their managed routes do not overlap. Updating one installation must not affect another.

## Nginx configuration

Before an initial deployment, inspect the selected server's enabled sites, includes, certificate coverage and expiry,
listeners, and hostname resolution. Use the server's existing conventions to choose a suitable arrangement:
a dedicated site, routes in a shared site, or an included fragment. Do not assume another server's layout applies.
An absent site is a reason to investigate and configure it, not to stop when the required settings are discoverable.
Read certificate metadata and paths only; never read private key contents.

Save the actual Nginx configuration in `configs/<name>/*.config`. These are private, installation-specific artifacts,
not universal templates. In that installation's `rules.md`, record each artifact's remote destination, whether it is a
complete dedicated site or a fragment, its inclusion or symlink arrangement, certificate dependencies, and checks.
For an existing installation without saved artifacts, capture its working configuration without changing the server.
Do not store private key contents or access tokens in these artifacts.

On subsequent runs, check the service and relevant live configuration first. If the intended endpoint and routes
already work, leave remote Nginx files and the running Nginx process alone, even during `deploy` or `push-config`.
A saved artifact is a recovery source, not a reason to overwrite a working site. Apply it only for initial setup,
a demonstrated missing or incorrect configuration, or an explicit request to change Nginx. Compare saved content
with the live configuration before applying it; preserve changes made by administrators and unrelated routes.
If listener or endpoint settings change, reconcile only the affected configuration as needed before verification.

When a change is needed, adapt and save the configuration for this installation, preserve the affected remote files
for rollback, and install only the necessary files or fragments. Test with `nginx -t` before reloading. Restore the
previous files on test or reload failure and confirm Nginx remains operational; remove only new files from this task.
Do not replace a shared site wholesale or change another application's routes, certificates, or listeners.
Verify TLS with certificate validation, public health, and authenticated and unauthenticated model requests.

The wrapper manages application deployment and verification only; it never writes or reloads Nginx configuration.
Prepare any necessary Nginx configuration before invoking `deploy`, which verifies the public endpoint at the end.
The routes must expose `POST /v1/models/resolve` with the Authorization header preserved and
`/model-catalog/health` mapped to the loopback `/health`. Choose other proxy settings for the installation.

## Commands

Run `node .agents/skills/deploy/scripts/remote.js --server <name> <command>`:

| Command         | Purpose                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| show            | Show the selected installation and rules path without connecting or printing secrets.          |
| inspect         | Check target identity, tools, existing nginx site, and loopback port.                          |
| deploy          | Clone Git code, provision persistent data and systemd, start, and verify.                      |
| check           | Fetch Git state and report whether the server needs synchronization; do not restart.           |
| update          | Update the selected Git commit through root update.js, then verify the public endpoint.        |
| start / restart | Use the same updater with a forced restart, even when the commit is unchanged.                 |
| stop            | Stop only this project's service.                                                              |
| status / logs   | Read service state, readiness, installed commit, or recent logs.                               |
| push-catalog    | Validate and atomically replace the catalog from the automatically selected local file.        |
| push-config     | Replace config/local.yaml including keys and force an update/restart.                          |
| verify          | Check systemd, internal/public readiness, access denial, authenticated model lookup, and logs. |

## Git updates

Deploy code only from Git. Never upload a working tree or npm archive as server code.
Run npm run quality and install the npm archive in a separate verification project before initial deployment.
Commit and push reviewed project changes; do not include unrelated user changes or private files.
The wrapper requires clean tracked local files and a local commit present in the configured origin branch.
It fetches that commit on the server and refreshes update.js from Git before invoking it under an exclusive lock.
Keep update.js executable in Git with mode 100755.

The updater synchronizes tracked server files with git reset --hard to the selected commit.
It preserves ignored settings, the active catalog, dependencies, and untracked data; it does not run git clean.
Only changed package manifests or missing dependencies require npm ci --omit=dev --ignore-scripts.
There is no build step, compiler, or database. Validate runtime files before restarting only this project's service.
A failed update leaves .runtime/update-pending.json so the next run repeats necessary steps.
Code updates use update.js; keep the wrapper focused on connection, provisioning, configuration, and verification.

## Persistent data and migration

Keep catalog.yaml at the configured checkout root, ignored by Git. catalog.example.yaml is the public format example.
Deployment installs the selected config/local.yaml and replaces the catalog with the selected local file.
Both deploy and push-catalog replace an existing catalog. Code updates preserve it.
Use push-config or deploy to replace application settings and keys.
When upgrading an installation that used separate server/key files, run deploy to update the systemd command as well.
Never stop another service if the configured loopback port is occupied.

For a server move, validate and preserve the old catalog and config/local.yaml first.
Deploy and verify the new endpoint before stopping the old service. Remove only the identified old service's unit,
nginx rules, runtime, and checkout after checking hostname, unit paths, and repository ownership.
Never remove another application's virtual host, shared certificate, or unrelated files.

## Verification and client address

The client HTTP endpoint is `POST /v1/models/resolve` with JSON and bearer authentication.
For the package client, baseUrl is the HTTPS origin; it appends /v1/models/resolve automatically.
Readiness is /health internally and /model-catalog/health on the shared HTTPS site.
Verify a real model resolves with the configured shared key and an unauthenticated request returns 401.
Inspect recent service errors. Do not claim success from an exit code alone.
Remove temporary test credentials on failure.
This skill does not independently authorize npm publication or changes to consumers.
