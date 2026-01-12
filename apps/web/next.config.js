/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["shared"],
  // Enable standalone output for Docker deployments
  output: "standalone",
};

module.exports = nextConfig;


