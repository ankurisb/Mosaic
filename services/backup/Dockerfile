FROM alpine:3.19

# Install bash and docker CLI (for volume access)
RUN apk add --no-cache bash curl

# Backup script
COPY backup-cron.sh /usr/local/bin/backup-cron.sh
RUN chmod +x /usr/local/bin/backup-cron.sh

# State file for status API
RUN mkdir -p /backup-status

CMD ["/usr/local/bin/backup-cron.sh"]
