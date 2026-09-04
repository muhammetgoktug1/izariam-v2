# Build context is v2/.
#
# Vite dev server for the staff panel. Unlike apps/web it serves none of the
# legacy artwork, so nothing outside this context has to be mounted.
FROM node:22-bookworm-slim

WORKDIR /app

# argon2 is a native addon and @izariam/db now depends on it, so the workspace
# install needs a toolchain here as well.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

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

EXPOSE 5174
# VITE_HOST from compose binds it to 0.0.0.0 inside the container.
CMD ["npm", "run", "-w", "@izariam/admin", "dev"]
