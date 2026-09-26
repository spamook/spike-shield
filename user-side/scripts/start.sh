#!/usr/bin/env bash
# Starts the Target side on one laptop: local Supabase (Docker) + resource caps + Fake App on :4173.
# Run from the repo root: ./user-side/scripts/start.sh   (Git Bash on Windows works)
# Prerequisites: Node 20+, Docker Desktop running. The Supabase CLI comes from node_modules if
# it is not installed globally.
set -euo pipefail
cd "$(dirname "$0")/.."    # user-side/

npm install

if command -v supabase >/dev/null 2>&1; then SUPABASE=supabase; else SUPABASE="npx supabase"; fi

$SUPABASE start
$SUPABASE db reset         # schema + seed (100k posts, 500k votes), takes a minute or two
./scripts/cap.sh           # resource caps, reset on every restart

# Write .env from the running instance. Local Supabase uses the same default anon key on every
# machine, so the committed .env already matches; this keeps it right if the CLI ever changes it.
ANON_KEY=$($SUPABASE status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p' || true)
if [ -n "${ANON_KEY:-}" ]; then
  printf 'VITE_SUPABASE_URL=http://localhost:54321\nVITE_SUPABASE_ANON_KEY=%s\n' "$ANON_KEY" > .env
fi

echo
echo "Fake App:        http://localhost:4173"
echo "Supabase API:    http://localhost:54321"
echo "Supabase Studio: http://localhost:54323"
echo

npm run build
npx vite preview --port 4173 --strictPort
