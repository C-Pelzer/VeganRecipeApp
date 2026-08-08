-- Run this in the Supabase SQL editor.
-- Meal Calendar: one recipe + one assigned household member per
-- (date, meal_type) slot. Recipe choices come from the favorites list
-- (app/src/lib/favorites.ts), not a separate table.

create table meal_calendar_entries (
  entry_date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  recipe_id text not null,
  assigned_to text not null check (assigned_to in ('Cameron', 'Mallorie')),
  updated_at timestamptz not null default now(),
  primary key (entry_date, meal_type)
);

alter table meal_calendar_entries enable row level security;

create policy "anon full access" on meal_calendar_entries for all to anon using (true) with check (true);
