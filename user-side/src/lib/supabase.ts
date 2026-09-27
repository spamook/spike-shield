import { createClient } from "@supabase/supabase-js";

// Give up on a Supabase call after 6 s, so an overloaded backend shows up as an error
// ("Something went wrong", data-state="error") instead of an endless spinner. Short enough that
// the feed query and the vote counts after it both time out within the rush tester's 15 s limit.
const REQUEST_TIMEOUT_MS = 6_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  // supabase-js retries failed GET/HEAD calls up to 3 times (1 s, 2 s, 4 s) by default. That keeps
  // a page "loading" long after its calls failed and sends the same heavy queries again to a
  // database that is already overloaded, so turn it off: a failure is shown as a failure.
  { global: { fetch: fetchWithTimeout }, db: { retry: false } },
);
