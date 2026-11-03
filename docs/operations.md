# Startup and operations

The service is deployed on PROD-2 and is available over HTTPS at https://eei.finam.ru:9062.
The application accepts requests only on a local address; the installed nginx provides HTTPS.
The service requires neither databases nor calls to model providers.

For deployment, obtain the [repository](https://github.com/Bazilio-san/fa-model-catalog) and use its project skill.
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
node .agents/skills/deploy/scripts/remote.mjs status
node .agents/skills/deploy/scripts/remote.mjs update
node .agents/skills/deploy/scripts/remote.mjs push-catalog
node .agents/skills/deploy/scripts/remote.mjs push-access
```

Catalog and access replacement commands validate their inputs before transfer and replace the working file atomically.
Routine code updates preserve the catalog, keys, and settings.
The complete command list is in the repository's deployment skill, which is not included in the installed client.

Readiness is checked through the public /health endpoint without exposing catalog contents.
Model retrieval requires a key; request handling is described in the [server](../src/server.js).
After updates, check the service, readiness, authenticated price retrieval, access denial without a key, and recent errors.

Catalog data does not confirm current provider prices without source verification.
Entry limitations remain until the data is updated with confirmed sources.
