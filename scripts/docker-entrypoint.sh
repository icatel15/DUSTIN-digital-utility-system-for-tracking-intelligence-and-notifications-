#!/bin/bash
set -euo pipefail

echo "[dustin] Starting bootstrap..."

# Restore default phantom-config if volume is empty (first run)
if [ ! -f /app/phantom-config/constitution.md ]; then
  echo "[dustin] First run - copying default phantom-config..."
  cp -r /app/phantom-config-defaults/* /app/phantom-config/ 2>/dev/null || true
fi

# 1. Check Qdrant Cloud connectivity (up to 30 seconds)
QDRANT_URL="${QDRANT_URL:-}"
if [ -n "$QDRANT_URL" ]; then
  echo "[dustin] Checking Qdrant Cloud at ${QDRANT_URL}..."
  QDRANT_READY=false
  QDRANT_HEADERS=""
  if [ -n "${QDRANT_API_KEY:-}" ]; then
    QDRANT_HEADERS="-H api-key:${QDRANT_API_KEY}"
  fi
  for i in $(seq 1 30); do
    if curl -sf ${QDRANT_HEADERS} "${QDRANT_URL}/" > /dev/null 2>&1; then
      QDRANT_READY=true
      echo "[dustin] Qdrant Cloud is reachable"
      break
    fi
    sleep 1
  done
  if [ "$QDRANT_READY" = false ]; then
    echo "[dustin] WARNING: Qdrant Cloud not reachable after 30s. Starting in degraded mode."
  fi
else
  echo "[dustin] WARNING: QDRANT_URL not set. Memory system will be unavailable."
fi

# 2. Check OpenAI API key
if [ -n "${OPENAI_API_KEY:-}" ]; then
  echo "[dustin] OpenAI API key configured"
else
  echo "[dustin] WARNING: OPENAI_API_KEY not set. Embeddings will be unavailable."
fi

# 3. Run phantom init if config does not exist (first run)
if [ ! -f /app/config/phantom.yaml ]; then
  echo "[dustin] First run detected. Initializing configuration..."
  bun run src/cli/main.ts init --yes
  echo "[dustin] Configuration initialized"
else
  echo "[dustin] Configuration exists, skipping init"
fi

# 4. Set Docker awareness flag
export PHANTOM_DOCKER=true

# 5. Start DUSTIN (exec replaces shell so signals reach Bun directly)
echo "[dustin] Starting DUSTIN..."
exec bun run src/index.ts
