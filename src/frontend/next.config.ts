import type { NextConfig } from "next";

// Vercel: set BACKEND_URL at build time (rewrites are fixed then).
// Local: unset → laptop API.
const backend = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

// must cover MAX_B (100MB) — default proxy buffer is 10MB and truncates large uploads
const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
  async redirects() {
    return [
      { source: "/", destination: "/auth", permanent: false },
      { source: "/new", destination: "/create", permanent: false },
      { source: "/p/:id", destination: "/studio/:id", permanent: false },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
