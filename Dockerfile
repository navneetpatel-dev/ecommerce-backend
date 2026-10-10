# One image, three roles (picked by the ECS task definition's command):
#   API     : node dist/src/server.js          (default CMD)
#   Worker  : node dist/src/worker.js
#   Migrate : npx sequelize-cli db:migrate
#
# Debian slim rather than Alpine: bcrypt ships glibc prebuilds, so no compiler
# toolchain is needed at install time.

ARG NODE_VERSION=22

# ---- deps: full install (dev deps needed for tsc) --------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- build: compile TypeScript ---------------------------------------------
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY database ./database
RUN npm run build

# ---- prod-deps: runtime dependencies only ----------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

# ---- runtime ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=9000
WORKDIR /app

# tini reaps zombies and forwards SIGTERM so ECS drains connections cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node package.json package-lock.json .sequelizerc ./
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
# Plain-JS migrations, seeders and sequelize-cli config (not compiled by tsc).
COPY --chown=node:node database/config ./database/config
COPY --chown=node:node database/migrations ./database/migrations
COPY --chown=node:node database/seeders ./database/seeders
COPY --chown=node:node database/seedGuard.js ./database/seedGuard.js

# The logger also writes rotating files under ./logs; CloudWatch gets stdout.
RUN mkdir -p logs && chown node:node logs

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

USER node
EXPOSE 9000

# No image-level HEALTHCHECK: the same image runs the worker, which serves no
# HTTP. The API's check lives in its ECS task definition (/health/live).

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/server.js"]
