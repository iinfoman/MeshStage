import { useCallback, useEffect, useRef, useState } from 'react';
import {
  consumeRenderCredit,
  fetchProfile,
  getSupabase,
  InsufficientCreditsError,
  supabaseConfigured,
  type AccountProfile,
} from '../lib/supabase';

export type AuthStatus = 'disabled' | 'loading' | 'signed-out' | 'signed-in';

export interface AccountApi {
  status: AuthStatus;
  email: string | null;
  profile: AccountProfile | null;
  error: string | null;
  busy: boolean;
  /** Sends a magic link. Resolves once the mail is away, not once clicked. */
  signIn: (email: string) => Promise<void>;
  signInAnonymously: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Spends a credit server-side. Throws if the balance will not cover it. */
  spendCredit: (format: string, characterId: string | null) => Promise<AccountProfile>;
  refresh: () => Promise<void>;
  linkSent: boolean;
}

/**
 * Account state: session, profile and the credit balance.
 *
 * Without Supabase configured the hook reports `disabled` and the studio falls
 * back to its local demo tier, so the app still runs with no backend. With it
 * configured, the balance shown is whatever the database says — the client
 * never computes it.
 */
/**
 * Turns Supabase/network failures into something a user can act on.
 *
 * The raw failures are unhelpful at the UI: an unreachable project surfaces as
 * the browser's bare "Failed to fetch", and a disabled provider reads like a
 * bug rather than a project setting.
 */
function describeAuthError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Cannot reach the accounts service. Check your connection, or that VITE_SUPABASE_URL points at a running project.';
  }
  if (lower.includes('anonymous')) {
    return 'Guest accounts are turned off for this project. Enable Anonymous sign-ins in Supabase → Authentication → Providers, or sign in with email.';
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (lower.includes('signups not allowed') || lower.includes('disabled')) {
    return 'Sign-ups are disabled for this project. Enable them in Supabase → Authentication.';
  }
  return message;
}

export function useAccount(): AccountApi {
  const [status, setStatus] = useState<AuthStatus>(
    supabaseConfigured() ? 'loading' : 'disabled',
  );
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const next = await fetchProfile();
      if (mounted.current) setProfile(next);
    } catch (caught) {
      if (mounted.current) {
        setError(
          caught instanceof Error
            ? describeAuthError(caught.message)
            : 'Could not load your account.',
        );
      }
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    // Resolve the current session first, then keep following it. The listener
    // also fires after a magic-link redirect, which is how sign-in completes.
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted.current) return;
        setEmail(data.session?.user.email ?? null);
        setStatus(data.session ? 'signed-in' : 'signed-out');
        if (data.session) void loadProfile();
      })
      .catch((caught: unknown) => {
        // An unreachable project must not leave the UI stuck on "Checking…".
        if (!mounted.current) return;
        setStatus('signed-out');
        setError(
          caught instanceof Error ? describeAuthError(caught.message) : 'Accounts are unavailable.',
        );
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted.current) return;
      setEmail(session?.user.email ?? null);
      setStatus(session ? 'signed-in' : 'signed-out');
      setProfile(session ? profile : null);
      if (session) void loadProfile();
    });

    return () => subscription.subscription.unsubscribe();
    // `profile` intentionally omitted: including it would resubscribe on every
    // balance change and tear down the auth listener mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProfile]);

  const signIn = useCallback(async (address: string) => {
    const supabase = getSupabase();
    if (!supabase) return;

    setBusy(true);
    setError(null);
    setLinkSent(false);

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: window.location.origin },
    });

    if (!mounted.current) return;
    setBusy(false);

    if (authError) setError(describeAuthError(authError.message));
    else setLinkSent(true);
  }, []);

  const signInAnonymously = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;

    setBusy(true);
    setError(null);

    const { error: authError } = await supabase.auth.signInAnonymously();

    if (!mounted.current) return;
    setBusy(false);
    if (authError) setError(describeAuthError(authError.message));
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    if (mounted.current) {
      setProfile(null);
      setLinkSent(false);
    }
  }, []);

  const spendCredit = useCallback(async (format: string, characterId: string | null) => {
    const next = await consumeRenderCredit(format, characterId);
    if (mounted.current) setProfile(next);
    return next;
  }, []);

  return {
    status,
    email,
    profile,
    error,
    busy,
    linkSent,
    signIn,
    signInAnonymously,
    signOut,
    spendCredit,
    refresh: loadProfile,
  };
}

export { InsufficientCreditsError };
