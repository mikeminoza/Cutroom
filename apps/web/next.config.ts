import { existsSync } from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'

const root = path.join(import.meta.dirname, '../..')

// One .env at the repository root serves both the web app and the worker in development.
const rootEnv = path.join(root, '.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

const nextConfig: NextConfig = {
  transpilePackages: ['@cutroom/shared'],
  serverExternalPackages: ['@electric-sql/pglite'],
  outputFileTracingRoot: root,
  turbopack: { root },
  images: { unoptimized: true },
  poweredByHeader: false,
}

export default nextConfig
