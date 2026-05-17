-- Track when each user last opened each top-level comment thread,
-- so the canvas can show a small dot on bubbles with unread replies.
--
-- One row per (user, root_comment) — replies aren't tracked
-- individually; reading the thread reads all replies. "root_comment"
-- is a comment with reply_to IS NULL.
--
-- RLS: self-only. Never expose another user's read state. Realtime
-- isn't needed (only the local client mutates its own views) so we
-- leave it out of supabase_realtime to keep that publication light.

create table if not exists public.comment_views (
  user_id          uuid not null references auth.users on delete cascade,
  root_comment_id  uuid not null references public.comments on delete cascade,
  last_viewed_at   timestamptz not null default now(),
  primary key (user_id, root_comment_id)
);

create index if not exists comment_views_user_idx
  on public.comment_views (user_id);

alter table public.comment_views enable row level security;

drop policy if exists "self read views" on public.comment_views;
create policy "self read views"
  on public.comment_views for select
  using (user_id = auth.uid());

drop policy if exists "self insert views" on public.comment_views;
create policy "self insert views"
  on public.comment_views for insert
  with check (user_id = auth.uid());

drop policy if exists "self update views" on public.comment_views;
create policy "self update views"
  on public.comment_views for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
