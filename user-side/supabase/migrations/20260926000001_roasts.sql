-- fix/ai: each idea is roasted only once. The ai-summary Edge Function writes here with the
-- service role key (bypasses RLS); the app only reads.
create table roasts (
  post_id bigint primary key references posts(id),
  roast text not null,
  created_at timestamptz not null default now()
);

alter table roasts enable row level security;
create policy "public read" on roasts for select using (true);
