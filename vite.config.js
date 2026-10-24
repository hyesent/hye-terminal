import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // you already have public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      },
      devOptions: {
        enabled: true // lets you test PWA in dev mode
      }
    })
  ],
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  },
  define: {
    'global': 'globalThis', // Fix: isomorphic-git needs global
  },
  resolve: {
    alias: {
      buffer: 'buffer', // Fix: Polyfill Buffer for git
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis' // Fix: For esbuild
      }
    }
  }
})