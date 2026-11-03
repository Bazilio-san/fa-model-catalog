import { createCatalogClient } from 'fa-model-catalog/client';
import { calculatePrice, tariffSnapshot } from 'fa-model-catalog/pricing';
import { createCatalogServer } from 'fa-model-catalog/server';
const client = createCatalogClient({ baseUrl: 'http://localhost:9062', token: 'test' });
async function example() {
  await client.start();
  const [record] = await client.get(['demo']);
  const result = calculatePrice(record, { unit: 'tokens', inputTokens: 1, outputTokens: 1 });
  const price: number | null = result.priceUsd;
  tariffSnapshot(record);
  client.stop();
  return price;
}
void example;
void createCatalogServer({ catalogFile: 'catalog.yaml', accessFile: 'access.yaml' });
