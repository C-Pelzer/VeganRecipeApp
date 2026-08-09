-- Run this in the Supabase SQL editor.
-- Persisted, bounded (<=40 recipes, enforced app/script-side) swipe decks —
-- replaces the old live tag-filter decks. 'auto' decks are one per tag,
-- wholesale-replaced by scripts/build-swipe-decks.mjs; 'manual' decks are
-- built by hand in the Catalog deck builder (app/src/lib/store/deckStore.ts)
-- and untouched by that script. swipe_deck_shares is the explicit
-- send/notify record for manual decks — sharing doesn't gate swipe access,
-- it only drives the "shared with you" list and its unseen badge.

create table swipe_decks (
  id text primary key,
  label text not null,
  source text not null check (source in ('auto', 'manual')),
  category text check (category in ('time', 'cuisine', 'ingredient', 'course')),
  tag_slug text,
  created_by text not null check (created_by in ('Cameron', 'Mallorie', 'system')),
  created_at timestamptz not null default now()
);

create table swipe_deck_recipes (
  deck_id text not null references swipe_decks (id) on delete cascade,
  recipe_id text not null,
  position int not null,
  primary key (deck_id, recipe_id)
);

create table swipe_deck_shares (
  deck_id text not null references swipe_decks (id) on delete cascade,
  shared_with text not null check (shared_with in ('Cameron', 'Mallorie')),
  shared_by text not null check (shared_by in ('Cameron', 'Mallorie')),
  shared_at timestamptz not null default now(),
  seen_at timestamptz,
  primary key (deck_id, shared_with)
);

alter table swipe_decks enable row level security;
alter table swipe_deck_recipes enable row level security;
alter table swipe_deck_shares enable row level security;

create policy "anon full access" on swipe_decks for all to anon using (true) with check (true);
create policy "anon full access" on swipe_deck_recipes for all to anon using (true) with check (true);
create policy "anon full access" on swipe_deck_shares for all to anon using (true) with check (true);
