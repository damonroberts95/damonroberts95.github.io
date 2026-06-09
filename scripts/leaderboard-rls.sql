-- NODE RUN leaderboard — server-side hardening for the public `scores` table.
-- Run in Supabase: SQL Editor → paste → Run. Idempotent (safe to re-run).
--
-- WHY: the anon key is public, so the client-side rate cap in play.js is only a
-- courtesy. This enforces the real limits in the database, so they hold no matter
-- what calls the REST endpoint.
--
-- WHAT it does (no client change needed — works with the existing REST INSERT):
--   1. Row Level Security: anyone may READ the board; INSERT only via the rules below.
--   2. A BEFORE INSERT trigger that, per client IP:
--        - 15s cooldown between submits
--        - max 8 submits per rolling hour
--      and validates the row (name shape, numeric bounds, allowed mode).
--
-- ASSUMPTIONS — adjust if your schema differs:
--   table public.scores (name text, score numeric, time numeric, points int, mode text,
--                         created_at timestamptz default now())
-- If `created_at` is missing, add it:  alter table public.scores add column created_at timestamptz default now();
--
-- COEXISTS with the existing `trim_scores` AFTER INSERT trigger (keeps top-10 per mode) —
-- different name + timing, so both fire. This script only manages the policies named
-- `scores_read` / `scores_insert`; if your current policies have other names, drop those
-- first to avoid duplicate permissive policies. (Validation now lives in the trigger, so
-- a permissive insert policy is fine.) No statement here deletes existing rows.

-- ---------------------------------------------------------------------------
-- 1. submission audit log (per-IP timestamps; not world-readable)
-- ---------------------------------------------------------------------------
create table if not exists public.submit_log (
  id         bigint generated always as identity primary key,
  ip         text        not null,
  mode       text,
  created_at timestamptz not null default now()
);
create index if not exists submit_log_ip_time on public.submit_log (ip, created_at desc);

alter table public.submit_log enable row level security;
-- no anon policies on submit_log → the trigger (SECURITY DEFINER) is the only writer.

-- ---------------------------------------------------------------------------
-- 2. tunable limits
-- ---------------------------------------------------------------------------
-- cooldown seconds / window / max-per-window live inline in the function below.

-- ---------------------------------------------------------------------------
-- 3. enforcement trigger (runs as owner, so it can read/write submit_log)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_score_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip       text;
  v_xff      text[];
  v_last     timestamptz;
  v_count    int;
  c_cooldown constant interval := interval '15 seconds';
  c_window   constant interval := interval '1 hour';
  c_max      constant int      := 8;
  c_modes    constant text[]   := array['classic','waves','journey','arena'];
begin
  -- Client IP from x-forwarded-for. Take the LAST hop, not the first: the leftmost
  -- entry is client-supplied (spoofable to evade the rate cap), while the rightmost
  -- is appended by Supabase's trusted proxy. nullif/coalesce → 'unknown' if absent.
  v_xff := regexp_split_to_array(
             coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''),
             '\s*,\s*');
  v_ip := nullif(btrim(v_xff[array_length(v_xff, 1)]), '');
  if v_ip is null then v_ip := 'unknown'; end if;

  -- ---- field validation (reject junk before it ever lands) ----
  if new.name is null or new.name !~ '^[A-Z0-9]{1,3}$' then
    raise exception 'invalid name' using errcode = 'check_violation';
  end if;
  if new.score is null or new.score < 0 or new.score > 100000 then
    raise exception 'invalid score' using errcode = 'check_violation';
  end if;
  if new.time is not null and (new.time < 0 or new.time > 86400) then
    raise exception 'invalid time' using errcode = 'check_violation';
  end if;
  if new.points is not null and (new.points < 0 or new.points > 100000000) then
    raise exception 'invalid points' using errcode = 'check_violation';
  end if;
  if new.mode is not null and not (new.mode = any(c_modes)) then
    raise exception 'invalid mode' using errcode = 'check_violation';
  end if;

  -- ---- per-IP rate limit ----
  select max(created_at), count(*)
    into v_last, v_count
    from public.submit_log
   where ip = v_ip
     and created_at > now() - c_window;

  if v_last is not null and v_last > now() - c_cooldown then
    raise exception 'rate limited: cooldown' using errcode = 'P0001';
  end if;
  if coalesce(v_count, 0) >= c_max then
    raise exception 'rate limited: hourly cap' using errcode = 'P0001';
  end if;

  -- record the attempt + stamp the row
  insert into public.submit_log (ip, mode) values (v_ip, new.mode);
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists trg_enforce_score_insert on public.scores;
create trigger trg_enforce_score_insert
  before insert on public.scores
  for each row execute function public.enforce_score_insert();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security on scores: public read, gated insert, no update/delete
-- ---------------------------------------------------------------------------
alter table public.scores enable row level security;

drop policy if exists scores_read   on public.scores;
drop policy if exists scores_insert on public.scores;

create policy scores_read   on public.scores for select using (true);
-- INSERT allowed for the anon/auth roles; the trigger above is what actually gates it.
create policy scores_insert on public.scores for insert with check (true);

-- no UPDATE / DELETE policies → those are denied for anon under RLS.

-- ---------------------------------------------------------------------------
-- housekeeping: prune old audit rows (optional — schedule via pg_cron if installed)
-- ---------------------------------------------------------------------------
-- delete from public.submit_log where created_at < now() - interval '2 days';
