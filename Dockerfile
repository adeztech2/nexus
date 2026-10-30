FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

RUN mkdir -p /app/session && chmod -R 777 /app/session

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "--max-old-space-size=400", "index.js"]
