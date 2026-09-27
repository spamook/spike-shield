#!/usr/bin/env bash
# Starts the whole demo with one command: Supabase + caps + Shield + Fake App on :4173/:4174
# (user-side/scripts/start.sh), then the rush tester and its dashboard on :8080.
# Run from anywhere: ./demo.sh   (Git Bash on Windows works). Ctrl+C stops everything.
# Prerequisites: Node 20+, Docker Desktop running.
set -euo pipefail
cd "$(dirname "$0")"

trap 'kill 0' EXIT

./user-side/scripts/start.sh &

echo "Waiting for the Fake App (:4173, :4174) and the Shield (:8090)..."
for url in http://localhost:4173 http://localhost:4174 "http://localhost:8090/shield/stats?siteId=idea-roaster"; do
  until curl -sf -o /dev/null "$url"; do sleep 2; done
done

(cd tester && npm install && npx playwright install chromium)

echo
echo "Dashboard: http://localhost:8080"
echo
(cd tester && npm start)
