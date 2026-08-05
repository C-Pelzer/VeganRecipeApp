-- Run this in the Supabase SQL editor.
-- One shared shopping list for the household, built from selected favorites
-- (app/src/lib/store/shoppingListStore.ts). qty_total/qty_notes are kept
-- separate (rather than one pre-formatted string) so merging a later addition
-- is a plain numeric add + dedup-append, never a re-parse of display text.

create table shopping_list_items (
  item_key text not null,
  unit_key text not null default '',
  qty_total numeric not null default 0,
  qty_notes text not null default '',  -- ';'-joined distinct non-numeric quantity phrases
  checked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (item_key, unit_key)
);

alter table shopping_list_items enable row level security;

create policy "anon full access" on shopping_list_items for all to anon using (true) with check (true);
