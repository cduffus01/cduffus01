import { FileStore } from "./file-store";
import type { Store } from "./types";

let instance: Store | null = null;

/**
 * Returns the configured store. Postgres when DATABASE_URL is set, otherwise a
 * durable file store so the product boots with no external services.
 */
export function getStore(): Store {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (url) {
    // Required lazily so `pg` is never loaded (or bundled) in file-store mode.
    const { Pool } = require("pg") as typeof import("pg");
    const { PostgresStore } = require("./pg-store") as typeof import("./pg-store");
    instance = new PostgresStore(new Pool({ connectionString: url, max: 5 }));
  } else {
    instance = new FileStore();
  }
  return instance;
}

export type { Store };
