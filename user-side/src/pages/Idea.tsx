import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Post } from "../types";

export default function Idea() {
  const { id } = useParams();
  const postId = Number(id);
  const [post, setPost] = useState<Post | null>(null);
  const [votes, setVotes] = useState<number | null>(null);
  const [roast, setRoast] = useState<string | null>(null);
  const [roasting, setRoasting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("posts")
      .select("*, author:profiles(*)")
      .eq("id", postId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setPost(data as Post);
      });
    supabase
      .from("votes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId)
      .then(({ count }) => {
        if (!cancelled) setVotes(count ?? 0);
      });
    // fix/ai: show the saved roast if this idea was roasted before.
    supabase
      .from("roasts")
      .select("roast")
      .eq("post_id", postId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setRoast(data?.roast ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  // fix/ai: ai-summary is called only here, on click. It saves the result in the roasts table,
  // so the next call for this idea returns the saved roast without the AI latency.
  async function roastIt() {
    setRoasting(true);
    const { data, error } = await supabase.functions.invoke("ai-summary", {
      body: { post_id: postId },
    });
    setRoast(error ? "The roaster is busy. Try again later." : (data?.roast ?? null));
    setRoasting(false);
  }

  if (error) return <p className="error">Could not load this idea: {error}</p>;
  if (!post) return <p className="muted">Loading…</p>;

  return (
    <article className="card">
      <Link to="/" className="muted">
        ← Back to the feed
      </Link>
      <h2>{post.title}</h2>
      <p className="muted">
        by {post.author?.username ?? "anonymous"} · {new Date(post.created_at).toLocaleString()} ·
        ▲ {votes ?? "–"} votes
      </p>
      <p className="body">{post.body}</p>
      {roast ? (
        <blockquote className="roast">{roast}</blockquote>
      ) : (
        <button onClick={roastIt} disabled={roasting}>
          {roasting ? "Roasting…" : "Roast this idea"}
        </button>
      )}
    </article>
  );
}
