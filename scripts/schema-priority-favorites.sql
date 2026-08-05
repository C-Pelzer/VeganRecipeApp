-- Run this in the Supabase SQL editor. Replaces the old `swipes` table
-- (safe: no real swipe data exists yet) with the priority/favoriting model.

drop table if exists swipes;

create table swipe_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null check (user_id in ('Cameron', 'Mallorie')),
  recipe_id text not null,
  direction text not null check (direction in ('left', 'right', 'down')),
  deck_id text not null,
  swiped_at timestamptz not null default now()
);

create table recipe_priority (
  user_id text not null check (user_id in ('Cameron', 'Mallorie')),
  recipe_id text not null,
  priority int not null default 5,
  favorited boolean not null default false,
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

alter table swipe_events enable row level security;
alter table recipe_priority enable row level security;

create policy "anon full access" on swipe_events for all to anon using (true) with check (true);
create policy "anon full access" on recipe_priority for all to anon using (true) with check (true);

create or replace function apply_swipe(p_user_id text, p_recipe_id text, p_direction text, p_deck_id text)
returns recipe_priority as $$
declare result recipe_priority;
begin
  insert into recipe_priority (user_id, recipe_id) values (p_user_id, p_recipe_id)
    on conflict (user_id, recipe_id) do nothing;

  if p_direction = 'right' then
    update recipe_priority set priority = priority + 1, favorited = true, updated_at = now()
      where user_id = p_user_id and recipe_id = p_recipe_id;
  elsif p_direction = 'left' then
    update recipe_priority set priority = priority - 1, updated_at = now()
      where user_id = p_user_id and recipe_id = p_recipe_id;
  else -- 'down'
    update recipe_priority set removed_at = now(), updated_at = now()
      where user_id = p_user_id and recipe_id = p_recipe_id;
  end if;

  update recipe_priority set removed_at = coalesce(removed_at, now())
    where user_id = p_user_id and recipe_id = p_recipe_id and priority <= 0;

  insert into swipe_events (user_id, recipe_id, direction, deck_id)
    values (p_user_id, p_recipe_id, p_direction, p_deck_id);

  select * into result from recipe_priority where user_id = p_user_id and recipe_id = p_recipe_id;
  return result;
end;
$$ language plpgsql;

grant execute on function apply_swipe(text, text, text, text) to anon;
