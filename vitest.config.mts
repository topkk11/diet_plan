import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** 让测试也能用 @/ 路径别名（与 tsconfig 的 paths 保持一致） */
const rootDir = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': rootDir },
  },
})
