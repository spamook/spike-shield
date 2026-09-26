-- fix/feed: the feed orders by created_at, so index it.
create index posts_created_at_idx on posts (created_at desc);
