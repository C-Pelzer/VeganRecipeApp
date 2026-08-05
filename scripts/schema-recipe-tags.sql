-- Run this in the Supabase SQL editor.
-- Pipeline-computed recipe tags (time buckets, cuisine, ingredients) that back
-- the drawer's Categories section. Populated/replaced wholesale by
-- scripts/tag-recipes.mjs — nothing in this table is user-authored.

create table recipe_tags (
  recipe_id text not null,
  category text not null check (category in ('time', 'cuisine', 'ingredient')),
  tag_slug text not null,
  label text not null,
  primary key (recipe_id, category, tag_slug)
);

create index recipe_tags_tag_slug_idx on recipe_tags (tag_slug);

alter table recipe_tags enable row level security;

create policy "anon full access" on recipe_tags for all to anon using (true) with check (true);
