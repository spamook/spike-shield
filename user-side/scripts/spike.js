// Quick load test with k6 (https://k6.io), used to tune the resource caps before the Tester side
// is ready. Replays the feed journey without the Shield.
//
//   k6 run -e URL=http://localhost:54321 -e KEY=<anon key> user-side/scripts/spike.js
//
// Expected with the caps from cap.sh: errors (5xx, timeouts) and p95 of several seconds at the
// target load. If it does not break under ~150 users, tighten cap.sh first.
import http from "k6/http";

export const options = {
  stages: [
    { duration: "20s", target: 150 },
    { duration: "30s", target: 150 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"], // the check calls it broken above 5% errors
    http_req_duration: ["p(95)<3000"], // or p95 above 3 seconds
  },
};

export default function () {
  const h = { headers: { apikey: __ENV.KEY, Authorization: `Bearer ${__ENV.KEY}` } };

  // 1. Heavy feed query
  const feed = http.get(
    `${__ENV.URL}/rest/v1/posts?select=*,author:profiles(*)&order=created_at.desc&limit=200`,
    h,
  );

  // 2. N+1 vote counts for the first 20 posts
  const posts = feed.status === 200 ? feed.json().slice(0, 20) : [];
  for (const p of posts) {
    http.head(`${__ENV.URL}/rest/v1/votes?select=*&post_id=eq.${p.id}`, {
      headers: { ...h.headers, Prefer: "count=exact" },
    });
  }

  // 3. AI call on every page load
  http.post(`${__ENV.URL}/functions/v1/ai-summary`, JSON.stringify({ post_id: 1 }), {
    headers: { ...h.headers, "Content-Type": "application/json" },
  });
}
