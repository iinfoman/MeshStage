import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client, created lazily and only when configured.
 *
 * The publishable key is meant to ship in the bundle — it grants nothing on
 * its own. Every table in this schema has row-level security on, credits are
 * read-only to clients, and the only write path is a SECURITY DEFINER function
 * the browser cannot use to exceed its balance.
 */

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;

  client ??= createClient(
    import.meta.env.VITE_SUPABASE_URL as string,
    import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The studio is one page with no callback route, so the session comes
        // back in the URL hash after a magic-link click.
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    },
  );

  return client;
}

export interface AccountProfile {
  plan: 'free' | 'creator' | 'studio';
  creditsRemaining: number;
  creditsTotal: number;
}

export interface LedgerEntry {
  id: number;
  format: string;
  cost: number;
  characterId: string | null;
  createdAt: string;
}

export async function fetchProfile(): Promise<AccountProfile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('plan, credits_remaining, credits_total')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    plan: data.plan,
    creditsRemaining: data.credits_remaining,
    creditsTotal: data.credits_total,
  };
}

export class InsufficientCreditsError extends Error {}

/**
 * Spends one render credit server-side.
 *
 * Returns the authoritative balance. The client never computes this — it only
 * displays what the database reports, so a tampered UI cannot buy a render.
 */
export async function consumeRenderCredit(
  format: string,
  characterId: string | null,
): Promise<AccountProfile> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Accounts are not configured.');

  // The RPC returns a one-row table; untyped without generated DB types.
  const { data, error } = await supabase
    .rpc('consume_render_credit', { p_format: format, p_character_id: characterId })
    .maybeSingle<{ plan: AccountProfile['plan']; credits_remaining: number; credits_total: number }>();

  if (error) {
    // P0001 is the balance check in the function.
    if (error.message.includes('Insufficient render credits')) {
      throw new InsufficientCreditsError('No render credits left on this plan.');
    }
    throw new Error(error.message);
  }
  if (!data) throw new Error('Credit service returned nothing.');

  return {
    plan: data.plan,
    creditsRemaining: data.credits_remaining,
    creditsTotal: data.credits_total,
  };
}

export async function fetchLedger(limit = 20): Promise<LedgerEntry[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('render_ledger')
    .select('id, format, cost, character_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    format: row.format,
    cost: row.cost,
    characterId: row.character_id,
    createdAt: row.created_at,
  }));
}
