import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Post } from "../types";

// fix/votes: the posts_with_votes view returns each post with its vote count in one query
// (supabase/migrations/20260926000001_votes_view.sql), and votes(post_id) is indexed.
type PostWithVotes = Post & { vote_count: number };

export default function Feed() {
  const [posts, setPosts] = useState<PostWithVotes[]>([]);
  const [roast, setRoast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Weak point 1 (still here): 200 posts at once with the long body, ordered without an index.
      const { data, error } = await supabase
        .from("posts_with_votes")
        .select("*, author:profiles(*)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const list = (data ?? []) as PostWithVotes[];
      setPosts(list);
      setLoading(false);

      // Weak point 3 (still here): AI call on every page load.
      const ideaOfTheDay = list[0];
      if (ideaOfTheDay) {
        supabase.functions
          .invoke("ai-summary", { body: { post_id: ideaOfTheDay.id } })
          .then(({ data, error }) => {
            if (cancelled) return;
            setRoast(error ? "The roaster is busy. Try again later." : (data?.roast ?? null));
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
          <blockquote className="roast">{roast ?? "Roasting…"}</blockquote>
        </section>
      )}

      <h2>Latest ideas</h2>
      <ul className="feed">
        {posts.map((post) => (
          <li key={post.id} className="card">
            <div className="votes" title="votes">
              ▲ {post.vote_count}
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
