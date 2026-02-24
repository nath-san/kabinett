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
# Create minimal fallback DB
RUN apt-get update -qq && apt-get install -y -qq sqlite3 > /dev/null 2>&1 && \
    sqlite3 /app/test-kabinett.db "CREATE TABLE museums(id TEXT PRIMARY KEY,name TEXT,enabled INTEGER DEFAULT 1,description TEXT,url TEXT); CREATE TABLE artworks(id INTEGER PRIMARY KEY,title_sv TEXT,title_en TEXT,source TEXT,category TEXT,technique_material TEXT,artists TEXT,dating_text TEXT,year_start INTEGER,acquisition_year INTEGER,iiif_url TEXT,dominant_color TEXT,color_r INTEGER,color_g INTEGER,color_b INTEGER,sub_museum TEXT,inventory_number TEXT,year_end INTEGER,description TEXT); CREATE TABLE clip_embeddings(artwork_id INTEGER PRIMARY KEY,embedding BLOB); CREATE TABLE broken_images(artwork_id INTEGER PRIMARY KEY);" && \
    apt-get remove -y sqlite3 && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

ENV DATABASE_PATH=/data/kabinett.db
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
