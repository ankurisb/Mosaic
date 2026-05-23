#!/usr/bin/env sh
# Run DB migration first, then start the server.
# Migration is idempotent — safe to run on every boot.
set -e
echo "Running OpenMeter DB migration..."
/usr/local/bin/openmeter-jobs migrate up --config /etc/openmeter/config.yaml
echo "Migration complete. Starting OpenMeter server..."
exec /usr/local/bin/openmeter --config /etc/openmeter/config.yaml
