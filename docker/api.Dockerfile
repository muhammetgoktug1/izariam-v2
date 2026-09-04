# Build context is v2/.
#
# Debian rather than Alpine: argon2 compiles a native addon through
# node-gyp-build, and the glibc prebuilds are the well-trodden path.
FROM node:22-bookworm-slim

WORKDIR /app

# Toolchain for the one native dependency, dropped again once it is built.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Only the manifests first, so a source edit does not reinstall the world.
COPY package.json package-lock.json ./
COPY packages/gamedata/package.json ./packages/gamedata/
COPY packages/rules/package.json ./packages/rules/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/admin/package.json ./apps/admin/

RUN npm install --workspaces --include-workspace-root

COPY . .

ENV NODE_ENV=development
EXPOSE 3001
CMD ["npx", "tsx", "apps/api/src/index.ts"]
