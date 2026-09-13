# Mosaic Licensing Service — Dockerfile (Railway-ready)
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production
# Railway sets PORT; default 8080 for local
EXPOSE 8080
CMD ["node", "src/server.js"]
