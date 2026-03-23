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

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/index.js"]
