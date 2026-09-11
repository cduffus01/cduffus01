import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";

/**
 * Screenshot storage. Local disk by default; the interface is deliberately
 * tiny so an S3/R2 driver is a drop-in later (put/get/url only).
 */
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  url(key: string): string;
}

function safeKey(key: string): string {
  // Keys are generated internally, but they also arrive from URL paths.
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) {
    throw new Error("invalid storage key");
  }
  return key;
}

class LocalStorage implements ObjectStorage {
  private root = path.join(config.dataDir, "objects");

  async put(key: string, data: Buffer) {
    const target = path.join(this.root, safeKey(key));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    return this.url(key);
  }

  async get(key: string) {
    try {
      return await fs.readFile(path.join(this.root, safeKey(key)));
    } catch {
      return null;
    }
  }

  url(key: string) {
    return `/api/files/${safeKey(key)}`;
  }
}

let instance: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (!instance) instance = new LocalStorage();
  return instance;
}
