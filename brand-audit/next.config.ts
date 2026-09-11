import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // playwright-core and pdf-parse must stay outside the bundler: they resolve
  // browser binaries and optional deps at runtime.
  serverExternalPackages: ["playwright-core", "pdf-parse", "pg"],
  experimental: {
    // Audits run for 30-90s inside the request-adjacent job queue.
    proxyTimeout: 120_000,
  },
};

export default nextConfig;
