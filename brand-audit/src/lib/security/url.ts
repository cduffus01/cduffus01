import dns from "node:dns/promises";
import net from "node:net";
import { config } from "@/lib/config";

/**
 * Treat every submitted URL as hostile input (spec section 25).
 *
 * Validation happens before a browser ever sees the URL, and again on every
 * redirect hop, because DNS answers can change between checks.
 */

export interface UrlCheck {
  ok: boolean;
  url?: URL;
  reason?: string;
  code?: "invalid_url" | "blocked_url" | "unreachable";
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/** Ports outside this set are almost never a public website. */
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443", "3000"]);

export function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
      return true;
    const [a, b] = p as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // 192.0.0.0/24, 192.0.2.0/24
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (version === 6) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd"))
      return true;
    // IPv4-mapped (::ffff:10.0.0.1) must be judged by its embedded v4 address.
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    return false;
  }
  return true;
}

export function normalizeInputUrl(raw: string): UrlCheck {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, code: "invalid_url", reason: "No URL provided." };
  if (trimmed.length > 2048)
    return { ok: false, code: "invalid_url", reason: "That URL is too long." };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: "invalid_url", reason: "That doesn't look like a URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { ok: false, code: "blocked_url", reason: "Only http and https URLs can be audited." };

  // Arbitrary ports are only allowed in the local-testing mode used by the
  // smoke test, never for a user-submitted URL in production.
  if (!ALLOWED_PORTS.has(url.port) && !allowPrivateForTesting())
    return { ok: false, code: "blocked_url", reason: "That port isn't supported." };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal"))
    return { ok: false, code: "blocked_url", reason: "That host can't be audited." };

  if (!host.includes(".") && net.isIP(host) === 0)
    return { ok: false, code: "invalid_url", reason: "Enter a full domain, like example.com." };

  url.hash = "";
  url.username = "";
  url.password = "";
  return { ok: true, url };
}

/** Resolves DNS and rejects any answer that points inside a private network. */
export async function assertPublicHost(url: URL): Promise<UrlCheck> {
  const host = url.hostname;
  if (allowPrivateForTesting()) return { ok: true, url };

  if (net.isIP(host)) {
    return isPrivateIp(host)
      ? { ok: false, code: "blocked_url", reason: "That address is not publicly routable." }
      : { ok: true, url };
  }

  let addresses: string[];
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch {
    return { ok: false, code: "unreachable", reason: "We couldn't resolve that domain." };
  }
  if (addresses.length === 0)
    return { ok: false, code: "unreachable", reason: "We couldn't resolve that domain." };
  if (addresses.some(isPrivateIp))
    return { ok: false, code: "blocked_url", reason: "That address is not publicly routable." };

  return { ok: true, url };
}

/**
 * Escape hatch for local development and the smoke test, which audit a
 * fixture site on 127.0.0.1. Never enabled by default.
 */
export function allowPrivateForTesting(): boolean {
  return process.env.ALLOW_PRIVATE_HOSTS === "1";
}

export async function validateAuditUrl(raw: string): Promise<UrlCheck> {
  const normalized = normalizeInputUrl(raw);
  if (!normalized.ok || !normalized.url) return normalized;
  return assertPublicHost(normalized.url);
}

/** Same-site check used by the crawler to stay on the submitted domain. */
export function sameSite(a: URL, b: URL): boolean {
  return registrableDomain(a.hostname) === registrableDomain(b.hostname);
}

/**
 * Good-enough eTLD+1 for crawl scoping. A full public-suffix list is overkill
 * for V0: the only cost of being slightly conservative is crawling fewer pages.
 */
export function registrableDomain(hostname: string): string {
  if (net.isIP(hostname)) return hostname;
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const twoLevelTlds = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
    "co.nz", "co.za", "com.br", "co.jp", "co.in", "com.mx", "co.kr",
  ]);
  const lastTwo = parts.slice(-2).join(".");
  if (twoLevelTlds.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

export { config };
