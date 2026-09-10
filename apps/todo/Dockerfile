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

# Separate install with devDependencies (vite, react, etc.) — needed only to
# run `vite build`, not shipped in the final image.
FROM node:22-slim AS build-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM build-deps AS build
WORKDIR /app
COPY vite.config.js ./
COPY web ./web
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV TODO_DATA_DIR=/app/data
ENV TODO_PORT=8787

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# Built by the `build` stage (`vite build`, root: web, outDir: ../public) —
# public/ is a build artifact now, not hand-written source, so it isn't
# copied from the build context at all.
COPY --from=build /app/public ./public

RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin todo \
    && mkdir -p /app/data \
    && chown -R todo:todo /app

USER todo
EXPOSE 8787
VOLUME ["/app/data"]

CMD ["node", "src/server.js"]
