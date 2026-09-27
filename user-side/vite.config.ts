import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Two builds from the same code (see "Two builds" in fakeapp-scripts-work.md): the script tag is
// only inserted when SHIELD=1, so `npm run build` and `SHIELD=1 npm run build` can be served side
// by side without the Shield build touching the Shield-free one.
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
  // Serve the production build the way Lovable's CDN would: `npm run build && npx vite preview`.
  // Both builds are previewed at once (:4173 without the Shield, :4174 with it), each with its
  // own --outDir and --port passed on the CLI, so no fixed port/strictPort here.
  preview: {},
})
