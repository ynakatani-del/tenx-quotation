import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// ビルドごとの版番号（gitの短縮ハッシュ。取得できなければタイムスタンプ）
function resolveBuildId() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return String(Date.now())
  }
}
const BUILD_ID = resolveBuildId()

export default defineConfig({
  plugins: [
    react(),
    // ビルド版番号を /version.json として出力（アプリが新バージョン検知に使う）
    {
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ build: BUILD_ID }),
        })
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
})
