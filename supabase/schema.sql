-- Agora Online — database schema for Supabase (Postgres)
-- Run this once in the Supabase SQL Editor for a fresh project.
-- Safe to re-run: most statements use IF NOT EXISTS / OR REPLACE / exception guards.

create extension if not exists pgcrypto;

-- ============================================================
-- TABLES
-- ============================================================

-- One row per person. id matches auth.users.id (works for both
-- anonymous and full accounts).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- One row per open/active/concluded conversation on the board.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  mode text not null check (mode in ('duo', 'group')),
  max_seats int not null check (max_seats between 2 and 5),
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'concluded')),
  started_at timestamptz,
  duration_minutes int not null default 30,
  extended_minutes int not null default 0,
  created_at timestamptz not null default now()
);

-- One row per person currently seated in a conversation.
create table if not exists public.post_participants (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- One row per finished conversation, kept privately per user.
create table if not exists public.session_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  mode text not null,
  partners text[] not null default '{}',
  rating int check (rating between 0 and 5),
  reflection text,
  ended_at timestamptz not null default now()
);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- (security definer functions run with elevated rights so they can
-- do atomic, race-safe seat-limit checks that RLS alone can't express)
-- ============================================================

-- Enforce the seat limit atomically when someone tries to join.
create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer
as $$
declare
  current_count int;
  max_s int;
  post_status text;
begin
  perform 1 from public.posts where id = new.post_id for update;

  select max_seats, status into max_s, post_status
  from public.posts where id = new.post_id;

  if max_s is null then
    raise exception 'That conversation no longer exists.';
  end if;

  if post_status <> 'open' then
    raise exception 'That conversation is no longer open.';
  end if;

  select count(*) into current_count
  from public.post_participants where post_id = new.post_id;

  if current_count >= max_s then
    raise exception 'That conversation is full.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_seat_limit on public.post_participants;
create trigger trg_enforce_seat_limit
  before insert on public.post_participants
  for each row execute function public.enforce_seat_limit();

-- Start the 30-minute clock the moment a second person joins.
create or replace function public.maybe_start_timer()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.posts
  set started_at = now()
  where id = new.post_id
    and started_at is null
    and (select count(*) from public.post_participants where post_id = new.post_id) >= 2;
  return new;
end;
$$;

drop trigger if exists trg_maybe_start_timer on public.post_participants;
create trigger trg_maybe_start_timer
  after insert on public.post_participants
  for each row execute function public.maybe_start_timer();

-- Mark a post concluded once the last person leaves.
create or replace function public.maybe_conclude_post()
returns trigger
language plpgsql
security definer
as $$
begin
  if (select count(*) from public.post_participants where post_id = old.post_id) = 0 then
    update public.posts set status = 'concluded' where id = old.post_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_maybe_conclude_post on public.post_participants;
create trigger trg_maybe_conclude_post
  after delete on public.post_participants
  for each row execute function public.maybe_conclude_post();

-- Callable from the client: add 15 minutes, but only if you're
-- actually in the room.
create or replace function public.extend_time(p_post_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if not exists (
    select 1 from public.post_participants
    where post_id = p_post_id and user_id = auth.uid()
  ) then
    raise exception 'Only people in the conversation can extend the timer.';
  end if;

  update public.posts
  set extended_minutes = extended_minutes + 15
  where id = p_post_id;
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.post_participants enable row level security;
alter table public.session_history enable row level security;

drop policy if exists "profiles are readable by anyone signed in" on public.profiles;
create policy "profiles are readable by anyone signed in"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users manage their own profile" on public.profiles;
create policy "users manage their own profile"
  on public.profiles for all
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "posts are readable by anyone signed in" on public.posts;
create policy "posts are readable by anyone signed in"
  on public.posts for select
  to authenticated
  using (true);

drop policy if exists "signed-in users can open a conversation" on public.posts;
create policy "signed-in users can open a conversation"
  on public.posts for insert
  to authenticated
  with check (auth.uid() = host_id);

drop policy if exists "participants can update shared timer fields" on public.posts;
create policy "participants can update shared timer fields"
  on public.posts for update
  to authenticated
  using (
    exists (
      select 1 from public.post_participants
      where post_id = posts.id and user_id = auth.uid()
    )
  );

drop policy if exists "participants list is readable by anyone signed in" on public.post_participants;
create policy "participants list is readable by anyone signed in"
  on public.post_participants for select
  to authenticated
  using (true);

drop policy if exists "you can take your own seat" on public.post_participants;
create policy "you can take your own seat"
  on public.post_participants for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "you can leave your own seat" on public.post_participants;
create policy "you can leave your own seat"
  on public.post_participants for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "history is private to each user" on public.session_history;
create policy "history is private to each user"
  on public.session_history for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- REALTIME
-- Make sure changes to the board are pushed to everyone live.
-- (If your project already has these in the publication this will
-- just no-op — that's fine.)
-- ============================================================

do $$
begin
  alter publication supabase_realtime add table public.posts;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.post_participants;
exception when others then null;
end $$;
