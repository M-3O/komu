"use client";

import { useActionState, type ReactNode } from "react";
import type { SeasonFormState } from "./actions";

export function SeasonForm({ action, children, className, confirm }: {
  action: (state: SeasonFormState, data: FormData) => Promise<SeasonFormState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} className={className} onSubmit={confirm ? (event) => {
      if (!window.confirm(confirm)) event.preventDefault();
    } : undefined}>
      <fieldset className="grid min-w-0 gap-3" disabled={pending} aria-busy={pending}>
        {children}
      </fieldset>
      <p className={state.error ? "mt-2 text-sm text-red-300" : "mt-2 text-sm text-emerald-300"} role="status">
        {pending ? "Saving…" : state.error ?? state.message}
      </p>
    </form>
  );
}
