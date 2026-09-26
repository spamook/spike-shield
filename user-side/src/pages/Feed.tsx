import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Post } from "../types";

const VOTE_COUNT_POSTS = 20;

export default function Feed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [votes, setVotes] = useState<Record<number, number>>({});
  const [roast, setRoast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Weak point 1 (still here): heavy feed query.
      const { data, error } = await supabase
        .from("posts")
        .select("*, author:profiles(*)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const list = (data ?? []) as Post[];
      setPosts(list);
      setLoading(false);

      // Weak point 2 (still here): N+1 vote counts.
      for (const post of list.slice(0, VOTE_COUNT_POSTS)) {
        supabase
          .from("votes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id)
          .then(({ count }) => {
            if (!cancelled) setVotes((v) => ({ ...v, [post.id]: count ?? 0 }));
          });
      }

      // fix/ai: no AI call on page load. The card shows the saved roast from the roasts table
      // if the idea has been roasted, otherwise a link to roast it on the detail page.
      const ideaOfTheDay = list[0];
      if (ideaOfTheDay) {
        supabase
          .from("roasts")
          .select("roast")
          .eq("post_id", ideaOfTheDay.id)
          .maybeSingle()
          .then(({ data }) => {
            if (!cancelled) setRoast(data?.roast ?? null);
          });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="muted">Loading ideas…</p>;
  if (error) return <p className="error">Could not load the feed: {error}</p>;

  const ideaOfTheDay = posts[0];

  return (
    <>
      {ideaOfTheDay && (
        <section className="card highlight">
          <h2 className="label">Idea of the day</h2>
          <h3>
            <Link to={`/idea/${ideaOfTheDay.id}`}>{ideaOfTheDay.title}</Link>
          </h3>
          <p className="muted">by {ideaOfTheDay.author?.username ?? "anonymous"}</p>
          {roast ? (
            <blockquote className="roast">{roast}</blockquote>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>
              Not roasted yet. <Link to={`/idea/${ideaOfTheDay.id}`}>Roast this idea →</Link>
            </p>
          )}
        </section>
      )}

      <h2>Latest ideas</h2>
      <ul className="feed">
        {posts.map((post) => (
          <li key={post.id} className="card">
            <div className="votes" title="votes">
              ▲ {votes[post.id] ?? "–"}
            </div>
            <div>
              <h3>
                <Link to={`/idea/${post.id}`}>{post.title}</Link>
              </h3>
              <p className="muted">
                by {post.author?.username ?? "anonymous"} ·{" "}
                {new Date(post.created_at).toLocaleString()}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
