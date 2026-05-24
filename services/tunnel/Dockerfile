FROM alpine:3.19

# Install cloudflared
RUN apk add --no-cache curl ca-certificates && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ]; then CF_ARCH="arm64"; else CF_ARCH="amd64"; fi && \
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
      -o /usr/local/bin/cloudflared && \
    chmod +x /usr/local/bin/cloudflared

# Install Node for the management API
RUN apk add --no-cache nodejs

WORKDIR /app
COPY manager.js .
EXPOSE 3100
CMD ["node", "manager.js"]
