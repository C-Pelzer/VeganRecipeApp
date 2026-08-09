-- Run this in the Supabase SQL editor.
-- Adds a fourth tag category, "course" (appetizer, entree, dessert, etc.),
-- alongside the existing time/cuisine/ingredient categories in recipe_tags
-- (scripts/schema-recipe-tags.sql). Populated by the course keyword-matcher
-- added to scripts/tag-recipes.mjs.

alter table recipe_tags drop constraint recipe_tags_category_check;

alter table recipe_tags
  add constraint recipe_tags_category_check
  check (category in ('time', 'cuisine', 'ingredient', 'course'));
