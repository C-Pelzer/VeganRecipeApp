-- Run this in the Supabase SQL editor.
-- User-authored edits layered on top of the pipeline-computed recipe_tags
-- table (scripts/tag-recipes.mjs), which is wiped and replaced wholesale on
-- every pipeline run. This table is never touched by that script, so a
-- household member's tag edits survive re-tagging. Effective tags for a
-- recipe = pipeline tags, minus any 'remove' rows here, plus any 'add' rows
-- here (app/src/lib/tags.ts effectiveTagsByRecipe).

create table recipe_tag_overrides (
  recipe_id text not null,
  category text not null check (category in ('time', 'cuisine', 'ingredient', 'course')),
  tag_slug text not null,
  label text not null,
  action text not null check (action in ('add', 'remove')),
  updated_at timestamptz not null default now(),
  primary key (recipe_id, category, tag_slug)
);

alter table recipe_tag_overrides enable row level security;

create policy "anon full access" on recipe_tag_overrides for all to anon using (true) with check (true);
