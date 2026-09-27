// One virtual visitor in its own browser context. See "Virtual visitor" in tester-work.md.

import type { Browser, Page, Request } from "playwright";
import type { Metrics, PageState } from "./metrics.js";

const SUPABASE = "http://localhost:54321";

const OPEN_TIMEOUT_MS = 15_000; // page.goto timeout, and the "not ready within 15s" rule
const READY_TIMEOUT_MS = 15_000; // reach ready/error within 15s of opening the page / leaving the queue
// Each visitor stays after ready/error, and waits on the waiting page, for a random time in
// this range, so slots free up one by one instead of in batches.
const DWELL_MIN_MS = 2_000;
const DWELL_MAX_MS = 35_000;
const LEAVE_GRACE_MS = 1_000; // wait after about:blank so shield.js's leave beacon is sent
const POLL_MS = 500; // page state poll interval
const SUPABASE_NO_ANSWER_MS = 10_000; // a Supabase request with no answer after 10s counts as failed

let nextVisitorId = 0;

export interface VisitorOutcome {
  /** Saw the waiting page (#spike-shield) at least once. */
  queued: boolean;
  /** Left the waiting page without getting in (waited a random 2-35 s). */
  gaveUp: boolean;
  /** Page reached data-state="error". */
  error: boolean;
  /** Did not reach ready/error in time (page.goto timeout, or the 15s rule). */
  timeout: boolean;
}

function sleep(ms: number, stop: AbortSignal): Promise<void> {
  if (stop.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      stop.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    stop.addEventListener("abort", onAbort, { once: true });
  });
}

async function readState(page: Page): Promise<PageState> {
  try {
    return await page.evaluate(() => {
      if (document.getElementById("spike-shield")) return "queued";
      const s = document.body?.getAttribute("data-state");
      return s === "ready" || s === "error" ? s : "loading";
    }) as PageState;
  } catch {
    // page navigating / closing mid-poll: treat as still loading, caller's timers decide the outcome
    return "loading";
  }
}

export async function visit(browser: Browser, url: string, m: Metrics, stop: AbortSignal): Promise<VisitorOutcome> {
  const id = `v${nextVisitorId++}`;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route("**/*.{png,jpg,jpeg,svg,woff,woff2}", (r) => r.abort()); // save CPU

  const started = new Map<Request, number>();
  const pendingTimers = new Map<Request, ReturnType<typeof setTimeout>>();
  // Set when the run is stopped (Stop button or auto-stop) while this visitor is still open:
  // requests cut off by our own stop are dropped, not counted as failed.
  let cutByStop = false;

  page.on("request", (r) => {
    if (r.url().startsWith(SUPABASE)) {
      started.set(r, performance.now());
      // A Supabase request with no answer after 10s counts as failed (a real visitor has left).
      const timer = setTimeout(() => {
        if (started.has(r)) {
          started.delete(r);
          pendingTimers.delete(r);
          m.request(0, SUPABASE_NO_ANSWER_MS);
        }
      }, SUPABASE_NO_ANSWER_MS);
      pendingTimers.set(r, timer);
    }
  });
  page.on("requestfinished", async (r) => {
    const t0 = started.get(r);
    if (t0 === undefined) return;
    started.delete(r);
    clearTimeout(pendingTimers.get(r));
    pendingTimers.delete(r);
    const res = await r.response();
    m.request(res?.status() ?? 0, performance.now() - t0);
  });
  page.on("requestfailed", async (r) => {
    const t0 = started.get(r);
    if (t0 === undefined) return;
    started.delete(r);
    clearTimeout(pendingTimers.get(r));
    if (cutByStop) return;
    pendingTimers.delete(r);
    // Chromium reports HEAD requests (supabase-js count queries) as net::ERR_ABORTED after a
    // normal response arrived. Count by the response status when there was one.
    const res = await r.response().catch(() => null);
    m.request(res?.status() ?? 0, performance.now() - t0);
  });

  const outcome: VisitorOutcome = { queued: false, gaveUp: false, error: false, timeout: false };

  try {
    try {
      // "commit": count from when the page starts arriving, not its load event; the 15 s rule and
      // state polling below decide the outcome (the load event can stall on a busy laptop).
      await page.goto(url, { timeout: OPEN_TIMEOUT_MS, waitUntil: "commit" });
    } catch {
      outcome.timeout = true;
      m.affected(id);
      return outcome;
    }

    let readyDeadline = performance.now() + READY_TIMEOUT_MS;
    let inQueue = false;
    let queueDeadline = 0;
    // How long this visitor is willing to wait on the waiting page / stays on the app.
    const dwell = () => DWELL_MIN_MS + Math.random() * (DWELL_MAX_MS - DWELL_MIN_MS);

    while (!stop.aborted) {
      const snap = await readState(page);
      m.state(id, snap);

      if (snap === "queued") {
        if (!inQueue) {
          inQueue = true;
          outcome.queued = true;
          // wait a random 2-35 s, then give up if still not admitted
          queueDeadline = performance.now() + dwell();
        } else if (performance.now() > queueDeadline) {
          outcome.gaveUp = true;
          return outcome;
        }
      } else {
        if (inQueue) {
          // just admitted: the 15s "reach ready/error" clock restarts
          inQueue = false;
          readyDeadline = performance.now() + READY_TIMEOUT_MS;
        }

        if (snap === "ready" || snap === "error") {
          if (snap === "error") {
            outcome.error = true;
            m.affected(id);
          }
          await sleep(dwell(), stop); // read the page for a random 2-35 s
          return outcome;
        }

        // still "loading"
        if (performance.now() > readyDeadline) {
          outcome.timeout = true;
          m.affected(id);
          return outcome;
        }
      }

      await sleep(POLL_MS, stop);
    }

    return outcome; // run stopped while this visitor was still in progress
  } finally {
    m.state(id, null);
    cutByStop = stop.aborted;
    await page.goto("about:blank").catch(() => {}); // fires pagehide -> shield.js sends leave
    // Give the leave beacon time to go out: closing the context at once drops it under load,
    // and the Shield then keeps a ghost session for 30 s. A real closed tab still sends it.
    await page.waitForTimeout(LEAVE_GRACE_MS).catch(() => {});
    for (const t of pendingTimers.values()) clearTimeout(t);
    // still pending = failed, unless our own stop cut it off
    if (!cutByStop) for (const t0 of started.values()) m.request(0, performance.now() - t0);
    await ctx.close();
  }
}
