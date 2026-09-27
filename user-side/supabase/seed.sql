-- Seed: large enough that the missing indexes hurt.
-- 1,000 profiles, 10,000 posts (~1.5 KB body each), 50,000 votes.
-- Applied by `supabase db reset` (and by the first `supabase start`).

insert into profiles (username)
select 'user_' || g from generate_series(1, 1000) g;

with p as (select array_agg(id) as ids from profiles)
insert into posts (author_id, title, body, created_at)
select p.ids[1 + (g % 1000)],
       'Idea #' || g,
       repeat('This startup will change everything. ', 40),
       now() - (g || ' minutes')::interval
from p, generate_series(1, 10000) g;

insert into votes (post_id)
select 1 + floor(random() * 10000)::int
from generate_series(1, 50000);
