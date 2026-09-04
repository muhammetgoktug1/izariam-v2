# Build context is v2/.
#
# Vite dev server. The 34 MB sprite tree it serves lives outside this context
# (repo-root design/, next to the legacy PHP it belongs to) and is bind-mounted
# at /design by compose -- which is exactly where vite.config.ts resolves it to
# once the app sits at /app/apps/web.
FROM node:22-bookworm-slim

WORKDIR /app

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

EXPOSE 5175
# VITE_HOST from compose binds it to 0.0.0.0 inside the container.
CMD ["npm", "run", "-w", "@izariam/web", "dev"]
