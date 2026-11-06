import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { charts: ['recharts'], markdown: ['react-markdown', 'remark-gfm'] } } },
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
  preview: { proxy: { '/api': 'http://localhost:8000' } },
})
