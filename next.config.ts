import type { NextConfig } from "next"
const config: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] }]
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : []), "better-sqlite3", "pg", "pg-native", "ssh2", "mssql", "tedious"]
    }
    return config
  },
}
export default config
