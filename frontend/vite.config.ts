import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

function manualChunks(id: string) {
  if (!id.includes('node_modules')) return

  if (
    id.includes('react-syntax-highlighter')
    || id.includes('/refractor/')
    || id.includes('/prismjs/')
  ) {
    return 'markdown-syntax'
  }

  if (
    id.includes('react-markdown')
    || id.includes('/remark-')
    || id.includes('/rehype-')
    || id.includes('/unified/')
    || id.includes('/mdast-')
    || id.includes('/hast-')
    || id.includes('/micromark')
    || id.includes('/vfile/')
    || id.includes('/property-information/')
    || id.includes('/space-separated-tokens/')
    || id.includes('/comma-separated-tokens/')
    || id.includes('/bail/')
  ) {
    return 'markdown-core'
  }

  if (
    id.includes('@dnd-kit')
    || id.includes('@tanstack/react-table')
  ) {
    return 'workspace-heavy'
  }

  if (id.includes('lucide-react')) {
    return 'icons'
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: /^three$/, replacement: path.resolve(__dirname, './src/components/practice/rocketboxThreeCoreShim.ts') },
    ],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:18080',
      '/ws': {
        target: 'ws://localhost:18080',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
    include: ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
})
