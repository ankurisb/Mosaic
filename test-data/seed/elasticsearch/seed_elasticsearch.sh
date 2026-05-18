#!/bin/sh
# seed_elasticsearch.sh
# Waits for Elasticsearch, creates indices, bulk-loads documents.
# Runs inside Docker — paths are /seed/...

ES_URL="${ES_URL:-http://elasticsearch:9200}"
SEED_DIR="/seed"

echo "[seed] Waiting for Elasticsearch at $ES_URL..."
until curl -sf "$ES_URL/_cluster/health?wait_for_status=yellow&timeout=30s" > /dev/null 2>&1; do
  sleep 3
done
echo "[seed] Elasticsearch is ready."

for idx in maintenance_logs alarm_events quality_events operator_logbook; do
  # Delete if exists (idempotent)
  curl -sf -X DELETE "$ES_URL/$idx" > /dev/null 2>&1 || true
  # Create with mapping
  curl -sf -X PUT "$ES_URL/$idx" \
    -H "Content-Type: application/json" \
    --data-binary @"$SEED_DIR/mappings/${idx}.json" > /dev/null
  echo "[seed] Created index: $idx"
  # Bulk load
  curl -sf -X POST "$ES_URL/$idx/_bulk" \
    -H "Content-Type: application/x-ndjson" \
    --data-binary @"$SEED_DIR/data/${idx}.ndjson" > /dev/null
  # Refresh and count
  curl -sf -X POST "$ES_URL/$idx/_refresh" > /dev/null 2>&1
  count=$(curl -sf "$ES_URL/$idx/_count" | grep -o '"count":[0-9]*' | cut -d: -f2)
  echo "[seed] Loaded $idx: ${count:-0} documents"
done

echo "[seed] Elasticsearch seed complete."
echo "[seed] Summary:"
curl -sf "$ES_URL/_cat/indices?v&h=index,docs.count,store.size" 2>/dev/null
