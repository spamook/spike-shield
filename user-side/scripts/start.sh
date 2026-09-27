#!/usr/bin/env bash
# Starts the Target side on one laptop: local Supabase (Docker) + resource caps + Shield service
# on :8090 + the Fake App twice, without the Shield on :4173 and with it on :4174.
# Run from the repo root: ./user-side/scripts/start.sh   (Git Bash on Windows works)
# Prerequisites: Node 20+, Docker Desktop running. The Supabase CLI comes from node_modules if
# it is not installed globally. Ctrl+C stops the app servers and the Shield service.
set -euo pipefail
cd "$(dirname "$0")/.."    # user-side/

npm install

if command -v supabase >/dev/null 2>&1; then SUPABASE=supabase; else SUPABASE="npx supabase"; fi

$SUPABASE start
# After Docker restarts, containers with restart policy "no" (edge_runtime) stay stopped, and
# `supabase start` sees the stack as running and leaves them. Start any stopped ones.
STOPPED=$(docker ps -a --filter "name=^supabase_.*_user-side$" --filter status=exited --filter status=created --format '{{.Names}}')
if [ -n "$STOPPED" ]; then
  echo "Starting stopped Supabase containers: $STOPPED"
  docker start $STOPPED >/dev/null
fi
$SUPABASE db reset         # schema + seed (100k posts, 500k votes), takes a minute or two
./scripts/cap.sh           # resource caps, reset on every restart

# Write .env from the running instance. Local Supabase uses the same default anon key on every
# machine, so the committed .env already matches; this keeps it right if the CLI ever changes it.
ANON_KEY=$($SUPABASE status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p' || true)
if [ -n "${ANON_KEY:-}" ]; then
  printf 'VITE_SUPABASE_URL=http://localhost:54321\nVITE_SUPABASE_ANON_KEY=%s\n' "$ANON_KEY" > .env
fi

# Shield service (shield.js, admit, leave, config, stats) on :8090, in the background.
# Starts enabled with the threshold from THRESHOLD (default 10).
(cd shield && npm install && THRESHOLD="${THRESHOLD:-10}" npm start) &
trap 'kill 0' EXIT

# Two builds from the same code: the script tag is added only with SHIELD=1.
npm run build -- --outDir dist-plain
SHIELD=1 npm run build -- --outDir dist-shield

echo
echo "Fake App without the Shield: http://localhost:4173"
echo "Fake App with the Shield:    http://localhost:4174"
echo "Shield service:              http://localhost:8090"
echo "Supabase API:                http://localhost:54321"
echo "Supabase Studio:             http://localhost:54323"
echo

npx vite preview --outDir dist-plain --port 4173 --strictPort &
npx vite preview --outDir dist-shield --port 4174 --strictPort
