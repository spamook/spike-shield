// ai-summary: simulates an LLM call, so load tests cost nothing.
// POST { "post_id": 123, "title": "DogTranslate" } -> { "roast": "..." } after ~2 s of simulated latency.
// title is optional; without it the roast says "Idea #<post_id>".

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const roasts = [
  (name: string) => `${name}? Bold. But who pays for it?`,
  (name: string) => `${name}: love the energy, hate the unit economics.`,
  (name: string) => `${name} sounds like a feature, not a company. Prove me wrong.`,
  (name: string) => `${name}: great idea, terrible timing. Or the other way round.`,
  (name: string) => `${name} is what happens when a pitch deck meets too much coffee.`,
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let post_id: unknown = null;
  let title: unknown = null;
  try {
    ({ post_id, title } = await req.json());
  } catch {
    // no or invalid body: roast nothing in particular
  }

  await new Promise((r) => setTimeout(r, 2000)); // simulated LLM latency

  const id = Number(post_id);
  const name = typeof title === "string" && title.trim() ? title.trim() : `Idea #${Number.isFinite(id) ? id : "?"}`;
  const roast = roasts[Number.isFinite(id) ? Math.abs(id) % roasts.length : 0](name);

  return new Response(JSON.stringify({ roast }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
