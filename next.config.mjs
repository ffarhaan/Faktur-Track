/** @type {import('next').NextConfig} */
const buildTime = String(Date.now());

const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;

