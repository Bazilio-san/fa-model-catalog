import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice, tariffSnapshot } from '../../src/pricing.js';
import { model } from '../helpers.js';
const record = (overrides) => ({
  requestedName: 'demo',
  matchedName: 'demo',
  canonicalName: 'demo',
  catalogVersion: 'a'.repeat(64),
  status: 'found',
  model: model(overrides),
});
const usage = {
  unit: 'tokens',
  inputTokens: 1000,
  cachedInputTokens: 200,
  cacheWriteInputTokens: 100,
  outputTokens: 50,
};
test('Independent calculation of all cost components and service tiers', () => {
  const result = calculatePrice(record(), usage);
  assert.equal(result.parts.input.quantity, 700);
  for (const [name, expected] of Object.entries({
    input: 0.0014,
    cachedInput: 0.00004,
    cacheWriteInput: 0.00025,
    output: 0.0005,
  })) {
    assert(Math.abs(result.parts[name].costUsd - expected) < 1e-15);
  }
  assert(Math.abs(result.priceUsd - 0.00219) < 1e-15);
  assert(Math.abs(calculatePrice(record(), usage, { serviceTier: 'flex' }).priceUsd - 0.001095) < 1e-15);
  assert.equal(calculatePrice(record(), usage, { serviceTier: 'batch' }).priceUsd, null);
  assert.equal(
    calculatePrice(record(), { ...usage, cachedInputTokens: 0, cacheWriteInputTokens: 0 }, { serviceTier: 'batch' })
      .priceUsd,
    0.00125,
  );
  assert.equal(
    calculatePrice(record(), { ...usage, cachedInputTokens: 0, cacheWriteInputTokens: 0 }, { serviceTier: 'fast' })
      .priceUsd,
    0.005,
  );
});
test('Unknown rates, zero rates, incomplete usage, and stale pricing remain distinct', () => {
  assert.equal(calculatePrice(record({ inp: null }), usage).priceUsd, null);
  assert.equal(calculatePrice(record({ inp: 0 }), usage).parts.input.costUsd, 0);
  const invalid = calculatePrice(record(), { ...usage, cachedInputTokens: 1200 });
  assert.equal(invalid.priceUsd, null);
  assert.equal(invalid.usage.cachedInputTokens, 1200);
  assert.equal(invalid.parts.output.costUsd, 0.0005);
  const stale = calculatePrice({ ...record(), stale: true, reason: 'The service is unavailable.' }, usage);
  assert.equal(stale.status, 'qualified');
  assert(stale.priceUsd > 0);
  assert.equal(calculatePrice({ ...record(), status: 'not_found', model: null }, usage).priceUsd, null);
  assert.equal(calculatePrice(record({ modes: ['standard'] }), usage, { serviceTier: 'flex' }).priceUsd, null);
});
test('Missing or invalid output preserves every known input component', () => {
  const { outputTokens: _outputTokens, ...inputOnly } = usage;
  const cases = [
    inputOnly,
    ...[null, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '50'].map((outputTokens) => ({
      ...inputOnly,
      outputTokens,
    })),
  ];
  for (const partial of cases) {
    const result = calculatePrice(record(), partial);
    assert.deepEqual(result.usage, partial);
    assert.equal(result.parts.input.quantity, 700);
    for (const [name, expected] of Object.entries({
      input: 0.0014,
      cachedInput: 0.00004,
      cacheWriteInput: 0.00025,
    })) {
      assert(Math.abs(result.parts[name].costUsd - expected) < 1e-15);
    }
    assert(Math.abs(result.knownSubtotalUsd - 0.00169) < 1e-15);
    assert.equal(result.parts.output.costUsd, null);
    assert.equal(result.priceUsd, null);
    assert.equal(result.status, 'incomplete');
    assert.deepEqual(result.issues, ['Invalid quantity: output.']);
  }
  const serialized = JSON.parse(JSON.stringify(calculatePrice(record(), inputOnly)));
  assert.equal(serialized.parts.output.quantity, null);
});

test('Minutes, characters, and images are not treated as token units', () => {
  assert.equal(
    calculatePrice(record({ billing: { kind: 'quantity', unit: 'minutes', per: 1 }, inp: 0.006 }), {
      unit: 'minutes',
      quantity: 2,
    }).priceUsd,
    0.012,
  );
  assert.equal(
    calculatePrice(record({ billing: { kind: 'quantity', unit: 'characters', per: 1000000 }, inp: 15 }), {
      unit: 'characters',
      quantity: 1000,
    }).priceUsd,
    0.015,
  );
  assert.equal(
    calculatePrice(record({ billing: { kind: 'matrix', unit: 'images', per: 1 }, low: { '1024x1024': 0.006 } }), {
      unit: 'images',
      quantity: 2,
      quality: 'low',
      size: '1024x1024',
    }).priceUsd,
    0.012,
  );
  assert.equal(calculatePrice(record(), { ...usage, unit: 'minutes' }).priceUsd, null);
});
test('A snapshot is independent of subsequent price changes', () => {
  const r = record();
  const snapshot = tariffSnapshot(r);
  r.model.inp = 99;
  assert.equal(snapshot.rates.input, 2);
});
