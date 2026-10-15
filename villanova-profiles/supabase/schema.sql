-- Run this once in the Supabase SQL editor (Dashboard > SQL Editor).

-- 1. Only @villanova.edu emails can create an account. This runs inside the
--    database, so it holds even if someone calls the Supabase Auth API
--    directly and skips the app.
create or replace function public.enforce_villanova_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or lower(new.email) !~ '^[a-z0-9._%+-]+@villanova\.edu$' then
    raise exception 'Only @villanova.edu email addresses can sign up.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_villanova_email on auth.users;
create trigger enforce_villanova_email
  before insert on auth.users
  for each row execute function public.enforce_villanova_email();

-- 2. Profiles: one row per person.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  year text not null check (year in ('Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate')),
  major text not null check (char_length(major) between 1 and 80),
  bio text not null default '' check (char_length(bio) <= 500),
  avatar_path text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "Insert own profile" on public.profiles;
create policy "Insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- 3. Photo bucket: one file per person at <user id>/avatar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Upload own photo" on storage.objects;
create policy "Upload own photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar');

drop policy if exists "Replace own photo" on storage.objects;
create policy "Replace own photo" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar')
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar');

drop policy if exists "Delete own photo" on storage.objects;
create policy "Delete own photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '/avatar');
