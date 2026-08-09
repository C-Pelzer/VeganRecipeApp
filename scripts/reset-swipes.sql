-- Run this in the Supabase SQL editor.
-- Wipes all swipe state for both household members: every recipe goes back
-- to unswiped/priority-5/not-favorited, and the swipe_events audit log is
-- cleared. Deck membership (swipe_decks/swipe_deck_recipes/swipe_deck_shares)
-- and everything else (favorites derive from recipe_priority, so those clear
-- too) is untouched. No FK references either table, so this is safe to run
-- standalone.

truncate table recipe_priority, swipe_events;
