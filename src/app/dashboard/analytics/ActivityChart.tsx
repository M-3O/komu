import type { DailyBucket } from "@/lib/analytics/period";

/**
 * A daily activity chart, drawn as inline SVG.
 *
 * Hand-drawn rather than pulled from a charting library. The shape needed here
 * is a stack of daily bars, and a dependency would bring hundreds of
 * kilobytes and an API to learn for it. Everything below is arithmetic that can
 * be read in one sitting.
 *
 * The bars scale against the largest day in the range, not a fixed ceiling, so
 * a quiet week is not a flat line at the bottom of the chart.
 */

/** The height available for bars, in SVG units. */
const PLOT_HEIGHT = 120;

/** How wide each bar is, in SVG units. */
const BAR_WIDTH = 18;

/** The gap between bars. */
const BAR_GAP = 4;

/** The total width, derived so the last bar fits. */
const WIDTH = BAR_WIDTH + BAR_GAP;

export interface ActivityChartProps {
  buckets: DailyBucket[];
  /** Which measure to draw. */
  metric: "messages" | "xp" | "attendance" | "activeMembers";
  label: string;
}

const METRIC_LABELS: Record<ActivityChartProps["metric"], string> = {
  messages: "Messages",
  xp: "XP earned",
  attendance: "Stream attendance",
  activeMembers: "Active members",
};

const METRIC_STOPS: Record<ActivityChartProps["metric"], [string, string]> = {
  messages: ["#818cf8", "#4f46e5"],
  xp: ["#c4b5fd", "#7c3aed"],
  attendance: ["#6ee7b7", "#059669"],
  activeMembers: ["#93c5fd", "#2563eb"],
};

export function ActivityChart({ buckets, metric, label }: ActivityChartProps) {
  const peak = buckets.reduce((highest, bucket) => {
    const value = bucket[metric];
    return value > highest ? value : highest;
  }, 0);

  // With nothing recorded the chart draws flat rather than dividing by zero.
  const scale = peak > 0 ? PLOT_HEIGHT / peak : 0;
  const gradientId = `activity-${metric}`;
  const [start, end] = METRIC_STOPS[metric];
  const peakDay = buckets.find((bucket) => bucket[metric] === peak)?.day;

  return (
    <figure className="flex flex-col gap-2.5">
      <figcaption className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-[color:var(--color-komu-text)]">{label}</span>
        <span className="text-[10px] text-[color:var(--color-komu-muted)]">
          peak {peak.toLocaleString()} · {METRIC_LABELS[metric].toLowerCase()}
        </span>
      </figcaption>

      <div
        role="img"
        aria-label={`${label} per day. Peak ${peak.toLocaleString()} on ${
          peakDay ?? "no day"
        }.`}
        className="relative overflow-x-auto rounded-lg border border-[color:var(--color-komu-border)] bg-[color:var(--color-komu-bg)]/45 p-2"
      >
        <svg
          width={buckets.length * WIDTH}
          height={PLOT_HEIGHT + 8}
          className="block min-w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={start} />
              <stop offset="100%" stopColor={end} stopOpacity="0.45" />
            </linearGradient>
          </defs>

          {/* A light grid gives the eye something to measure against without
              competing with the data. */}
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              x2={buckets.length * WIDTH}
              y1={PLOT_HEIGHT * fraction}
              y2={PLOT_HEIGHT * fraction}
              stroke="var(--color-komu-border)"
              strokeOpacity="0.55"
              strokeDasharray="3 5"
            />
          ))}

          {buckets.map((bucket, index) => {
            const value = bucket[metric];
            // A recorded value of zero still gets a sliver, so an active day
            // is distinguishable from a day with no bar at all.
            const height = value > 0 ? Math.max(2, Math.round(value * scale)) : 1;

            return (
              <rect
                key={bucket.day}
                x={index * WIDTH}
                y={PLOT_HEIGHT - height}
                width={BAR_WIDTH}
                height={height}
                rx={3}
                fill={value > 0 ? `url(#${gradientId})` : "var(--color-komu-border)"}
              >
                <title>
                  {`${bucket.day}: ${value.toLocaleString()}`}
                </title>
              </rect>
            );
          })}
        </svg>

        {peak === 0 ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-[color:var(--color-komu-dim)]">
            No activity recorded in this range.
          </p>
        ) : null}
      </div>

      <p className="flex justify-between text-[10px] text-[color:var(--color-komu-muted)]">
        <span>{buckets[0]?.day}</span>
        <span>{buckets.at(-1)?.day}</span>
      </p>
    </figure>
  );
}
