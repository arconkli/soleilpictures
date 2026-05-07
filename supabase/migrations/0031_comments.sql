-- Anywhere-comments: anchor a comment to a canvas card, group, point in
-- empty space, the board itself, or a doc range. Replies are modeled as
-- comments with reply_to pointing at the parent. Hidden + resolved are
-- per-comment toggles. RLS reads on can_read_board; writes on either
-- author OR can_write_board (so a board editor can resolve + delete
-- another user's comments, while non-editors can only manage their own).

create table if not exists public.comments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces on delete cascade,
  board_id      uuid not null references public.boards on delete cascade,

  -- Anchor: where on the canvas/board does this comment attach?
  --  card       — anchor_id is a card id (Y.Map<'cards'> key)
  --  group      — anchor_id is a group id
  --  point      — anchor_x/y are canvas-space coords (no card)
  --  board      — board-level remark (anchor_id null, no coords)
  --  doc_range  — anchor_id is the doc-card id; doc_page_id + doc_from/to
  anchor_kind   text not null check (anchor_kind in ('card','group','point','board','doc_range')),
  anchor_id     text,
  anchor_x      integer,
  anchor_y      integer,
  doc_page_id   text,
  doc_from      integer,
  doc_to        integer,

  author        uuid references auth.users,
  body          text not null,
  reply_to      uuid references public.comments on delete cascade,

  hidden        boolean not null default false,
  resolved      boolean not null default false,

  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists comments_board_id_idx on public.comments (board_id);
create index if not exists comments_author_idx on public.comments (author);
create index if not exists comments_reply_to_idx on public.comments (reply_to);

alter table public.comments enable row level security;

drop policy if exists "comments select" on public.comments;
create policy "comments select"
  on public.comments for select
  using (public.can_read_board(board_id));

drop policy if exists "comments insert" on public.comments;
create policy "comments insert"
  on public.comments for insert
  with check (
    author = auth.uid()
    and public.can_read_board(board_id)
  );

drop policy if exists "comments update self or editor" on public.comments;
create policy "comments update self or editor"
  on public.comments for update
  using (author = auth.uid() or public.can_write_board(board_id))
  with check (author = auth.uid() or public.can_write_board(board_id));

drop policy if exists "comments delete self or editor" on public.comments;
create policy "comments delete self or editor"
  on public.comments for delete
  using (author = auth.uid() or public.can_write_board(board_id));

create or replace function public.comments_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists comments_touch_updated_at on public.comments;
create trigger comments_touch_updated_at
  before update on public.comments
  for each row execute function public.comments_touch_updated_at();

alter publication supabase_realtime add table public.comments;
