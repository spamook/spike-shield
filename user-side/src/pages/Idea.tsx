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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPageState("loading");
    setHasError(false);
    setLoadError(null);
    setPost(null);

    async function load() {
      let failed = false;
      // Show the error as soon as one call fails, not after all of them have settled: the tester
      // gives a page 15 s, and waiting for every call could take longer under load.
      const fail = () => {
        if (failed || cancelled) return;
        failed = true;
        setHasError(true);
        setPageState("error");
      };

      const postTask = (async () => {
        try {
          const { data, error } = await supabase
            .from("posts")
            .select("*, author:profiles(*)")
            .eq("id", postId)
            .single();
          if (cancelled) return;
          if (error) {
            fail();
            setLoadError(error.message);
          } else {
            setPost(data as Post);
          }
        } catch (err) {
          if (cancelled) return;
          fail();
          setLoadError(err instanceof Error ? err.message : "network error");
        }
      })();

      const votesTask = (async () => {
        try {
          const { count, error } = await supabase
            .from("votes")
            .select("*", { count: "exact", head: true })
            .eq("post_id", postId);
          if (cancelled) return;
          if (error) {
            fail();
          } else {
            setVotes(count ?? 0);
          }
        } catch {
          fail();
        }
      })();

      await Promise.all([postTask, votesTask]);
      if (cancelled) return;
      if (!failed) setPageState("ready");
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  async function roastIt() {
    setRoasting(true);
    const { data, error } = await supabase.functions.invoke("ai-summary", {
      body: { post_id: postId },
    });
    setRoast(error ? "The roaster is busy. Try again later." : (data?.roast ?? null));
    setRoasting(false);
  }

  if (!post) {
    if (hasError) {
      return (
        <section className="card error-banner">
          <strong>Something went wrong.</strong>
          {loadError ? ` ${loadError}` : ""}
        </section>
      );
    }
    return <p className="muted">Loading…</p>;
  }

  return (
    <article className="card">
      {hasError && (
        <section className="card error-banner">
          <strong>Something went wrong.</strong>
        </section>
      )}
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
