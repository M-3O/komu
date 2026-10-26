import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  Gamepad2,
  Radio,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/** Join conditional class names without pulling in a dependency. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export type Tone = "accent" | "violet" | "success" | "warning" | "danger" | "neutral";

const ICON_TONES: Record<Tone, string> = {
  accent: "border-indigo-400/25 bg-indigo-500/10 text-indigo-300",
  violet: "border-violet-400/25 bg-violet-500/10 text-violet-300",
  success: "border-emerald-400/25 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-400/25 bg-amber-500/10 text-amber-300",
  danger: "border-red-400/25 bg-red-500/10 text-red-300",
  neutral: "border-[color:var(--color-komu-border-muted)] bg-white/[0.03] text-[color:var(--color-komu-muted)]",
};

const CHIP_TONES: Record<Tone, string> = {
  accent: "komu-chip-accent",
  violet: "border-violet-400/35 bg-violet-500/10 text-violet-300",
  success: "komu-chip-success",
  warning: "komu-chip-warning",
  danger: "komu-chip-danger",
  neutral: "",
};

export function IconTile({
  icon: Icon,
  tone = "accent",
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
        ICON_TONES[tone],
        className,
      )}
      aria-hidden
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="komu-eyebrow">{eyebrow}</p> : null}
        <h1 className="mt-2 text-[28px] font-bold leading-[34px] tracking-[-0.025em] text-[color:var(--color-komu-text)] sm:text-[32px] sm:leading-[38px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--color-komu-muted)]">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "accent",
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("komu-card relative overflow-hidden p-5", className)}>
      <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-white/[0.025] blur-2xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="komu-label">{label}</p>
          <p className="komu-metric mt-3 truncate">{value}</p>
          {hint ? (
            <div className="mt-1.5 text-xs leading-5 text-[color:var(--color-komu-muted)]">
              {hint}
            </div>
          ) : null}
        </div>
        <IconTile icon={icon} tone={tone} />
      </div>
      {footer ? <div className="relative mt-4">{footer}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  icon,
  action,
  children,
  className,
  contentClassName,
  flush = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  /** Drop the body padding for edge-to-edge tables. */
  flush?: boolean;
}) {
  return (
    <section className={cn("komu-card min-w-0 overflow-hidden", className)}>
      {title || action ? (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-0 pt-5 sm:px-6 sm:pt-6">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? <IconTile icon={icon} /> : null}
            <div className="min-w-0">
              {title ? (
                <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-[color:var(--color-komu-text)]">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p className="mt-0.5 text-xs leading-5 text-[color:var(--color-komu-muted)]">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}

      <div
        className={cn(
          flush ? "px-0 pb-0" : "p-5 sm:p-6",
          title || action ? "pt-4" : "",
          contentClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("komu-chip", CHIP_TONES[tone], className)}>
      {dot ? (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "success" ? "bg-emerald-400" : "bg-current",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

export function StatusDot({
  tone = "success",
  pulse = false,
}: {
  tone?: "success" | "warning" | "danger" | "neutral";
  pulse?: boolean;
}) {
  const color = {
    success: "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,.6)]",
    warning: "bg-amber-400",
    danger: "bg-red-400",
    neutral: "bg-slate-500",
  }[tone];

  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse ? (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", color)} />
      ) : null}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}

export function ProgressBar({
  value,
  max = 100,
  tone = "accent",
  className,
}: {
  value: number;
  max?: number;
  tone?: "accent" | "violet" | "success" | "warning";
  className?: string;
}) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = {
    accent: "bg-indigo-500",
    violet: "bg-violet-500",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
  }[tone];

  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-white/[0.06]", className)}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", fill)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function ProgressRing({
  value,
  size = 96,
  label,
  tone = "accent",
}: {
  value: number;
  size?: number;
  label?: ReactNode;
  tone?: "accent" | "success";
}) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * circumference;
  const color = tone === "success" ? "#10b981" : "#6366f1";

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(clamped)} percent complete`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(148,163,184,.12)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display text-lg font-bold leading-5 text-[color:var(--color-komu-text)]">
          {label ?? `${Math.round(clamped)}%`}
        </span>
        <span className="komu-label mt-0.5 text-[9px]">complete</span>
      </span>
    </div>
  );
}

export function EmptyState({
  icon: Icon = Radio,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-[color:var(--color-komu-border-muted)] bg-white/[0.015] px-5 py-9 text-center",
        className,
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--color-komu-border-muted)] bg-[color:var(--color-komu-surface-raised)] text-[color:var(--color-komu-muted)]">
        <Icon className="h-5 w-5" strokeWidth={1.7} />
      </span>
      <p className="mt-3 font-display text-sm font-semibold text-[color:var(--color-komu-text)]">
        {title}
      </p>
      {description ? (
        <p className="mt-1 max-w-md text-xs leading-5 text-[color:var(--color-komu-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function FormField({
  label,
  hint,
  problem,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  problem?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="komu-label">{label}</span>
      {children}
      {problem ? (
        <span className="text-xs text-red-300" role="alert">
          {problem}
        </span>
      ) : hint ? (
        <span className="text-xs leading-5 text-[color:var(--color-komu-dim)]">{hint}</span>
      ) : null}
    </label>
  );
}

export function StatusMessage({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
  children: ReactNode;
}) {
  const styles = {
    success:
      "border-emerald-400/25 bg-emerald-500/[0.07] text-emerald-200",
    error: "border-red-400/25 bg-red-500/[0.07] text-red-200",
    info: "border-[color:var(--color-komu-border-muted)] bg-white/[0.025] text-[color:var(--color-komu-muted)]",
  }[tone];

  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5", styles)}
    >
      {tone === "info" ? null : <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <h3 className="font-display text-sm font-semibold text-[color:var(--color-komu-text)]">
        {children}
      </h3>
      {action}
    </div>
  );
}

/** Twitch and YouTube are brand marks, so they are drawn inline rather than
 * pulled from the generic icon set. */
function TwitchMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  );
}

function YouTubeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function KickMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M3 2h5v7l6-7h6l-8 10 8 10h-6l-6-7v7H3V2z" />
    </svg>
  );
}

export function ProviderIcon({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  if (provider === "TWITCH") return <TwitchMark className={className} />;
  if (provider === "YOUTUBE") return <YouTubeMark className={className} />;
  if (provider === "KICK") return <KickMark className={className} />;
  return <Gamepad2 className={className} strokeWidth={1.8} />;
}

export function providerLabel(provider: string): string {
  if (provider === "TWITCH") return "Twitch";
  if (provider === "YOUTUBE") return "YouTube";
  if (provider === "KICK") return "Kick";
  return provider;
}

export function providerTone(provider: string): Tone {
  if (provider === "TWITCH") return "violet";
  if (provider === "YOUTUBE") return "danger";
  if (provider === "KICK") return "success";
  return "neutral";
}

export function ProviderBadge({
  provider,
  children,
  className,
}: {
  provider: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-display text-[10px] font-bold uppercase tracking-[0.08em]",
        provider === "TWITCH" && "border-violet-400/30 bg-violet-500/10 text-violet-300",
        provider === "YOUTUBE" && "border-red-400/30 bg-red-500/10 text-red-300",
        provider === "KICK" && "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
        !["TWITCH", "YOUTUBE", "KICK"].includes(provider) &&
          "border-[color:var(--color-komu-border-muted)] bg-white/[0.03] text-[color:var(--color-komu-muted)]",
        className,
      )}
    >
      <ProviderIcon provider={provider} className="h-3 w-3" />
      {children ?? providerLabel(provider)}
    </span>
  );
}

export function PlatformTile({
  provider,
  className,
  ...props
}: {
  provider: string;
  className?: string;
} & ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
        provider === "TWITCH" && "border-violet-400/30 bg-violet-500/10 text-violet-300",
        provider === "YOUTUBE" && "border-red-400/30 bg-red-500/10 text-red-300",
        provider === "KICK" && "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
        !["TWITCH", "YOUTUBE", "KICK"].includes(provider) &&
          "border-[color:var(--color-komu-border-muted)] bg-white/[0.03] text-[color:var(--color-komu-muted)]",
        className,
      )}
      {...props}
    >
      <ProviderIcon provider={provider} className="h-5 w-5" />
    </span>
  );
}

export function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    // Dates render in Server Components and again during hydration. Pin the
    // zone so the two renders cannot disagree about the calendar day.
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export function toneForEnabled(enabled: boolean): Tone {
  return enabled ? "success" : "neutral";
}

export const PROVIDER_OPTIONS = ["TWITCH", "YOUTUBE", "KICK"] as const;
