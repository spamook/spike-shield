-- Idea Roaster schema. Intentionally NO index on posts(created_at) or votes(post_id):
-- Postgres does not index foreign keys automatically, and vibe-coded apps rarely add them.

create table profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  avatar_url text
);

create table posts (
  id bigint generated always as identity primary key,
  author_id uuid references profiles(id),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table votes (
  id bigint generated always as identity primary key,
  post_id bigint references posts(id),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table posts enable row level security;
alter table votes enable row level security;
create policy "public read" on profiles for select using (true);
create policy "public read" on posts for select using (true);
create policy "public read" on votes for select using (true);
