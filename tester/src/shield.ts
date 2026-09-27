// Polls the Shield's stats endpoint. See "HTTP API and WebSocket" in tester-work.md
// and "Shield stats and config" in team-plan.md (section 8) for the shape.

// team-plan.md only documents this endpoint's response informally as an example
// object ({ enabled, threshold, active, queued }); it isn't given a named type there,
// so this is typed loosely (all fields as team-plan.md's example shows them) rather
// than pulled from a shared contract.
export interface ShieldStats {
  enabled: boolean;
  threshold: number;
  active: number;
  queued: number;
}

const SHIELD_URL = process.env.SHIELD_URL ?? "http://localhost:8090";
const SITE_ID = "idea-roaster";
const TIMEOUT_MS = 500;

/** GET /shield/stats?siteId=idea-roaster. Returns null if the Shield is down or slow. */
export async function fetchShieldStats(): Promise<ShieldStats | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SHIELD_URL}/shield/stats?siteId=${encodeURIComponent(SITE_ID)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as ShieldStats;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
