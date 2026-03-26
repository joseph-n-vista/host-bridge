# GDAL + Node for gdalwarp / gdal2tiles + Supabase uploads
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    python3-gdal \
    unzip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
# Optional neat-line crops: mount shapefiles and set CHART_CUTLINES_DIR at runtime (see repo cutlines/README.md).
# Not bundled—closed-source apps should use your own geometry or licensed data.

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/index.js"]
