# syntax=docker/dockerfile:1

# better-sqlite3 needs a native build; node:22-slim (glibc, Debian-based) has
# prebuilt binaries available via prebuild-install for the common
# linux/amd64 and linux/arm64 targets, so this stays a plain `npm ci` with
# no compiler toolchain required. If prebuild-install ever has to fall back
# to source (uncommon platform), add `python3 make g++` here.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV TODO_DATA_DIR=/app/data
ENV TODO_PORT=8787

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin todo \
    && mkdir -p /app/data \
    && chown -R todo:todo /app

USER todo
EXPOSE 8787
VOLUME ["/app/data"]

CMD ["node", "src/server.js"]
