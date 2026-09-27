// Admit logic, all in memory. Rules from team-plan.md:
// - Shield disabled for this site -> admitted.
// - Known active session -> update last seen, admitted.
// - Active count + queued visitors ahead of this one < threshold -> mark active, admitted.
// - Otherwise -> queued, with position. First come, first served.
// - Sessions not seen for 30 seconds are dropped (heartbeat every 10 s keeps a slot);
//   a visitor who closes the page sends "leave" and is dropped at once.
// A site starts enabled with the threshold from the THRESHOLD env var (default 10): only the
// :4174 build loads shield.js, so the Shield can stay on all the time.

type Session = { status: "active" | "queued"; firstSeen: number; lastSeen: number };

type Site = {
  enabled: boolean;
  threshold: number;
  sessions: Map<string, Session>; // insertion order = arrival order
};

const TTL_MS = 30_000;
export const DEFAULT_THRESHOLD = Number(process.env.THRESHOLD ?? 10);
export const sites = new Map<string, Site>();

export function getSite(id: string): Site {
  let site = sites.get(id);
  if (!site) {
    site = { enabled: true, threshold: DEFAULT_THRESHOLD, sessions: new Map() };
    sites.set(id, site);
  }
  return site;
}

export function admit(siteId: string, sessionId: string, now = Date.now()) {
  const site = getSite(siteId);
  if (!site.enabled) return { status: "admitted" as const };

  for (const [id, s] of site.sessions) {
    if (now - s.lastSeen > TTL_MS) site.sessions.delete(id);
  }

  let s = site.sessions.get(sessionId);
  if (!s) {
    s = { status: "queued", firstSeen: now, lastSeen: now };
    site.sessions.set(sessionId, s);
  }
  s.lastSeen = now;
  if (s.status === "active") return { status: "admitted" as const };

  let active = 0;
  let ahead = 0;
  for (const o of site.sessions.values()) {
    if (o.status === "active") active++;
    else if (o.firstSeen < s.firstSeen) ahead++;
  }

  // first come, first served: free slots must cover everyone ahead
  if (active + ahead < site.threshold) {
    s.status = "active";
    return { status: "admitted" as const };
  }
  return { status: "queued" as const, position: ahead + 1 };
}

export function leave(siteId: string, sessionId: string) {
  getSite(siteId).sessions.delete(sessionId);
}

export function configure(siteId: string, enabled: boolean, threshold: number) {
  const site = getSite(siteId);
  site.enabled = enabled;
  site.threshold = threshold;
}

export function stats(siteId: string) {
  const site = getSite(siteId);
  let active = 0,
    queued = 0;
  for (const s of site.sessions.values()) {
    if (s.status === "active") active++;
    else queued++;
  }
  return { enabled: site.enabled, threshold: site.threshold, active, queued };
}
