import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { setPageState } from "../lib/pageState";
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
    setPageState("loading");
    supabase
      .from("posts")
      .select("*, author:profiles(*)")
      .eq("id", postId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(error.message);
          setPageState("error");
        } else {
          setPost(data as Post);
          setPageState("ready");
        }
      });
    supabase
      .from("votes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId)
      .then(({ count }) => {
        if (!cancelled) setVotes(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  async function roastIt() {
    setRoasting(true);
    const { data, error } = await supabase.functions.invoke("ai-summary", {
      body: { post_id: postId, title: post?.title },
    });
    setRoast(error ? "The roaster is busy. Try again later." : (data?.roast ?? null));
    setRoasting(false);
  }

  if (error) {
    return (
      <div className="error-banner" role="alert">
        <strong>Something went wrong.</strong> Could not load this idea. Please try again later.{" "}
        <span className="muted">({error})</span>
      </div>
    );
  }
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
      <button onClick={roastIt} disabled={roasting}>
        {roasting ? "Roasting…" : "Roast this idea"}
      </button>
      {roast && <blockquote className="roast">{roast}</blockquote>}
    </article>
  );
}
