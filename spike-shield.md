# Spike Shield

Go viral without going down or going broke.

## Problem

Social media can send thousands of users to a new app overnight. Vibecoders can build and deploy apps with AI coding tools without knowing anything about infrastructure, so they don't know whether their app will survive a spike until it's too late.

When the spike comes, one of two things happens:

- The app goes down, and the users the buzz brought in are lost.
- The bill explodes because of usage-based pricing.

## User

Vibecoders who build on Supabase with AI coding tools (Cursor, Claude Code, Bolt and similar). They aren't infrastructure experts, they ship fast, and they fix problems by prompting AI.

## Solution

One product, one journey:

1. Check: paste the app URL. We simulate a traffic spike and show a readiness score, the breaking point ("breaks at about 80 users") and a cost estimate.
2. Fix: every problem comes with a prompt to paste into their AI coding tool.
3. Protect: turn on the Shield, which is installed by pasting one prompt into their AI coding tool.
   - Queue: when traffic exceeds what the app can handle, extra visitors see a waiting page and are let in gradually.
   - Email capture: the waiting page asks for an email, so visitors who would have left join a waitlist.
   - Budget guard: near a spending limit, costly actions such as AI calls are slowed down instead of running up the bill.
4. Re-check: run the check again and see the score improve.

## Business

- The check is free and the score is shareable, which brings in users.
- The Shield is a paid subscription: a small monthly cost against a crash or a huge bill.
- Load-testing tools (k6, Loader.io) are built for engineers, and waiting rooms (Cloudflare, Queue-it) are priced and built for enterprises. Nothing serves one-person vibe-coded apps.

## Hackathon scope (1 day, 2 people)

- Build the Spike Test Service and the Fake App as Vite + React apps with an AI coding agent (Claude Code or Cursor) and deploy them to Vercel. The Backend runs on its own server.
- Demo on our own Fake App: check (bad score), turn on Shield, spike again (queue works, app stays up), re-check (good score).
- The cost estimate and budget guard can be simplified for the demo.

## Architecture

```
 Vercel (teammate)                       Vercel (you)
┌────────────────┐                 ┌──────────────────────────┐
│   Fake App     │── URL ────────▶ │ Spike Test Service       │
│  (+ Shield)    │                 │  - URL input             │
└───────┬────────┘                 │  - Dashboard             │
        │                          └────┬───────────────▲─────┘
        ▼                               │ start job     │ read results
 ┌──────────────┐   spike requests ┌────▼─────┐   ┌─────┴────────┐
 │ Supabase     │◀─────────────────│ Backend  │──▶│ Supabase     │
 │ (Target DB)  │                  │ (own     │   │ (Results DB) │
 └──────────────┘                  │ server)  │   └──────────────┘
                                   └──────────┘
```

- Fake App and Spike Test Service are separate Vercel projects, one per teammate.
- The spike hits the Target DB, not the Fake App page. The page is static on a CDN and won't break. The Backend reads the Supabase URL and anon key from the Fake App's JS bundle and sends the same calls the app makes.
- The Backend runs on its own server because a spike run takes minutes and sends many parallel requests, which doesn't fit serverless functions. Any language that can send many requests in parallel works.
- The Spike Test Service only starts a job. The Backend writes progress and results to the Results DB, and the Dashboard reads them from there.
- The Shield (queue and waiting page) lives in the Fake App and its Target DB.

## Risks

- A tool that sends heavy traffic to any URL could be misused as an attack. The real product needs an ownership check. At the hackathon we only test our own app.
- From a URL alone we can't check pages behind login, and costs are estimates.

## Why Supabase apps only

- Vibe-coded apps on Supabase share the same setup (static frontend + Supabase), so a URL is enough for an accurate check, and the fix prompts can be specific.
- Most AI coding tools default to Supabase as the backend, so this covers a large part of the hackathon audience.
- Trade-off: apps on other backends are out of scope at first.
- Expansion: other backends (Firebase, a custom API) next, then any vibe-coded app by connecting the GitHub repo.
