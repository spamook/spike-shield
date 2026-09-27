// ai-summary: simulates an LLM call, so load tests cost nothing.
// POST { "post_id": 123 } -> { "roast": "..." } after ~2 s of simulated latency.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let post_id: unknown = null;
  try {
    ({ post_id } = await req.json());
  } catch {
    // no or invalid body: roast nothing in particular
  }

  await new Promise((r) => setTimeout(r, 2000)); // simulated LLM latency

  return new Response(
    JSON.stringify({ roast: `Idea #${post_id ?? "?"}: bold, but who pays for it?` }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
