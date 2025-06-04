import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
  }
};

export default nextConfig;
