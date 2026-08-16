-- Run this in the Supabase SQL editor.
--
-- Widens recipe_tags.category to allow the diet / effort / season categories
-- added to scripts/tag-recipes.mjs. The original constraint was written when
-- only time/cuisine/ingredient existed and was later widened by hand for
-- course/book, so it has to be replaced rather than extended.
--
-- The anon key used by the scripts can't run DDL, which is why this is a
-- hand-run file rather than something tag-recipes.mjs does itself.
--
-- After running this, add 'diet', 'effort' and 'season' to ALLOWED_CATEGORIES
-- in scripts/tag-recipes.mjs, then re-run:
--     node --env-file=.env tag-recipes.mjs
--     node --env-file=.env build-swipe-decks.mjs

alter table recipe_tags drop constraint if exists recipe_tags_category_check;

alter table recipe_tags add constraint recipe_tags_category_check
  check (category in ('time', 'cuisine', 'ingredient', 'course', 'book', 'diet', 'effort', 'season'));
