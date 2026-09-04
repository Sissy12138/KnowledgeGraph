/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** 为可双击打开的单文件 Mock 预览生成单一脚本和样式资源。 */
export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: false,
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    emptyOutDir: true,
    modulePreload: false,
    outDir: 'preview-dist',
    rollupOptions: {
      input: resolve(__dirname, 'preview-entry.html'),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
