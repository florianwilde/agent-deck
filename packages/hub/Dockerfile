# syntax=docker/dockerfile:1
# Build-Kontext ist das Repo-Root (siehe docker-compose.yml).

FROM node:24-bookworm-slim AS build
# Für better-sqlite3, falls kein passendes Prebuild geladen werden kann.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/hub/package.json packages/hub/
RUN pnpm install --frozen-lockfile --filter @agent-deck/hub...
COPY packages/hub packages/hub
RUN pnpm --filter @agent-deck/hub build \
  && pnpm --filter @agent-deck/hub deploy --prod --legacy /out \
  && cp -r packages/hub/dist /out/dist

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
  HUB_HOST=0.0.0.0 \
  HUB_PORT=8787 \
  HUB_DB_PATH=/data/agent-deck.db
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.HUB_PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
