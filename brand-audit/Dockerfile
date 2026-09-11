# Brand Audit V0.
#
# One container runs the app and the browser. Playwright is the reason this is
# not a serverless deployment: the crawler needs a real Chromium.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    DATA_DIR=/data

# Chromium's runtime libraries, installed once so the image stays reproducible.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation fonts-noto-color-emoji libasound2 \
      libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 \
      libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
      libxkbcommon0 libxrandr2 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package.json next.config.ts ./
COPY db ./db

# Install the browser build this Playwright version pins.
RUN npx --yes playwright-core@1.63.0 install chromium

# Audited sites are third-party code; never run the browser as root.
RUN useradd -m -u 10001 audit && mkdir -p /data && chown -R audit:audit /data /app
USER audit

VOLUME ["/data"]
EXPOSE 3000
CMD ["npm", "run", "start"]
