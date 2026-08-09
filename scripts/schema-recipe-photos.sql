-- Run this in the Supabase SQL editor.
-- Post-cook photos (NewIdeas.txt item #3) — either household member can attach
-- one or more "I made this" photos to any recipe, alongside its original
-- book/import photo (recipe.image, untouched). One row per photo, no cap.

create table recipe_photos (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null,
  photo_url text not null,
  added_by text not null check (added_by in ('Cameron', 'Mallorie')),
  added_at timestamptz not null default now()
);

alter table recipe_photos enable row level security;

create policy "anon full access" on recipe_photos for all to anon using (true) with check (true);
