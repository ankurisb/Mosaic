FROM alpine:3.19

# bash + curl for the script; python3 for JSON config parsing; postgresql-client
# provides pg_dump for Postgres deployments (no-op path for SQLite installs).
# NOTE: pin postgresql-client major version to match the server (PG 15) so the
# dump format is compatible; alpine 3.19 ships postgresql15-client.
RUN apk add --no-cache bash curl python3 postgresql15-client

# Backup script
COPY backup-cron.sh /usr/local/bin/backup-cron.sh
RUN chmod +x /usr/local/bin/backup-cron.sh

# State file for status API
RUN mkdir -p /backup-status

CMD ["/usr/local/bin/backup-cron.sh"]
