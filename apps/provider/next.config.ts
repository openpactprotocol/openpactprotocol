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
};

export default nextConfig;
