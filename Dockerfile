FROM node:22-slim AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/data/package.json packages/data/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/web/ apps/web/
COPY packages/data/scripts/ packages/data/scripts/
COPY packages/data/src/ packages/data/src/ 

# Build
RUN pnpm --filter web build

# Production stage
FROM node:22-slim AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=base /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=base /app/apps/web/package.json apps/web/
COPY --from=base /app/packages/data/package.json packages/data/

RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/apps/web/build apps/web/build
COPY --from=base /app/apps/web/public apps/web/public

# DB will be mounted as a volume at /data/kabinett.db
ENV DATABASE_PATH=/data/kabinett.db
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "apps/web/build/server/index.js"]
