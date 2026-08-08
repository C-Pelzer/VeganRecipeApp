-- Run this in the Supabase SQL editor.
-- Recipes imported from a website URL (NewIdeas.txt item #1). Unlike the
-- cookbook pipeline's static app/public/data/recipes.json, there's no build
-- step to append to for these, so each imported recipe is stored whole as
-- jsonb and merged with the static bundle at read time (app/src/lib/data.ts).

create table imported_recipes (
  id text primary key,
  source_url text not null,
  added_by text not null check (added_by in ('Cameron', 'Mallorie')),
  recipe_data jsonb not null,
  created_at timestamptz not null default now()
);

alter table imported_recipes enable row level security;

create policy "anon full access" on imported_recipes for all to anon using (true) with check (true);
