import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // 👈 AGREGAR ESTO
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
