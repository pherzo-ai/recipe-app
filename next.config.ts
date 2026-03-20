import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: '/start',
  env: {
    NEXT_PUBLIC_BASE_PATH: '/start',
  },
};

export default nextConfig;
