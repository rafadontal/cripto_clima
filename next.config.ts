import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
  },
  compiler: {
    // Preserve console logs in production
    removeConsole: false
  }
};

export default nextConfig;
