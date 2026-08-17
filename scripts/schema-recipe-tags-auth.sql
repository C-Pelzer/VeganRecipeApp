-- Run this in the Supabase SQL editor, once, after
-- scripts/reset-to-household-schema.sql.
--
-- Fixes a gap left by that migration: it swapped the "anon full access" policy
-- for a household-scoped `authenticated` one on all twelve tables it touched,
-- but recipe_tags was never in its list. recipe_tags is global reference data
-- derived from the shared recipe pool (same status as source='auto' rows in
-- swipe_decks), so it correctly wasn't household-scoped -- but it was left with
-- an anon-only policy and RLS still enabled.
--
-- Postgres RLS policies apply per-role, and `authenticated` does not inherit
-- `anon`. So once the app started signing in with Google it matched no policy
-- on this table and read back zero rows -- the tags silently vanished from the
-- UI (tag chips, tag filtering in app/src/lib/tags.ts) even though all ~29k
-- rows were still sitting in the table.
--
-- Read-only for signed-in users on purpose: recipe_tags is owned by the
-- pipeline (scripts/tag-recipes.mjs). A user's own tag edits go to
-- recipe_tag_overrides, which IS household-scoped, and are merged on top
-- client-side by effectiveTagsByRecipe().

-- The existing "anon full access" policy is deliberately NOT dropped:
-- scripts/tag-recipes.mjs runs as a batch script with the anon key and no
-- signed-in session, and needs it to keep rebuilding this table.

create policy "readable by all signed-in users" on recipe_tags for select to authenticated
  using (true);

-- Verify: should return the two policies (anon: ALL, authenticated: SELECT).
select polname, polcmd, pg_get_userbyid(unnest(polroles)) as role
from pg_policy
where polrelid = 'recipe_tags'::regclass;
