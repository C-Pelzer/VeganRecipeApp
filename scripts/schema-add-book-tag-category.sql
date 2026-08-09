-- Run this in the Supabase SQL editor.
-- Adds a fifth tag category, "book" — one tag per recipe for its source
-- cookbook, so scripts/build-swipe-decks.mjs builds a deck per book the same
-- way it already builds one per cuisine/course/ingredient/time tag, with no
-- changes to that script needed. Populated by scripts/tag-recipes.mjs.
-- Deliberately not exposed in the recipe detail tag editor — a recipe's book
-- isn't a manual correction the way cuisine/course can be, and it's already
-- shown elsewhere on that screen.

alter table recipe_tags drop constraint recipe_tags_category_check;
alter table recipe_tags
  add constraint recipe_tags_category_check
  check (category in ('time', 'cuisine', 'ingredient', 'course', 'book'));

alter table recipe_tag_overrides drop constraint recipe_tag_overrides_category_check;
alter table recipe_tag_overrides
  add constraint recipe_tag_overrides_category_check
  check (category in ('time', 'cuisine', 'ingredient', 'course', 'book'));

alter table swipe_decks drop constraint swipe_decks_category_check;
alter table swipe_decks
  add constraint swipe_decks_category_check
  check (category in ('time', 'cuisine', 'ingredient', 'course', 'book'));
