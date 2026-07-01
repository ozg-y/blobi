import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the built assets load from inside the Capacitor iOS bundle
// (files are served from the app package, not a web server root).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
})
