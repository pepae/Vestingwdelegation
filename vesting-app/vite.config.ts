import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// VITE_BASE_URL is set in GitHub Actions (e.g. '/repo-name/' for project pages).
// Defaults to '/' for local dev and custom-domain deployments.
export default defineConfig({
  base: process.env.VITE_BASE_URL ?? '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
})
