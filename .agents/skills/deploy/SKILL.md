---
name: deploy
description: Deploy and maintain fa-model-catalog locally and on Linux as a systemd service without a database.
---

# Model catalog deployment

Before acting, read package.json, .agents/skills/deploy/config/config.example.yaml, and this skill's scripts/remote.mjs.
Work from the project root; obtain connections from servers.local.md and this skill's config/config.local.yaml.
Do not print keys or private files or include them in Git or npm. Create new keys with fa-web-access,
store them only in this skill's config/config.local.yaml, and use one shared key for all consumers.
Do not create a second copy of the key; consumers must read access.clients[0].keys[0].token from this file.

Connection settings must follow config/config.example.yaml in this skill's directory.
Store all settings in config/config.local.yaml; config/config.example.yaml is the only example.
The remote section defines the connection, access contains access keys, and server defines service settings.
Upload only access to /etc/fa-model-catalog/access.yaml and server to /etc/fa-model-catalog/server.yaml.
Do not upload remote or the complete local file. Read values from the file rather than duplicating them in the script.
Verify the hostname and paths before acting; do not stop another service when a port is occupied.

Use `node .agents/skills/deploy/scripts/remote.mjs <command>`:

| Command                | Purpose                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| inspect                | Check access, occupied ports, and availability of Node.js and nginx.                                    |
| deploy                 | Install code, dependencies, the service, and the secure public endpoint; preserve the catalog and keys. |
| update                 | Fetch the pushed branch, update dependencies, and restart only this project's service.                  |
| status                 | Check the service, local readiness, and recent log entries.                                             |
| start / stop / restart | Manage only this project's service.                                                                     |
| logs                   | Show recent log entries from this project's service.                                                    |
| push-catalog           | Validate and atomically replace the active catalog from catalog.yaml.                                   |
| push-access            | Validate and atomically replace access keys from .agents/skills/deploy/config/config.local.yaml.        |

The active catalog must be catalog.yaml in the server checkout and excluded from Git;
catalog.example.yaml in the project root is its example. Service settings reside in /etc/fa-model-catalog.
Code updates must not overwrite these files. Initial deployment must install the catalog and access settings;
subsequent deployments must preserve them. Replace them only with the dedicated commands listed above.
The public port must be 9062; the internal port must be 19062 on 127.0.0.1. nginx must use the installed certificate
and proxy requests to the application. Do not copy the certificate's private key to the local computer.

Before deployment, npm run quality and installation of the npm archive in a separate verification project must pass.
For local startup, prepare this skill's config/config.local.yaml from the example and run npm start -- --config <path>.
After deployment, check systemd, readiness, rejection without a key, successful price retrieval with a key,
and recent errors. Do not claim success based only on the script's exit code. Remove temporary test keys even on failure.
This skill does not independently authorize publishing to npm or connecting consumers.
