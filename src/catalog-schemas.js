import Ajv from 'ajv';
import { parseDocument } from 'yaml';
import { createHash } from 'node:crypto';

export const priceFields = [
  'inp',
  'inpC',
  'inpW',
  'out',
  'inpF',
  'inpCF',
  'inpWF',
  'outF',
  'inpB',
  'outB',
  'inpFast',
  'outFast',
];
const amount = { type: ['number', 'null'], minimum: 0 };
const stringArray = { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true };
const matrix = { type: 'object', minProperties: 1, additionalProperties: amount };
export const modelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['billing', 'modes', 'capabilities', 'evidence'],
  properties: {
    ...Object.fromEntries(priceFields.map((k) => [k, amount])),
    kT: amount,
    mot: amount,
    ui: { type: 'boolean' },
    dimensions: { type: 'array', items: { type: 'integer', minimum: 1 }, uniqueItems: true },
    dimensionsAllowed: { type: 'boolean' },
    low: matrix,
    medium: matrix,
    high: matrix,
    modes: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['standard', 'flex', 'batch', 'fast'] } },
    billing: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'unit', 'per'],
      properties: {
        kind: { enum: ['tokens', 'quantity', 'matrix'] },
        unit: { enum: ['tokens', 'characters', 'minutes', 'seconds', 'images'] },
        per: { type: 'number', exclusiveMinimum: 0 },
      },
    },
    capabilities: {
      type: 'object',
      additionalProperties: false,
      required: ['promptCacheKey', 'explicitPromptCaching', 'reasoningEfforts'],
      properties: {
        promptCacheKey: { type: 'boolean' },
        explicitPromptCaching: { type: 'boolean' },
        reasoningEfforts: stringArray,
      },
    },
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'sources'],
      properties: {
        status: { enum: ['confirmed', 'insufficient'] },
        sources: stringArray,
      },
    },
  },
};
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'currency', 'models'],
  properties: {
    schemaVersion: { const: 1 },
    currency: { const: 'USD' },
    models: {
      type: 'object',
      minProperties: 1,
      propertyNames: { minLength: 1, maxLength: 512 },
      additionalProperties: { anyOf: [{ type: 'string', minLength: 1 }, modelSchema] },
    },
  },
};
const ajv = new Ajv({ allErrors: true, strictNumbers: true, allowUnionTypes: true });
const validate = ajv.compile(schema);
export const validateModel = ajv.compile(modelSchema);

export function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function sorted(value) {
  if (Array.isArray(value)) {
    return value.map(sorted);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sorted(value[k])]),
    );
  }
  return value;
}

export function parseCatalog(text) {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) {
    throw new Error('The catalog file contains a YAML error or a duplicate key.');
  }
  const data = doc.toJS({ maxAliasCount: 0 });
  if (!validate(data)) {
    throw new Error(`Invalid catalog structure: ${ajv.errorsText(validate.errors)}.`);
  }
  const resolved = Object.create(null);
  for (const key of Object.keys(data.models)) {
    const seen = new Set();
    let target = key;
    while (typeof data.models[target] === 'string') {
      if (seen.has(target)) {
        throw new Error(`Cyclic model reference: "${key}".`);
      }
      seen.add(target);
      target = data.models[target];
      if (!Object.hasOwn(data.models, target)) {
        throw new Error(`Reference target not found for model "${key}".`);
      }
    }
    const model = data.models[target];
    if (model.billing.kind === 'tokens' && model.billing.unit !== 'tokens') {
      throw new Error('Invalid token billing unit.');
    }
    if (model.billing.kind === 'matrix' && model.billing.unit !== 'images') {
      throw new Error('Invalid image matrix billing unit.');
    }
    for (const mode of model.modes) {
      const fields = {
        standard: ['inp', 'out'],
        flex: ['inpF', 'outF'],
        batch: ['inpB', 'outB'],
        fast: ['inpFast', 'outFast'],
      }[mode];
      if (model.billing.kind !== 'matrix' && fields.some((f) => !Object.hasOwn(model, f))) {
        throw new Error(`Missing rates for model "${target}".`);
      }
    }
    resolved[key] = { canonicalName: target, model };
  }
  return freeze({
    ...data,
    resolved,
    catalogVersion: createHash('sha256')
      .update(JSON.stringify(sorted(data)))
      .digest('hex'),
  });
}
