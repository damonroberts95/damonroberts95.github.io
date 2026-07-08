-- NODE RUN keepalive — a tiny table the .github/workflows/keepalive.yml cron
-- writes to, so Supabase sees real API activity (not just a read) and the
-- free-tier project never auto-pauses (paused after 7 days with none).
-- Run in Supabase: SQL Editor → paste → Run. Idempotent (safe to re-run).
--
-- Single row, upserted in place (id is pinned to 1) — never grows, never
-- touches the public `scores` leaderboard.

create table if not exists public.keepalive (
  id        int primary key default 1,
  pinged_at timestamptz not null default now(),
  constraint keepalive_single_row check (id = 1)
);

insert into public.keepalive (id, pinged_at) values (1, now())
  on conflict (id) do nothing;

alter table public.keepalive enable row level security;

drop policy if exists keepalive_read   on public.keepalive;
drop policy if exists keepalive_write  on public.keepalive;
drop policy if exists keepalive_update on public.keepalive;

-- anon may read + upsert this one row; nothing sensitive lives here.
create policy keepalive_read   on public.keepalive for select using (true);
create policy keepalive_write  on public.keepalive for insert with check (true);
create policy keepalive_update on public.keepalive for update using (true) with check (true);
