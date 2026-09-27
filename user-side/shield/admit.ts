// Admit logic, all in memory. Rules from team-plan.md:
// - Shield disabled for this site -> admitted.
// - Known active session -> update last seen, admitted.
// - Active count + queued visitors ahead of this one < threshold -> mark active, admitted.
// - Otherwise -> queued, with position. First come, first served.
// - Sessions not seen for 30 seconds are dropped (heartbeat every 10 s keeps a slot).

type Session = { status: "active" | "queued"; firstSeen: number; lastSeen: number; email?: string };

type Site = {
  enabled: boolean;
  threshold: number;
  sessions: Map<string, Session>; // insertion order = arrival order
  notices: string[]; // "you're in" emails we would send
};

const TTL_MS = 30_000;
export const sites = new Map<string, Site>();

export function getSite(id: string): Site {
  let site = sites.get(id);
  if (!site) {
    // Starts enabled with the threshold from THRESHOLD (default 10), as start.sh expects.
    site = { enabled: true, threshold: Number(process.env.THRESHOLD ?? 10), sessions: new Map(), notices: [] };
    sites.set(id, site);
  }
  return site;
}

function dropExpired(site: Site, now: number) {
  for (const [id, s] of site.sessions) {
    if (now - s.lastSeen > TTL_MS) site.sessions.delete(id);
  }
}

export function admit(siteId: string, sessionId: string, now = Date.now()) {
  const site = getSite(siteId);
  if (!site.enabled) return { status: "admitted" as const };

  dropExpired(site, now);

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
    if (s.email) site.notices.push(`You're in: ${s.email}`);
    return { status: "admitted" as const };
  }
  return { status: "queued" as const, position: ahead + 1 };
}

// The visitor closed the page: free its slot or place in line at once, not after the TTL.
export function leave(siteId: string, sessionId: string) {
  getSite(siteId).sessions.delete(sessionId);
}

export function saveEmail(siteId: string, sessionId: string, email: string) {
  const s = getSite(siteId).sessions.get(sessionId);
  if (s) s.email = email;
}

export function configure(siteId: string, enabled: boolean, threshold: number) {
  const site = getSite(siteId);
  site.enabled = enabled;
  site.threshold = threshold;
}

export function stats(siteId: string) {
  const site = getSite(siteId);
  dropExpired(site, Date.now()); // don't count visitors who stopped sending heartbeats
  let active = 0,
    queued = 0,
    emails = 0;
  for (const s of site.sessions.values()) {
    if (s.status === "active") active++;
    else queued++;
    if (s.email) emails++;
  }
  return {
    enabled: site.enabled,
    threshold: site.threshold,
    active,
    queued,
    emails,
    notices: site.notices.slice(-10),
  };
}
