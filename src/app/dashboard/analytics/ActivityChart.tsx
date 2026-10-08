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

export function ActivityChart({ buckets, metric, label }: ActivityChartProps) {
  const peak = buckets.reduce((highest, bucket) => {
    const value = bucket[metric];
    return value > highest ? value : highest;
  }, 0);

  // With nothing recorded the chart draws flat rather than dividing by zero.
  const scale = peak > 0 ? PLOT_HEIGHT / peak : 0;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-[color:var(--color-komu-muted)]">
          peak {peak.toLocaleString()} {METRIC_LABELS[metric].toLowerCase()}
        </span>
      </figcaption>

      <div
        role="img"
        aria-label={`${label} per day. Peak ${peak.toLocaleString()} on ${
          buckets.find((bucket) => bucket[metric] === peak)?.day ?? "no day"
        }.`}
        className="overflow-x-auto"
      >
        <svg
          width={buckets.length * WIDTH}
          height={PLOT_HEIGHT + 8}
          className="block"
          // Bars are drawn from the baseline, so this is the shared fill.
          fill="currentColor"
        >
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
                className={value > 0 ? "text-[color:var(--color-komu-accent)]" : "text-[color:var(--color-komu-border)]"}
              >
                <title>
                  {`${bucket.day}: ${value.toLocaleString()}`}
                </title>
              </rect>
            );
          })}
        </svg>
      </div>

      <p className="flex justify-between text-xs text-[color:var(--color-komu-muted)]">
        <span>{buckets[0]?.day}</span>
        <span>{buckets.at(-1)?.day}</span>
      </p>
    </figure>
  );
}