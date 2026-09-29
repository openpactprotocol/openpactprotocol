import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pap/protocol"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/a2a/:slug/.well-known/agent-card.json",
        destination: "/api/agent-card/:slug",
      },
    ];
  },
};

export default nextConfig;
