FROM node:20-alpine
# Install docker CLI so we can inspect container state
RUN apk add --no-cache docker-cli curl
WORKDIR /app
COPY package.json .
COPY server.js .
EXPOSE 3099
CMD ["node", "server.js"]
