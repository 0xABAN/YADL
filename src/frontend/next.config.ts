import type { NextConfig } from "next";

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
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/:path*" }];
  },
};

export default nextConfig;
