#!/usr/bin/env bash
# Starts the Target side on one laptop: local Supabase (Docker) + resource caps + the Fake App
# served twice, without the Shield on :4173 and with it on :4174 (see "Two builds" in
# fakeapp-scripts-work.md). Run from the repo root: ./user-side/scripts/start.sh (Git Bash on
# Windows works). Prerequisites: Node 20+, Docker Desktop running. The Supabase CLI comes from
# node_modules if it is not installed globally.
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

# Shield service (shield.js, admit, waitlist, config, stats) on :8090, in the background, with
# the demo threshold (10). It stops together with this script.
(cd shield && npm install && THRESHOLD=10 npm start) &
trap 'kill 0' EXIT

echo
echo "Fake App (no Shield):   http://localhost:4173"
echo "Fake App (with Shield): http://localhost:4174"
echo "Shield service:         http://localhost:8090"
echo "Supabase API:           http://localhost:54321"
echo "Supabase Studio:        http://localhost:54323"
echo

# Two builds from the same code: the Shield script tag is only inserted when SHIELD=1.
npm run build -- --outDir dist-plain
SHIELD=1 npm run build -- --outDir dist-shield
npx vite preview --outDir dist-plain --port 4173 --strictPort &     # without the Shield
npx vite preview --outDir dist-shield --port 4174 --strictPort # with the Shield
