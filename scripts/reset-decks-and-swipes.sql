-- Run this in the Supabase SQL editor.
-- Wipes custom decks, every deck share, and all swipe state:
--   - every 'manual' deck (built via Catalog's deck builder) — cascades to
--     its swipe_deck_recipes membership and any swipe_deck_shares row for it
--   - every remaining swipe_deck_shares row, including ones tied to an
--     'auto' category deck (sending isn't limited to manual decks) — the
--     category decks themselves are untouched, only who they were sent to
--   - recipe_priority + swipe_events, same full reset as reset-swipes.sql

delete from swipe_decks where source = 'manual';
delete from swipe_deck_shares;
truncate table recipe_priority, swipe_events;
