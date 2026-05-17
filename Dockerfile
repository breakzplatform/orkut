# Same pinned dependency versions as the working VM — no upgrade.
FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Build toolchain present for any native module that needs to compile (libsql).
RUN npm ci

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Mutable state (labels.db*, cursor.txt, supporters.json, .env) lives here,
# mounted as a volume — never baked into the image.
VOLUME ["/data"]
EXPOSE 4001
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
