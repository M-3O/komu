"use client";

import { useState } from "react";

/**
 * A destructive action that asks first.
 *
 * Deleting a reward, a challenge or a moderation rule takes effect
 * immediately and cannot be undone, so a single misclick costs real
 * configuration. Every delete in the dashboard goes through here.
 *
 * The confirmation is two buttons rather than a modal: it needs no focus trap,
 * no portal and no backdrop, which keeps it easy to read. It also resets
 * itself once the action resolves, so a failed delete does not leave the
 * creator staring at a "are you sure?" that no longer refers to anything.
 */
export function ConfirmButton({
  action,
  label = "Delete",
  confirmLabel = "Delete anyway",
  question = "This cannot be undone.",
  className,
}: {
  action: () => Promise<void>;
  label?: string;
  confirmLabel?: string;
  question?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  const base = className ?? DEFAULT_CLASS;

  // Idle: a single button that arms the confirmation.
  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className={base}>
        {label}
      </button>
    );
  }

  // Armed: ask, then either confirm or step back.
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[color:var(--color-komu-muted)]">{question}</span>

      <form
        action={async () => {
          // Disarm first so a slow or failing action cannot leave the
          // confirmation on screen pointing at a row that may be gone.
          setArmed(false);
          await action();
        }}
      >
        <button
          type="submit"
          className="rounded-md border border-[color:var(--color-komu-live)] px-3 py-1.5 text-sm text-[color:var(--color-komu-live)] transition hover:bg-[color:var(--color-komu-live)]/10"
        >
          {confirmLabel}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-komu-surface-raised)]"
      >
        Cancel
      </button>
    </span>
  );
}

const DEFAULT_CLASS =
  "rounded-md border border-[color:var(--color-komu-border)] px-3 py-1.5 text-sm text-[color:var(--color-komu-muted)] transition hover:border-[color:var(--color-komu-live)] hover:text-[color:var(--color-komu-live)]";