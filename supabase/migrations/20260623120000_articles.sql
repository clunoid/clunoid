-- Clunoid — public articles
-- Every substantive answer Isaac researches becomes a public, SEO-indexed
-- article (NO personal data — only the researched topic + content + media).
-- Public READ for everyone; writes ONLY through a validated SECURITY DEFINER
-- RPC, so clients can never spam or tamper with the table directly.

create table if not exists public.articles (
  slug        text primary key,
  title       text not null,
  summary     text,
  kind        text,                       -- explainer | calculation | rich_card
  experience  jsonb not null,             -- the full Scene experience (renderable)
  views       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists articles_updated_idx on public.articles (updated_at desc);

alter table public.articles enable row level security;

-- Anyone (signed in or not) can READ articles — this is what powers SEO.
drop policy if exists "articles public read" on public.articles;
create policy "articles public read" on public.articles
  for select using (true);

-- No INSERT/UPDATE/DELETE policies → the table is read-only to all clients.
-- The ONLY write path is the validated function below.
create or replace function public.upsert_article(
  p_slug       text,
  p_title      text,
  p_summary    text,
  p_kind       text,
  p_experience jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Guards so the public corpus stays clean.
  if p_slug is null or btrim(p_slug) = '' or length(p_slug) > 200 then return; end if;
  if p_title is null or length(btrim(p_title)) < 2 or length(p_title) > 300 then return; end if;
  if p_experience is null then return; end if;

  insert into public.articles (slug, title, summary, kind, experience, updated_at)
  values (p_slug, btrim(p_title), left(coalesce(p_summary, ''), 600), p_kind, p_experience, now())
  on conflict (slug) do update
    set title      = excluded.title,
        summary    = excluded.summary,
        kind       = excluded.kind,
        experience = excluded.experience,
        updated_at = now();
end;
$$;

grant execute on function public.upsert_article(text, text, text, text, jsonb) to anon, authenticated;

-- Best-effort view counter (never blocks a read).
create or replace function public.bump_article_views(p_slug text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.articles set views = views + 1 where slug = p_slug;
$$;

grant execute on function public.bump_article_views(text) to anon, authenticated;
