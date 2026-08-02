# Playwright-Image bringt Chromium + alle System-Dependencies mit
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV NODE_ENV=production
CMD ["node", "src/server.js"]
