#!/usr/bin/env bash
# Docker resource caps so local Supabase breaks at a predictable point (aim: 80-150 users).
# A laptop is much stronger than a free-tier Supabase, and the load generator runs on the same
# laptop, so Supabase must break first. Caps reset whenever Supabase restarts; start.sh runs this
# after `supabase start`. Tune the numbers on the demo laptop with scripts/spike.js (k6) until the
# breaking point is stable across runs.
set -euo pipefail

PROJECT="${1:-user-side}"   # project_id from supabase/config.toml; container names end with it

cap() {  # cap <container prefix> <cpus> <memory>
  local name
  name=$(docker ps --format '{{.Names}}' | grep -m1 -x "$1_$PROJECT" || true)
  if [ -z "$name" ]; then
    echo "cap.sh: container $1_$PROJECT is not running, skipped"
    return
  fi
  docker update --cpus "$2" --memory "$3" --memory-swap "$3" "$name" >/dev/null
  echo "cap.sh: $name -> cpus=$2 memory=$3"
}

cap supabase_db           1    1g
cap supabase_rest         0.5  512m
cap supabase_edge_runtime 0.5  512m
