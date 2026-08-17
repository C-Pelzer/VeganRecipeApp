-- Run this in the Supabase SQL editor. Additive only — creates the new
-- auth/household layer; does not touch any existing table. Requires the
-- Google provider to already be configured (Authentication > Providers)
-- since handle_new_user() fires on every auth.users insert regardless of
-- provider.

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  avatar_url text not null default '',
  household_id uuid references households (id),
  created_at timestamptz not null default now()
);

alter table households enable row level security;
alter table profiles enable row level security;

-- Auto-provision a profile row the moment someone signs in for the first
-- time, pulling what Google hands back in raw_user_meta_data.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Reads the caller's own household_id — every other table's RLS policy
-- (see scripts/reset-to-household-schema.sql) is scoped through this.
create or replace function current_household_id()
returns uuid as $$
  select household_id from profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public;

-- security definer so a not-yet-a-member can create/look up a household
-- without a public "read all households" policy.
create or replace function create_household(p_name text)
returns households as $$
declare result households;
begin
  insert into households (name) values (coalesce(nullif(trim(p_name), ''), 'My Household'))
    returning * into result;
  update profiles set household_id = result.id where id = auth.uid();
  return result;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function join_household(p_invite_code text)
returns households as $$
declare result households;
begin
  select * into result from households where invite_code = p_invite_code;
  if result.id is null then
    raise exception 'No household found for that invite code';
  end if;
  update profiles set household_id = result.id where id = auth.uid();
  return result;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function create_household(text) to authenticated;
grant execute on function join_household(text) to authenticated;

create policy "read own profile" on profiles for select to authenticated
  using (id = auth.uid());
create policy "update own profile" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Household RLS is scoped via profiles, so a member also needs to see the
-- other household members' profiles (display names/avatars in shared UI).
create policy "read household member profiles" on profiles for select to authenticated
  using (household_id = current_household_id());

create policy "read own household" on households for select to authenticated
  using (id = current_household_id());
