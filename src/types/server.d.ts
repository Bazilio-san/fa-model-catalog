import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
export interface ServerOptions {
  catalogFile?: string;
  access: { token: string };
  configFile?: string;
  reloadIntervalMs?: number;
  onEvent?: (event: object) => void;
}
export function createCatalogServer(options: ServerOptions): {
  server: HttpServer;
  store: {
    load(): Promise<void>;
    reload(): Promise<boolean>;
    readonly error: string | null;
    readonly snapshot: object | undefined;
    stop(): void;
  };
  access: { reload(): Promise<unknown>; stop(): void };
  listen(options?: { port?: number; host?: string }): Promise<AddressInfo | string | null>;
  close(): Promise<void>;
};
