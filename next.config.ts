import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  experimental: {
    logging: {
      level: 'verbose',
    },
  },
  // Ensure server-side logging is enabled
  serverRuntimeConfig: {
    // Will only be available on the server side
    logging: true,
  },
  // Ensure client-side logging is enabled
  publicRuntimeConfig: {
    // Will be available on both server and client
    logging: true,
  },
};

export default nextConfig;
