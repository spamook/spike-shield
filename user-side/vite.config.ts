import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Serve the production build the way Lovable's CDN would: `npm run build && npx vite preview`
  preview: { port: 4173, strictPort: true },
})
