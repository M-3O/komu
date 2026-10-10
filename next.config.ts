import type { NextConfig } from "next";

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
};

export default nextConfig;
