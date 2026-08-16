-- Run this in the Supabase SQL editor.
--
-- Widens swipe_decks.category to allow the diet / effort / season categories.
-- This is a SECOND, separate constraint from the one on recipe_tags.category
-- (scripts/schema-recipe-tags-categories.sql) — widening that one lets the tags
-- be stored, but the decks built from them are still rejected here.
--
-- Note the live constraint already permits 'book', which the original
-- schema-swipe-decks.sql does not list; that file is out of date relative to
-- the database. The statement below is the full, correct set.
--
-- The anon key used by the scripts can't run DDL, which is why this is a
-- hand-run file.
--
-- After running this, add 'diet', 'effort' and 'season' to
-- ALLOWED_DECK_CATEGORIES in scripts/build-swipe-decks.mjs, then re-run:
--     node --env-file=.env build-swipe-decks.mjs

alter table swipe_decks drop constraint if exists swipe_decks_category_check;

alter table swipe_decks add constraint swipe_decks_category_check
  check (category in ('time', 'cuisine', 'ingredient', 'course', 'book', 'diet', 'effort', 'season'));
