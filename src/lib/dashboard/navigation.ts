/**
 * Dashboard navigation, kept in one place so the sidebar and any future
 * command palette stay in sync (PRD section 8).
 *
 * Every entry here has a page behind it. A link that 404s is worse than a
 * missing link, so nothing is listed until it works.
 */
export interface NavItem {
  href: string;
  label: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const DASHBOARD_NAV: NavSection[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Overview" },
      { href: "/dashboard/streams", label: "Channels" },
      { href: "/dashboard/alerts", label: "Stream Alerts" },
    ],
  },
  {
    title: "Engagement",
    items: [
      { href: "/dashboard/xp", label: "XP & Levels" },
      { href: "/dashboard/roles", label: "Roles" },
      { href: "/dashboard/leaderboards", label: "Leaderboards" },
    ],
  },
  {
    title: "Gamification",
    items: [
      { href: "/dashboard/rewards", label: "Rewards" },
      { href: "/dashboard/challenges", label: "Challenges" },
      { href: "/dashboard/achievements", label: "Achievements" },
    ],
  },
  {
    title: "Management",
    items: [
      { href: "/dashboard/moderation", label: "Moderation" },
      { href: "/dashboard/analytics", label: "Analytics" },
    ],
  },
];