#!/bin/bash
echo "=== tools.ts check ==="
echo "Lines: $(wc -l < ~/claude-app/lib/tools.ts)"
echo "additionalProperties count: $(grep -c 'additionalProperties' ~/claude-app/lib/tools.ts)"
echo "as const count: $(grep -c 'as const' ~/claude-app/lib/tools.ts)"
echo "query_airbyte in tools: $(grep -c 'query_airbyte' ~/claude-app/lib/tools.ts)"
echo ""
echo "=== Last 5 lines of tools array ==="
grep -n "additionalProperties\|required:\|query_airbyte" ~/claude-app/lib/tools.ts | tail -10
echo ""
echo "=== Running server ==="
lsof -i :3001 | grep LISTEN
