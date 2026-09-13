-- MeshStage accounts and server-enforced render credits.
--
-- The security model rests on one idea: the client is never granted write
-- access to its own balance. `profiles` has SELECT policies only, so the sole
-- path that can decrement credits is the SECURITY DEFINER function below,
-- which checks the balance and writes the ledger in one transaction.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'creator', 'studio')),
  credits_remaining integer not null default 10 check (credits_remaining >= 0),
  credits_total integer not null default 10,
  period_started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. Credits are mutated only by consume_render_credit().';

-- Append-only audit trail: what was rendered, when, and what it cost.
create table public.render_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  format text not null,
  cost integer not null default 1 check (cost > 0),
  character_id text,
  created_at timestamptz not null default now()
);

create index render_ledger_user_created_idx
  on public.render_ledger (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.render_ledger enable row level security;

-- Read-only for the owner. Deliberately no INSERT/UPDATE/DELETE policies:
-- with RLS on and no write policy, every client write is rejected.
create policy "profiles are readable by their owner"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "ledger entries are readable by their owner"
  on public.render_ledger for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Give every new auth user a profile with the free-tier allowance.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Spends one credit and records it, or fails. The row lock matters: without
-- it two concurrent exports could both read the last credit and both pass the
-- balance check.
create function public.consume_render_credit(
  p_format text,
  p_character_id text default null
)
returns table (credits_remaining integer, credits_total integer, plan text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_cost constant integer := 1;
  v_profile public.profiles;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_profile
    from public.profiles
   where id = v_user
     for update;

  if not found then
    raise exception 'No profile for this account' using errcode = 'P0002';
  end if;

  if v_profile.credits_remaining < v_cost then
    raise exception 'Insufficient render credits' using errcode = 'P0001';
  end if;

  update public.profiles
     set credits_remaining = public.profiles.credits_remaining - v_cost
   where id = v_user
   returning * into v_profile;

  insert into public.render_ledger (user_id, format, cost, character_id)
  values (v_user, p_format, v_cost, p_character_id);

  return query
    select v_profile.credits_remaining, v_profile.credits_total, v_profile.plan;
end;
$$;

revoke execute on function public.consume_render_credit(text, text) from public, anon;
grant execute on function public.consume_render_credit(text, text) to authenticated;

-- Plan changes belong to a payment webhook, never to the client. Granted to
-- service_role only, so a browser cannot upgrade itself for free.
create function public.apply_plan_change(
  p_user_id uuid,
  p_plan text,
  p_credits integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set plan = p_plan,
         credits_remaining = p_credits,
         credits_total = p_credits,
         period_started_at = now()
   where id = p_user_id;
end;
$$;

revoke execute on function public.apply_plan_change(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.apply_plan_change(uuid, text, integer) to service_role;
