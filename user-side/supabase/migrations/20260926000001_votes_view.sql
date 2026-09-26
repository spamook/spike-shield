-- fix/votes: one query for posts with their vote count, and an index so the count is cheap.
create index votes_post_id_idx on votes (post_id);

-- security_invoker: the view runs with the caller's rights, so the tables' RLS policies apply
-- (public read). PostgREST embeds author:profiles(*) through posts.author_id as it does for posts.
create view posts_with_votes with (security_invoker = true) as
select p.id,
       p.author_id,
       p.title,
       p.body,
       p.created_at,
       (select count(*) from votes v where v.post_id = p.id) as vote_count
from posts p;

grant select on posts_with_votes to anon, authenticated;
