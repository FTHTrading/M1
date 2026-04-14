import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@treasury/types", "@treasury/config"],
  experimental: {
    serverComponentsExternalPackages: [],
  },
};

export default nextConfig;
