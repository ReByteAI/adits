import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'static-page-rewrites',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const [pathOnly] = (req.url ?? '').split('?')
          // Canonical SPA routes: /projects (list) and /project/<id> (workspace).
          // Post-login redirect lives in public/index.html.
          const rewrites = {
            '/': '/index.html',
            '/projects': '/app.html',
            '/ui-elements': '/ui-elements.html',
            '/get-started': '/get-started.html',
            '/privacy': '/privacy.html',
            '/speaker-notes': '/speaker-notes.html',
            '/blog': '/blog.html',
          }
          if (rewrites[pathOnly]) req.url = rewrites[pathOnly]
          else if (pathOnly.startsWith('/project/')) req.url = '/app.html'
          // /blog/<slug> → public/blog/<slug>.html
          else if (/^\/blog\/[a-z0-9-]+$/.test(pathOnly)) req.url = `${pathOnly}.html`
          next()
        })
      },
    },
  ],
  publicDir: 'public',
  server: {
    host: '127.0.0.1',
    port: 4000,
    // Comma-separated list of extra hosts Vite should accept (e.g. a
    // Tailscale Funnel or ngrok hostname pointing at this dev server).
    allowedHosts: process.env.VITE_ALLOWED_HOSTS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [],
    proxy: {
      '/api/app': 'http://127.0.0.1:4001',
      '/proxy-pdf': {
        target: 'https://arxiv.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy-pdf/, ''),
      },
    },
  },
  build: {
    outDir: 'build',
    emptyOutDir: false,
    // Copy public/ → build/ so the Hono server can serve bundled samples,
    // CSS, fonts, the pdf worker, etc. as static assets.
    copyPublicDir: true,
    rollupOptions: {
      input: {
        app: 'app.html',
      },
    },
  },
})
