-- Run this in the Supabase SQL editor.
-- Shared per-recipe notes/edits (app/src/lib/store/recipeOverrideStore.ts) —
-- one row per recipe that's actually been edited, not pre-populated. Empty
-- string in ingredients_override/steps_override means "no edit, show the
-- book's original" — clearing the text back to empty reverts it.

create table recipe_overrides (
  recipe_id text primary key,
  notes text not null default '',
  ingredients_override text not null default '',
  steps_override text not null default '',
  updated_at timestamptz not null default now()
);

alter table recipe_overrides enable row level security;

create policy "anon full access" on recipe_overrides for all to anon using (true) with check (true);
