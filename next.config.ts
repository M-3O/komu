import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * Next.js needs inline scripts for hydration and the RSC payload, and inline
 * styles for its own injected CSS, so `'unsafe-inline'` is required without
 * wiring a nonce through the proxy. The rest still buys real protection:
 * no framing, no plugins, a pinned base URI and form target, and images only
 * from this origin or HTTPS.
 *
 * `'unsafe-eval'` is a development-only concession to Turbopack's HMR.
 */
const isDev = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The dev server only allows `localhost` out of the box, so browsing via
  // 127.0.0.1 would block dev assets. Entries are bare hostnames, no scheme
  // and no port. Harmless in production, where the check does not apply.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Redundant with `frame-ancestors` for current browsers, kept for
          // anything that only understands the older header.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Ignored over plain HTTP, so it cannot break a local install. Has
          // no effect on a domain the first time it is visited over HTTP.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },
};

export default nextConfig;
