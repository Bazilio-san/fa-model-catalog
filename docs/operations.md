# Startup and operations

The service endpoint, host, ports, and certificate settings are defined by each deployment.
Clients call `POST /v1/models/resolve`, with a bearer access key and a JSON body such as
`{"models":["gpt-6-sol"]}`. The package client takes only the HTTPS origin in `baseUrl` and adds this path.
The deployment setup uses a loopback application listener and an existing nginx HTTPS site.
Its managed snippet adds only `/v1/models/resolve` and `/model-catalog/health`; other routes remain owned by the site.
The service requires neither databases nor calls to model providers.

For deployment from a source checkout, use the project deployment skill with your own repository and server settings.
Connection and application settings follow the [configuration example](../.agents/skills/deploy/config/config.example.yaml).
The working catalog is `catalog.yaml` in the server project root and is excluded from Git.
The example is `catalog.example.yaml` in the project root. Code updates preserve the working catalog.
Service settings and keys are stored in `/etc/fa-model-catalog`.

For a local run:

```bash
npm ci
npm run catalog:check -- --file /path/to/catalog.yaml
npm start -- --config /path/to/server.yaml
```

The server settings specify paths to the working catalog and access file.
All consumers share one key; its sole local source is the private configuration file
(.agents/skills/deploy/config/config.local.yaml), at access.clients[0].keys[0].token.
Keys are created and validated by [fa-web-access](https://github.com/Bazilio-san/fa-web-access);
never place a real key in an example or log.

Manage the server from the repository root:

```bash
node .agents/skills/deploy/scripts/remote.js status
node .agents/skills/deploy/scripts/remote.js check
node .agents/skills/deploy/scripts/remote.js update
node .agents/skills/deploy/scripts/remote.js verify
node .agents/skills/deploy/scripts/remote.js push-catalog
node .agents/skills/deploy/scripts/remote.js push-access
```

Catalog and access replacement commands validate their inputs before transfer and replace the working file atomically.
Routine code updates preserve the catalog, keys, and settings.
The complete command list is in the repository's deployment skill, which is not included in the installed client.

Server code is installed only from Git. The wrapper selects the clean local Git commit and requires it to exist
in the configured remote branch. Commit and push reviewed code after local quality checks before deployment.
The wrapper refreshes the root `update.cjs` from that commit, then uses it for updates and forced restarts.
The updater resets tracked files to the selected commit, preserves ignored settings and untracked data,
installs production dependencies when needed, and checks settings, catalog, access, systemd, and readiness.
It does not compile code or run database migrations. Failed updates leave a pending marker for the next retry.
Use `--config <path>` to select another private deployment file. No code is uploaded from the working directory.

Readiness is checked through `/health` on loopback and `/model-catalog/health` publicly.
Model retrieval requires a key; request handling is described in the [server](../src/server.js).
After updates, check the service, readiness, authenticated price retrieval, access denial without a key, and recent errors.

Catalog data does not confirm current provider prices without source verification.
Entry limitations remain until the data is updated with confirmed sources.
