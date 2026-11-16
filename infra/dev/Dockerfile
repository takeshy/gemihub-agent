FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/shop/package.json apps/shop/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:shop && npm run build:admin

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production CHROMIUM=/usr/bin/chromium
CMD ["node", "admin/server.mjs", "--production"]
