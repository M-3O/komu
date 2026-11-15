"use client";

import { useActionState } from "react";
import { checkYouTubeBroadcastAction, recoverLiveAlertAction, type AlertFormState } from "./actions";

function Feedback({ state }: { state: AlertFormState }) {
  return (
    <p role="status" className={state.error ? "text-sm text-red-300" : "text-sm text-slate-300"}>
      {state.error ?? state.message}
    </p>
  );
}

export function RecoverAlertForm({ streamId, channelId, roleId, label }: {
  streamId: string; channelId?: string; roleId?: string | null; label: string;
}) {
  const [state, action, pending] = useActionState(recoverLiveAlertAction.bind(null, streamId), {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="intent" value={channelId ? "send" : "check"} />
      <input type="hidden" name="channelId" value={channelId ?? ""} />
      <input type="hidden" name="roleId" value={roleId ?? ""} />
      <button className="komu-btn komu-btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Working…" : label}</button>
      <Feedback state={state} />
    </form>
  );
}

export function YouTubeTrackingForm({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(checkYouTubeBroadcastAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <label className="grid gap-1 text-sm text-slate-300">
        YouTube broadcast link
        <input className="rounded-lg border border-slate-700 bg-slate-950 p-2" type="url"
          name="link" required maxLength={2048} placeholder="https://www.youtube.com/watch?v=…" />
      </label>
      <button className="komu-btn komu-btn-secondary" name="intent" value="track" disabled={pending}>Track broadcast</button>
      <button className="komu-btn komu-btn-secondary" name="intent" value="check" disabled={pending}>Check now</button>
      <Feedback state={state} />
    </form>
  );
}
