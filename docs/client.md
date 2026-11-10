# Client and request cost

The client caches prices in process memory and reuses them for calculations.
Each calculation returns quantities, rates, components, and a tariff snapshot so stored usage can be explained.

Parameters and results are defined in the [client types](../src/types/client.d.ts) and [calculation types](../src/types/pricing.d.ts).
A connection example is available in the [main description](../README.md).
Calculation inputs can also be obtained separately as a [tariff snapshot](../src/pricing.js).

The model resolution endpoint is `POST /v1/models/resolve` on the configured HTTPS origin.
Set `baseUrl` to the origin, for example `https://catalog.example.com`, without `/v1/models/resolve`.
The package client appends that path automatically; passing the full endpoint as `baseUrl` repeats the path.

For failover, pass a nonempty `endpoints` array instead of the top-level `baseUrl` and `token`:

```js
const client = createCatalogClient({
  endpoints: [
    { baseUrl: 'https://catalog-primary.example.com', token: process.env.CATALOG_PRIMARY_TOKEN },
    { baseUrl: 'https://catalog-backup.example.com', token: process.env.CATALOG_BACKUP_TOKEN },
  ],
  models: ['gpt-6-sol'],
});
```

Each batch starts with the first endpoint and tries the next after a network failure, timeout, HTTP 429, or HTTP 5xx.
Each endpoint receives only its own token, and `timeoutMs` applies separately to each attempt.
The total wait can therefore reach the number of endpoints multiplied by `timeoutMs`.
Access denial, other HTTP 4xx responses, and invalid response data stop the batch without trying another endpoint.
A successful fallback updates the cache normally and does not emit `prices_unavailable` or schedule a retry.
If every endpoint fails temporarily, the client preserves cached prices and schedules one retry for the batch,
respecting the longest `Retry-After` received. Stopping the client cancels the current attempt and prevents failover.
All endpoints must serve the intended catalog; each response is validated independently.
The single-service `baseUrl` and `token` settings remain supported, but cannot be combined with `endpoints`.

For direct HTTP requests, send `Authorization: Bearer <token>` and `Content-Type: application/json`:

```http
POST /v1/models/resolve HTTP/1.1
Host: catalog.example.com
Authorization: Bearer <token>
Content-Type: application/json

{"models":["gpt-6-sol"]}
```

Startup loads the initial model set; requesting a new name retrieves its entry immediately.
Concurrent duplicate requests are combined, and missing entries are cached until the next refresh.
A forced refresh fetches all accumulated names again, including previously unknown names.

Scheduled refreshes run around 1 a.m. and 1 p.m. in an explicitly configured time zone.
Each process independently selects a random offset within twenty minutes for each window.
Missed polls do not accumulate while the process sleeps; stopping the client cancels timers and requests.
Scheduling is implemented in [time selection](../src/schedule.js), and failure handling in the [client](../src/client.js).

A network failure preserves the previous entry with a staleness reason and the last successful retrieval time.
If no data has been received, the client returns an unavailable state rather than reporting the model as missing.
Retries after temporary failures are limited; access denial and invalid requests do not trigger automatic retries.
For a corporate certificate, enable the Node.js system certificate store with `node --use-system-ca` if necessary;
certificate verification does not need to be disabled.

For text usage, ordinary input equals total input minus cache reads and writes.
Reasoning tokens already included in output are not added again.
Inconsistent quantities remain visible with an explanation; independent known components remain in the result.

An unknown total has no numeric substitute; the known subtotal is returned separately.
Calculations using stale or insufficiently supported prices remain numeric and include the reasons.
Applications handle rounding for storage or display; catalog updates do not change historical snapshots.

Audio and other non-text usage must use the corresponding unit.
Quantity billing uses the rate for the specified unit; image matrices use the selected quality and size.
A missing rate or mismatched unit never becomes a zero price.
