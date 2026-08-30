import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/", destination: "/auth", permanent: false },
      { source: "/new", destination: "/create", permanent: false },
      { source: "/upload", destination: "/create", permanent: false },
      { source: "/p/:id", destination: "/studio/:id", permanent: false },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/:path*" }];
  },
};

export default nextConfig;
