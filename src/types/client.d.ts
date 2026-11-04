import type { ModelRecord } from './types.js';
export interface ClientOptions {
  baseUrl: string;
  token: string;
  models?: string[];
  timezone?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  random?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  onEvent?: (event: object) => void;
}
export interface CatalogClient {
  start(): Promise<void>;
  get(names: string[]): Promise<ModelRecord[]>;
  refresh(): Promise<ModelRecord[] | undefined>;
  stop(): void;
  readonly nextRefreshAt: string | null;
}
export function createCatalogClient(options: ClientOptions): CatalogClient;
