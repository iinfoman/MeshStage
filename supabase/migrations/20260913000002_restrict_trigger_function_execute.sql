-- `handle_new_user` is a trigger function. PostgREST exposes anything in the
-- `public` schema as an RPC endpoint, so it was reachable at
-- /rest/v1/rpc/handle_new_user by anon and authenticated alike. It only ever
-- runs as a trigger, so no client role needs EXECUTE on it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- The trigger itself runs as the table owner, so it is unaffected.
-- `consume_render_credit` deliberately keeps EXECUTE for `authenticated`:
-- that is the sanctioned, balance-checked spend path.
