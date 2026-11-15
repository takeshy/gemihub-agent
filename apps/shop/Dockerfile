FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/shop/package.json apps/shop/package.json
RUN npm ci --ignore-scripts
COPY apps/shop apps/shop
RUN npm run build:shop
USER node
WORKDIR /app/apps/shop
ENV NODE_ENV=production PORT=3000 CHROMIUM=/usr/bin/chromium
EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "--import", "tsx", "server/index.ts"]
