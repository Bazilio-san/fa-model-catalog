# Startup and operations

The service endpoint, host, ports, and certificate settings are defined by each deployment.
Clients call `POST /v1/models/resolve`, with a bearer access key and a JSON body such as
`{"models":["gpt-6-sol"]}`. The package client takes only the HTTPS origin in `baseUrl` and adds this path.
The deployment setup uses a loopback application listener and an existing nginx HTTPS site.
Its managed snippet adds only `/v1/models/resolve` and `/model-catalog/health`; other routes remain owned by the site.
The service requires neither databases nor calls to model providers.

For deployment from a source checkout, use the project deployment skill with your own repository and server settings.
Each named installation follows the [connection example](../.agents/skills/deploy/configs/_example/config.yaml)
and [application example](../.agents/skills/deploy/configs/_example/local.yaml).
Copy the example folder to `.agents/skills/deploy/configs/<name>/` and fill `config.yaml`, `local.yaml`, and `rules.md`.
Real installation folders are excluded from Git. Read the selected installation's rules before remote operations.
The working catalog is `catalog.yaml` in the server project root and is excluded from Git.
The example is `catalog.example.yaml` in the project root. Code updates preserve the working catalog.
Service settings and keys share `<appDirectory>/config/local.yaml`, with `server` and `access` sections.
There is no separate key file. The application settings file is excluded from Git and packages.

For a local run:

```bash
npm ci
npm run catalog:check -- --file /path/to/catalog.yaml
npm start
```

The default application settings file is `config/local.yaml`; use `--config <path>` for another location.
Its `server.catalogFile` resolves relative to the settings file. Its `access.clients` contains access keys directly.
Consumers share `access.clients[0].keys[0].token`. For deployment, prepare the same settings in the selected
`.agents/skills/deploy/configs/<name>/local.yaml`; the wrapper installs it as the application's `config/local.yaml`.
Keys are reread while the service runs. Invalid edits retain the last valid keys; an empty client list revokes access.
Other server setting changes require a restart.
Keys are created and validated by [fa-web-access](https://github.com/Bazilio-san/fa-web-access);
never place a real key in an example or log.

Manage the server from the repository root:

```bash
node .agents/skills/deploy/scripts/remote.js --server <name> show
node .agents/skills/deploy/scripts/remote.js --server <name> status
node .agents/skills/deploy/scripts/remote.js --server <name> check
node .agents/skills/deploy/scripts/remote.js --server <name> update
node .agents/skills/deploy/scripts/remote.js --server <name> verify
node .agents/skills/deploy/scripts/remote.js --server <name> push-catalog
node .agents/skills/deploy/scripts/remote.js --server <name> push-config
```

Catalog and configuration replacement commands validate inputs before transfer and replace the working file atomically.
Routine code updates preserve the catalog, keys, and settings.
Use `push-config` to replace application settings including keys. Deployment also installs the selected settings.
For installations using the former separate settings/key files, run `deploy` to update the systemd command.
The complete command list is in the repository's deployment skill, which is not included in the installed client.

Server code is installed only from Git. The wrapper selects the clean local Git commit and requires it to exist
in the configured remote branch. Commit and push reviewed code after local quality checks before deployment.
The wrapper refreshes the root `update.js` from that commit, then uses it for updates and forced restarts.
The updater resets tracked files to the selected commit, preserves ignored settings and untracked data,
installs production dependencies when needed, and checks settings, catalog, access, systemd, and readiness.
It does not compile code or run database migrations. Failed updates leave a pending marker for the next retry.
There is no default server: every command requires `--server <name>`.
Before remote changes, use `show` to check the selected installation without connecting or exposing secrets.
Repeat commands with each explicit name when managing multiple servers.
No code is uploaded from the working directory.

Readiness is checked through `/health` on loopback and `/model-catalog/health` publicly.
Model retrieval requires a key; request handling is described in the [server](../src/server.js).
After updates, check the service, readiness, authenticated price retrieval, access denial without a key, and
recent errors.

Catalog data does not confirm current provider prices without source verification.
Entry limitations remain until the data is updated with confirmed sources.
