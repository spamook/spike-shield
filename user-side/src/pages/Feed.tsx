import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

// fix/feed: 20 posts per page, only the columns the list needs (no body), and
// posts(created_at desc) is indexed (supabase/migrations/20260926000001_feed_index.sql).
const PAGE_SIZE = 20;

type FeedPost = {
  id: number;
  title: string;
  created_at: string;
  author: { username: string } | null;
};

export default function Feed() {
  const [page, setPage] = useState(0);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [votes, setVotes] = useState<Record<number, number>>({});
  const [roast, setRoast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      const from = page * PAGE_SIZE;
      const { data, error } = await supabase
        .from("posts")
        .select("id, title, created_at, author:profiles(username)")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE); // one extra row tells us whether there is a next page
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as unknown as FeedPost[];
      setHasMore(rows.length > PAGE_SIZE);
      const list = rows.slice(0, PAGE_SIZE);
      setPosts(list);
      setLoading(false);

      // Weak point 2 (still here): N+1 vote counts, one request per post.
      for (const post of list) {
        supabase
          .from("votes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", post.id)
          .then(({ count }) => {
            if (!cancelled) setVotes((v) => ({ ...v, [post.id]: count ?? 0 }));
          });
      }

      // Weak point 3 (still here): AI call on every page load.
      const ideaOfTheDay = list[0];
      if (page === 0 && ideaOfTheDay) {
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
  }, [page]);

  if (error) return <p className="error">Could not load the feed: {error}</p>;

  const ideaOfTheDay = page === 0 ? posts[0] : undefined;

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
      {loading ? (
        <p className="muted">Loading ideas…</p>
      ) : (
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
      )}

      <nav className="pager">
        <button onClick={() => setPage((p) => p - 1)} disabled={page === 0 || loading}>
          ← Newer
        </button>
        <span className="muted">Page {page + 1}</span>
        <button onClick={() => setPage((p) => p + 1)} disabled={!hasMore || loading}>
          Older →
        </button>
      </nav>
    </>
  );
}
