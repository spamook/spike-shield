import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { setPageState } from "../lib/pageState";
import type { Post } from "../types";

const VOTE_COUNT_POSTS = 20;

export default function Feed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [votes, setVotes] = useState<Record<number, number>>({});
  const [roast, setRoast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPageState("loading");
    setHasError(false);
    setLoadError(null);

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
      let list: Post[] = [];

      // Weak point 1: heavy feed query. 200 posts at once, select * (includes the long body),
      // joined with the author, ordered by created_at, which has no index.
      try {
        const { data, error } = await supabase
          .from("posts")
          .select("*, author:profiles(*)")
          .order("created_at", { ascending: false })
          .limit(200);
        if (cancelled) return;
        if (error) {
          fail();
          setLoadError(error.message);
        } else {
          list = (data ?? []) as Post[];
          setPosts(list);
        }
      } catch (err) {
        if (cancelled) return;
        fail();
        setLoadError(err instanceof Error ? err.message : "network error");
      }
      setLoading(false);

      // Weak point 2: N+1 vote counts. One request per post; votes.post_id has no index,
      // so every count scans the whole votes table. All 20 fire at the same moment; the page is
      // "ready" only once all of them succeed (the first failure shows the error at once).
      const voteTasks = list.slice(0, VOTE_COUNT_POSTS).map((post) =>
        (async () => {
          try {
            const { count, error } = await supabase
              .from("votes")
              .select("*", { count: "exact", head: true })
              .eq("post_id", post.id);
            if (cancelled) return;
            if (error) {
              fail();
            } else {
              setVotes((v) => ({ ...v, [post.id]: count ?? 0 }));
            }
          } catch {
            fail();
          }
        })(),
      );

      // Weak point 3: AI call on every page load. The "Idea of the day" card asks the
      // ai-summary Edge Function for a roast on every feed load, with no cache.
      const ideaOfTheDay = list[0];
      const aiTask = (async () => {
        if (!ideaOfTheDay) return;
        try {
          const { data, error } = await supabase.functions.invoke("ai-summary", {
            body: { post_id: ideaOfTheDay.id, title: ideaOfTheDay.title },
          });
          if (cancelled) return;
          if (error) fail();
          setRoast(error ? "The roaster is busy. Try again later." : (data?.roast ?? null));
        } catch {
          fail();
        }
      })();

      await Promise.all([...voteTasks, aiTask]);
      if (cancelled) return;
      if (!failed) setPageState("ready");
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="muted">Loading ideas…</p>;

  const ideaOfTheDay = posts[0];

  return (
    <>
      {hasError && (
        <section className="card error-banner">
          <strong>Something went wrong.</strong>
          {loadError ? ` ${loadError}` : ""}
        </section>
      )}

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
