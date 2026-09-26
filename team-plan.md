# Spike Shield: Team Plan

How we split the work so both sides can build in parallel. See [spike-shield.md](spike-shield.md) for the product and architecture.

## Roles

| | Tester side (Koki) | Fake App side (Danila) |
|---|---|---|
| Vercel project | Spike Test Service | Fake App |
| Builds | URL input, Dashboard, Backend, Results DB | Fake App, Target DB, Shield |
| Demo role | Runs the check and shows the score | Turns on the Shield |

## Tester side

- Spike Test Service (Vite + React on Vercel): URL input page, Dashboard showing score, breaking point, cost estimate and fix prompts.
- Backend (own server), in three steps:
  1. Analyze and record: scan the JS bundle for every Supabase call the app can make (tables, RPCs, Edge Functions), then open the Fake App once in a headless browser (e.g. Playwright) and log the calls that actually run.
  2. Replay: send that journey as many virtual users over plain HTTP.
  3. Diagnose: errors and response times per call, so we can name the weak call (e.g. "`posts` query fails first at about 60 users").
- Results go to the Results DB.
- Results DB (Supabase of the Spike Test Service): jobs and results tables.
- Fix prompts: turn test results into prompts to paste into an AI coding agent. Can be fixed templates for the demo.

## Fake App side

- Fake App (Vite + React on Vercel): a simple app that breaks easily, e.g. a feed page that runs heavy queries on every load, plus one AI call.
- Target DB (its own Supabase project, so we can show errors live in the Supabase dashboard).
- Shield: the queue and waiting page with email capture, installed by one prompt. We keep that prompt as the demo script.

## What the Shield is

Not middleware. A static frontend with Supabase has no server of ours in front of the page, so the Shield is:

- A gate component in the app. On load it asks the admit function whether the visitor can enter. If not, it shows the waiting page and asks again every few seconds.
- An admit database function (`shield_admit`, called as RPC) in the Target DB that counts active visitors (a table with a heartbeat) and returns admitted or queued.

This is why it can be installed with one prompt. A real proxy in front of the app (e.g. a Cloudflare Worker) would need a custom domain and is out of scope.

Limit: the gate only stops visitors who come through the page. Someone calling Supabase directly skips it. Our test still goes through it, because the recorded journey includes the admit call.

## Contract between the two sides

Agree on these first, then build independently.

1. Fake App URL and its Supabase URL + anon key. Shared by hand at first; reading them from the JS bundle comes later.
2. Virtual user journey: recorded automatically from the page. The Fake App side writes down the calls the page should make, so the Tester side can check the recording and use it as a fallback, e.g.
   - `GET /rest/v1/posts?select=*,author:profiles(*)&order=created_at.desc&limit=200` (feed)
   - `HEAD /rest/v1/votes?post_id=eq.<id>` × 20 (vote counts)
   - `POST /functions/v1/ai-summary` (AI call)
3. Admit API (when the Shield is on):
   - `POST /rest/v1/rpc/shield_admit` with `{ "p_session": "<uuid>" }` → `{ "status": "admitted" | "queued", "position": 42 }`. Each virtual user uses its own uuid, and admitted users call it again every 10s as a heartbeat.
   - The replay must follow the response: admitted users run the rest of the journey, queued users wait and retry.
4. Shield on/off switch the Fake App side can flip during the demo.

## Demo script

1. Paste the Fake App URL, run the check: bad score, "breaks at about N users".
2. Show the fix prompts.
3. Turn on the Shield by pasting one prompt into the AI coding agent.
4. Spike again: waiting page appears, app stays up, emails captured.
5. Re-check: good score.
