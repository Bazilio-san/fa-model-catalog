export type ServiceTier = 'standard' | 'flex' | 'batch' | 'fast';
export type Unit = 'tokens' | 'characters' | 'minutes' | 'seconds' | 'images';
export interface Model {
  inp?: number | null;
  inpC?: number | null;
  inpW?: number | null;
  out?: number | null;
  inpF?: number | null;
  inpCF?: number | null;
  inpWF?: number | null;
  outF?: number | null;
  inpB?: number | null;
  outB?: number | null;
  inpFast?: number | null;
  outFast?: number | null;
  kT?: number | null;
  mot?: number | null;
  ui?: boolean;
  dimensions?: number[];
  dimensionsAllowed?: boolean;
  low?: Record<string, number | null>;
  medium?: Record<string, number | null>;
  high?: Record<string, number | null>;
  billing: { kind: 'tokens' | 'quantity' | 'matrix'; unit: Unit; per: number };
  modes: ServiceTier[];
  capabilities: { promptCacheKey: boolean; explicitPromptCaching: boolean; reasoningEfforts: string[] };
  evidence: { status: 'confirmed' | 'insufficient'; sources: string[] };
}
export interface ModelRecord {
  requestedName: string;
  matchedName: string | null;
  canonicalName: string | null;
  status: 'found' | 'not_found' | 'unavailable';
  model: Model | null;
  catalogVersion: string | null;
  stale?: boolean;
  lastSuccessAt?: string | null;
  reason?: string | null;
}
export interface Usage {
  unit: Unit;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  quantity?: number;
  quality?: 'low' | 'medium' | 'high';
  size?: string;
}
export interface TariffSnapshot {
  requestedName: string;
  matchedName: string | null;
  canonicalName: string | null;
  catalogVersion: string | null;
  currency: 'USD';
  serviceTier: ServiceTier;
  billing: Model['billing'];
  evidence: Model['evidence'];
  rates: { input: number | null; cachedInput: number | null; cacheWriteInput: number | null; output: number | null };
  matrix: { low?: Model['low']; medium?: Model['medium']; high?: Model['high'] };
  stale: boolean;
  lastSuccessAt: string | null;
  reason: string | null;
}
