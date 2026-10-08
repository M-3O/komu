/**
 * Dashboard navigation, kept in one place so the sidebar and any future
 * command palette stay in sync (PRD section 8).
 */
export interface NavItem {
  href: string;
  label: string;
  /** Shown as unavailable until the matching phase is built. */
  phase: number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const DASHBOARD_NAV: NavSection[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Overview", phase: 0 },
      { href: "/dashboard/streams", label: "Channels", phase: 4 },
    ],
  },
  {
    title: "Engagement",
    items: [
      { href: "/dashboard/xp", label: "XP & Levels", phase: 6 },
      { href: "/dashboard/roles", label: "Roles", phase: 7 },
      { href: "/dashboard/leaderboards", label: "Leaderboards", phase: 8 },
    ],
  },
  {
    title: "Gamification",
    items: [
      { href: "/dashboard/rewards", label: "Rewards", phase: 9 },
      { href: "/dashboard/challenges", label: "Challenges", phase: 10 },
      { href: "/dashboard/achievements", label: "Achievements", phase: 11 },
    ],
  },
  {
    title: "Management",
    items: [
      { href: "/dashboard/moderation", label: "Moderation", phase: 12 },
      { href: "/dashboard/analytics", label: "Analytics", phase: 13 },
    ],
  },
];