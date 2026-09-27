// CLI entry for Build order step 1 ("Scale test first"): a fixed run, results printed to the console.
//
//   npx tsx src/scale.ts --url http://localhost:4173 --users 10 --ramp 20 --hold 60
//
// --ramp and --hold are in seconds. Defaults match the "Run" section of tester-work.md
// (users=60, ramp=20s, hold=60s) but pass small numbers while testing against a stub page.

import { createMetrics, p95 } from "./metrics.js";
import { runRun } from "./runner.js";

function parseArgs(argv: string[]): { url: string; users: number; ramp: number; hold: number } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return {
    url: args.url ?? "http://localhost:4173",
    users: Number(args.users ?? 60),
    ramp: Number(args.ramp ?? 20),
    hold: Number(args.hold ?? 60),
  };
}

async function main() {
  const { url, users, ramp, hold } = parseArgs(process.argv.slice(2));
  console.log(`scale test: url=${url} users=${users} ramp=${ramp}s hold=${hold}s`);

  const metrics = createMetrics();
  let lastPrintedSecond = -1;

  // The runner now holds its target indefinitely; this CLI stays a fixed-duration
  // test by aborting itself after ramp+hold, the same way the server's safety
  // timeout (MAX_RUN_S) does.
  const stopper = new AbortController();
  setTimeout(() => stopper.abort(), (ramp + hold) * 1000);

  const result = await runRun({
    url,
    users,
    rampMs: ramp * 1000,
    metrics,
    externalStop: stopper.signal,
    onTick(info) {
      const second = Math.floor(info.elapsedMs / 1000);
      if (second === lastPrintedSecond) return;
      lastPrintedSecond = second;
      const snap = metrics.snapshot();
      const v = snap.visitors;
      console.log(
        `t=${String(second).padStart(3, " ")}s  target=${String(info.target).padStart(2, " ")} active=${String(info.active).padStart(2, " ")}  ` +
          `visitors[loading=${v.loading} queued=${v.queued} ready=${v.ready} error=${v.error}]  ` +
          `requests[ok=${snap.requestsOk} failed=${snap.requestsFailed}]  started=${info.totalVisitors}`,
      );
    },
  });

  const snap = metrics.snapshot();
  const sawError = result.outcomes.filter((o) => o.error || o.timeout).length;
  const wasQueued = result.outcomes.filter((o) => o.queued).length;
  const gaveUp = result.outcomes.filter((o) => o.gaveUp).length;

  console.log("\n--- final totals ---");
  console.log(`visitors started : ${result.totalVisitors}`);
  console.log(`requests ok      : ${snap.requestsOk}`);
  console.log(`requests failed  : ${snap.requestsFailed}`);
  console.log(`p95 latency (ms) : ${p95(snap.latencies)}`);
  console.log(`saw error/timeout: ${sawError}`);
  console.log(`was queued       : ${wasQueued}`);
  console.log(`gave up          : ${gaveUp}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
