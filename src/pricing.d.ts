import type { ModelRecord, Usage, ServiceTier, TariffSnapshot } from './types.js';
export function tariffSnapshot(record: ModelRecord, options?: { serviceTier?: ServiceTier }): TariffSnapshot | null;
export function calculatePrice(
  record: ModelRecord,
  usage: Usage,
  options?: { serviceTier?: ServiceTier },
): {
  usage: Usage;
  snapshot: TariffSnapshot | null;
  parts: Record<string, { quantity: number | null; rate: number | null; per: number; costUsd: number | null }>;
  knownSubtotalUsd: number;
  priceUsd: number | null;
  status: 'incomplete' | 'qualified' | 'complete';
  issues: string[];
};
