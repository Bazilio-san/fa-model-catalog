const fields = {
  standard: ['inp', 'inpC', 'inpW', 'out'],
  flex: ['inpF', 'inpCF', 'inpWF', 'outF'],
  batch: ['inpB', null, null, 'outB'],
  fast: ['inpFast', null, null, 'outFast'],
};

export function tariffSnapshot(record, { serviceTier = 'standard' } = {}) {
  const model = record?.model;
  if (record?.status !== 'found' || !model || !fields[serviceTier] || !model.modes.includes(serviceTier)) {
    return null;
  }
  const [input, cachedInput, cacheWriteInput, output] = fields[serviceTier];
  return structuredClone({
    requestedName: record.requestedName,
    matchedName: record.matchedName,
    canonicalName: record.canonicalName,
    catalogVersion: record.catalogVersion,
    currency: 'USD',
    serviceTier,
    billing: model.billing,
    evidence: model.evidence,
    rates: {
      input: model[input] ?? null,
      cachedInput: cachedInput ? (model[cachedInput] ?? null) : null,
      cacheWriteInput: cacheWriteInput ? (model[cacheWriteInput] ?? null) : null,
      output: model[output] ?? null,
    },
    matrix: { low: model.low, medium: model.medium, high: model.high },
    stale: record.stale ?? false,
    lastSuccessAt: record.lastSuccessAt ?? null,
    reason: record.reason ?? null,
  });
}

export function calculatePrice(record, usage, { serviceTier = 'standard' } = {}) {
  const snapshot = tariffSnapshot(record, { serviceTier });
  const issues = [];
  const quantities = structuredClone(usage);
  const parts = {};
  const add = (name, quantity, rate, per) => {
    const valid =
      typeof quantity === 'number' &&
      Number.isFinite(quantity) &&
      quantity >= 0 &&
      (snapshot.billing.kind !== 'tokens' || Number.isSafeInteger(quantity));
    const known = typeof rate === 'number' && Number.isFinite(rate) && rate >= 0;
    const cost = valid && (known || quantity === 0) ? (quantity === 0 ? 0 : (quantity / per) * rate) : null;
    parts[name] = { quantity: quantity ?? null, rate, per, costUsd: cost };
    if (!valid) {
      issues.push(`Invalid quantity: ${name}.`);
    } else if (!known && quantity !== 0) {
      issues.push(`Unknown rate: ${name}.`);
    }
    if (cost !== null && !Number.isFinite(cost)) {
      parts[name].costUsd = null;
      issues.push(`Cost overflow: ${name}.`);
    }
  };
  if (!snapshot) {
    issues.push(record?.status === 'found' ? 'The service tier is not supported.' : 'Pricing is unavailable.');
  } else {
    const { billing, rates } = snapshot;
    if (snapshot.stale) {
      issues.push(`Pricing is stale: ${snapshot.reason || 'The refresh has not been confirmed.'}`);
    }
    if (snapshot.evidence.status === 'insufficient') {
      issues.push(snapshot.evidence.reason);
    }
    if (usage.unit !== billing.unit) {
      issues.push('The usage unit does not match the billing unit.');
    }
    if (billing.kind === 'tokens') {
      const { inputTokens, outputTokens, cachedInputTokens = 0, cacheWriteInputTokens = 0 } = usage;
      const values = [inputTokens, cachedInputTokens, cacheWriteInputTokens];
      const valid =
        values.every((n) => Number.isSafeInteger(n) && n >= 0) &&
        cachedInputTokens + cacheWriteInputTokens <= inputTokens;
      if (!valid) {
        issues.push('Input quantities are inconsistent or are not nonnegative integers.');
      }
      add('input', valid ? inputTokens - cachedInputTokens - cacheWriteInputTokens : null, rates.input, billing.per);
      add('cachedInput', cachedInputTokens, rates.cachedInput, billing.per);
      add('cacheWriteInput', cacheWriteInputTokens, rates.cacheWriteInput, billing.per);
      add('output', outputTokens, rates.output, billing.per);
    } else if (billing.kind === 'quantity') {
      add('quantity', usage.quantity, rates.input, billing.per);
    } else {
      add('quantity', usage.quantity, snapshot.matrix[usage.quality]?.[usage.size] ?? null, billing.per);
    }
  }
  const knownSubtotalUsd = Object.values(parts).reduce((sum, p) => sum + (p.costUsd ?? 0), 0);
  const complete =
    Boolean(snapshot) && usage.unit === snapshot.billing.unit && Object.values(parts).every((p) => p.costUsd !== null);
  return {
    usage: quantities,
    snapshot,
    parts,
    knownSubtotalUsd,
    priceUsd: complete ? knownSubtotalUsd : null,
    status: !complete ? 'incomplete' : issues.length ? 'qualified' : 'complete',
    issues,
  };
}
