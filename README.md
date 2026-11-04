# Shared model and pricing catalog

The service stores model prices and capabilities in one validated file.
Applications retrieve entries through the package client and calculate costs directly in memory.
Catalog changes do not require applications to update the package.

Node.js is required; the version and dependencies are specified in the [package manifest](package.json).

```bash
npm install --save-exact fa-model-catalog@0.1.0
```

Application connection example:

```js
import { createCatalogClient } from 'fa-model-catalog/client';
import { calculatePrice } from 'fa-model-catalog/pricing';

const client = createCatalogClient({
  baseUrl: process.env.MODEL_CATALOG_URL,
  token: process.env.MODEL_CATALOG_TOKEN,
  models: ['gpt-6-sol'],
});
await client.start();
try {
  const [record] = await client.get(['gpt-6-sol']);
  const result = calculatePrice(record, {
    unit: 'tokens',
    inputTokens: 1000,
    cachedInputTokens: 200,
    cacheWriteInputTokens: 100,
    outputTokens: 50,
  });
  console.dir(result, { depth: null });
} finally {
  client.stop();
}
```

In a long-running application, create one client per process and stop it during shutdown.
Pass the key through private application settings; never include it in source files or logs.

- [Catalog structure and name lookup](docs/catalog.md).
- [Client, scheduling, and calculations](docs/client.md).
- [Startup and operations](docs/operations.md).
- [Development setup and project settings](docs/development.md).

The example catalog illustrates the data format; information not confirmed by the provider remains available
with an explanation of its limitations.
Publishing the package does not confirm that every rate matches the provider's current price.

Development uses the checks defined in the [package manifest](package.json):

```bash
npm ci
npm run quality
npm run catalog:check
npm pack --dry-run
```
