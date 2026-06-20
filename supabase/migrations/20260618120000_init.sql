-- Clunoid — initial schema
-- profiles (what Isaac knows), conversations + messages (history),
-- memories (pgvector, reserved for semantic recall). All RLS-protected.

create extension if not exists vector with schema extensions;

-- ── Profiles ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  about        text,                       -- free-form facts Isaac learns
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "own profile - select" on public.profiles
  for select using (auth.uid() = id);
create policy "own profile - upsert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "own profile - update" on public.profiles
  for update using (auth.uid() = id);

-- ── Conversations ───────────────────────────────────────────────────────
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text,
  started_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

create policy "own conversations" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Messages ────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null check (role in ('user', 'isaac')),
  content         text not null,
  created_at      timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "own messages" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists messages_user_created_idx
  on public.messages (user_id, created_at desc);

-- ── Memories (pgvector; reserved for semantic recall) ────────────────────
create table if not exists public.memories (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  content    text not null,
  embedding  extensions.vector(384),       -- gte-small dimensions
  created_at timestamptz not null default now()
);

alter table public.memories enable row level security;

create policy "own memories" on public.memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Auto-create a profile when a user signs up ───────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
