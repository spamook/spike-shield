import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Two builds from the same code (see "Two builds" in fakeapp-scripts-work.md):
//   npm run build -- --outDir dist-plain            without the Shield, served on :4173
//   SHIELD=1 npm run build -- --outDir dist-shield  with the Shield, served on :4174
// With SHIELD=1 the install prompt's script tag goes into <head> before any other script.
const shieldTag =
  '<script src="http://localhost:8090/shield.js" data-site="idea-roaster" data-api="http://localhost:8090"></script>'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'spike-shield',
      transformIndexHtml: (html) =>
        process.env.SHIELD === '1' ? html.replace('<head>', `<head>\n    ${shieldTag}`) : html,
    },
  ],
  // Serve the production build the way Lovable's CDN would: `npx vite preview --outDir ... --port ...`
  preview: { strictPort: true },
})
