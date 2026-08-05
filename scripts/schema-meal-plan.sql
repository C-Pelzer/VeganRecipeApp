-- Run this in the Supabase SQL editor.
-- Tracks which favorited recipes are currently "in the plan" — populated by
-- the same Favorites "Add to Shopping List" action (app/src/lib/store/
-- mealPlanStore.ts), cleared independently of shopping_list_items.

create table meal_plan_items (
  recipe_id text primary key,
  added_at timestamptz not null default now()
);

alter table meal_plan_items enable row level security;

create policy "anon full access" on meal_plan_items for all to anon using (true) with check (true);
