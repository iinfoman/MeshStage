import { useState } from 'react';
import { Button } from './Button';
import { CheckIcon, BoltIcon } from './icons';
import { useStudio } from '../state/StudioContext';
import { cn } from '../lib/utils';

/**
 * Sign-in sheet.
 *
 * Magic link is the primary path — no password to store or reset, and on a
 * phone it is one tap from the mail app. The anonymous option exists so the
 * credit system can be tried without handing over an address; it creates a
 * real auth user, so the balance is still enforced server-side.
 */
export function AccountSheet({ onClose }: { onClose: () => void }) {
  const { account } = useStudio();
  const [email, setEmail] = useState('');

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-title"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-obsidian-950/80 backdrop-blur-sm"
      />

      <div className="safe-bottom glass animate-rise relative w-full max-w-md rounded-t-sheet border-t border-white/10 px-5 pt-6">
        {account.status === 'signed-in' ? (
          <SignedIn onClose={onClose} />
        ) : account.linkSent ? (
          <LinkSent email={email} />
        ) : (
          <>
            <h2 id="account-title" className="text-[19px] leading-tight font-semibold text-ink-100">
              Sign in to render
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
              Render credits are tied to your account and counted on our servers, so your balance
              follows you between devices.
            </p>

            <label className="mt-5 block">
              <span className="mb-1.5 block text-[11px] font-semibold tracking-[0.13em] text-ink-500 uppercase">
                Email
              </span>
              <input
                id="account-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                enterKeyHint="go"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@studio.com"
                className="min-h-touch w-full rounded-2xl border border-obsidian-700 bg-obsidian-850/80 px-4 text-ink-100 placeholder:text-ink-600 focus:border-beam-500/50 focus:outline-none"
              />
            </label>

            {account.error && (
              <p role="alert" className="mt-2.5 text-[12px] leading-relaxed text-danger-400">
                {account.error}
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Button
                variant="primary"
                block
                disabled={!valid}
                loading={account.busy}
                onClick={() => void account.signIn(email.trim())}
              >
                Email me a sign-in link
              </Button>

              <Button variant="ghost" block onClick={() => void account.signInAnonymously()}>
                Continue as guest
              </Button>
            </div>

            <p className="mt-3 pb-1 text-[11px] leading-relaxed text-ink-600">
              A guest account still gets its own credits. Add an email later to keep them.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function LinkSent({ email }: { email: string }) {
  return (
    <div className="pb-2 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-ok-400/12 text-ok-400">
        <CheckIcon className="size-6" />
      </span>
      <h2 id="account-title" className="mt-3 text-[17px] font-semibold text-ink-100">
        Check your inbox
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
        We sent a sign-in link to <span className="text-ink-300">{email}</span>. Open it on this
        device and you'll come straight back here.
      </p>
    </div>
  );
}

function SignedIn({ onClose }: { onClose: () => void }) {
  const { account } = useStudio();
  const profile = account.profile;

  return (
    <div className="pb-1">
      <h2 id="account-title" className="text-[19px] font-semibold text-ink-100">
        Your account
      </h2>
      <p className="mt-1 truncate text-[13px] text-ink-500">
        {account.email ?? 'Guest account'}
      </p>

      {profile && (
        <dl className="mt-4 grid gap-2 rounded-2xl border border-white/[0.07] bg-obsidian-850/60 p-3.5">
          <Row label="Plan" value={profile.plan} />
          <Row
            label="Credits"
            value={`${profile.creditsRemaining} / ${profile.creditsTotal}`}
            highlight={profile.creditsRemaining === 0}
          />
        </dl>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-600">
        Credits are decremented by the database, not the browser. Changing this page's state does
        not grant renders.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <Button variant="secondary" block onClick={onClose}>
          Back to the studio
        </Button>
        <Button
          variant="ghost"
          block
          onClick={() => {
            void account.signOut();
            onClose();
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12px] text-ink-600">{label}</dt>
      <dd
        className={cn(
          'm-0 font-mono text-[12.5px] tabular-nums',
          highlight ? 'text-warn-400' : 'text-ink-100',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Compact status chip for the stage-4 sheet. */
export function AccountChip({ onOpen }: { onOpen: () => void }) {
  const { account } = useStudio();

  if (account.status === 'disabled') return null;

  const signedIn = account.status === 'signed-in';
  const credits = account.profile;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex min-h-touch w-full items-center gap-3 rounded-2xl border px-3.5 text-left',
        signedIn ? 'border-white/[0.07] bg-obsidian-850/60' : 'border-beam-500/35 bg-beam-500/[0.07]',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-xl',
          signedIn ? 'bg-obsidian-800 text-ink-500' : 'bg-beam-500/16 text-beam-400',
        )}
      >
        <BoltIcon className="size-[18px]" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink-100">
          {signedIn ? (account.email ?? 'Guest account') : 'Sign in to render video'}
        </span>
        <span className="block text-[11.5px] text-ink-500">
          {signedIn && credits
            ? `${credits.plan} · ${credits.creditsRemaining}/${credits.creditsTotal} credits, server-enforced`
            : account.status === 'loading'
              ? 'Checking your session…'
              : 'Credits follow your account across devices'}
        </span>
      </span>
    </button>
  );
}
