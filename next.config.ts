import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions cap request bodies at 1MB by default, so every real
      // photo was rejected by the framework before the upload action ran.
      // Keep this at or above the largest size the actions allow themselves
      // (menu item images 5MB, tenant logo 3MB).
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
