// ai-summary: simulates an LLM call, so load tests cost nothing.
// POST { "post_id": 123 } -> { "roast": "...", "cached": bool }
//
// fix/ai: each idea is roasted only once. The result is stored in the roasts table (written here
// with the service role key, read by the app), and a cached roast is returned without the
// simulated LLM latency.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let post_id = NaN;
  try {
    post_id = Number((await req.json()).post_id);
  } catch {
    // handled below
  }
  if (!Number.isInteger(post_id) || post_id <= 0) return json({ error: "post_id required" }, 400);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: cached } = await db.from("roasts").select("roast").eq("post_id", post_id).maybeSingle();
  if (cached) return json({ roast: cached.roast, cached: true });

  await new Promise((r) => setTimeout(r, 2000)); // simulated LLM latency
  const roast = `Idea #${post_id}: bold, but who pays for it?`;

  // ignoreDuplicates: if two visitors roast the same idea at once, the first write wins.
  const { error } = await db
    .from("roasts")
    .upsert({ post_id, roast }, { onConflict: "post_id", ignoreDuplicates: true });
  if (error) console.error("roasts insert failed:", error.message);

  return json({ roast, cached: false });
});
