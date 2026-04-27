/**
 * Entry point. Boots an HTTP server that
 *   1. Mounts the Hono app at `/api/app` (matches the Cloudflare Pages path
 *      so the existing frontend code — which hits `/api/app/*` — works
 *      unchanged behind either the dev Vite proxy or the prod same-service
 *      routing).
 *   2. Serves the Vite build output at root so one Cloud Run service owns
 *      both the SPA and the API.
 *
 * Single process. Same Node runtime for every request. No Pages-Functions /
 * DO / script_name / wrangler gymnastics.
 */

import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { env } from './env.js'
import { app as apiApp } from './routes.js'
import { startLocalFileServer } from './backend/local/file-server-process.js'
import { sweepZombiePromptsOnBoot } from './backend/local/task-runner.js'

// Wrapped in an async main() so the file body has no top-level await —
// tsx in production (e.g. inside the Cloud Run image) compiles modules
// with the CJS output format, which esbuild forbids top-level await on.
// The same code without the wrapper works under tsx's ESM path locally
// but fails to boot in the container.
async function main(): Promise<void> {
  if (env.ADITS_BACKEND === 'local') {
    await startLocalFileServer()
    await sweepZombiePromptsOnBoot()
  }

  const top = new Hono()

  top.route('/api/app', apiApp)

  // Static SPA. The Vite build emits an `app.html` shell plus hashed assets
  // (see `vite.config.js`). We map the canonical SPA paths to `app.html` and
  // let serveStatic handle the rest (CSS, JS, fonts). Anything else not
  // handled is handed through to serveStatic which 404s with an index-less
  // shell — we stay SPA-friendly by rewriting known SPA paths.
  top.get('/', serveStatic({ root: env.STATIC_DIR, path: 'index.html' }))
  top.get('/projects', serveStatic({ root: env.STATIC_DIR, path: 'app.html' }))
  top.get('/project/*', serveStatic({ root: env.STATIC_DIR, path: 'app.html' }))
  top.get('/ui-elements', serveStatic({ root: env.STATIC_DIR, path: 'ui-elements.html' }))
  top.get('/get-started', serveStatic({ root: env.STATIC_DIR, path: 'get-started.html' }))
  top.get('/questions-demo', serveStatic({ root: env.STATIC_DIR, path: 'questions-demo.html' }))
  top.get('*', serveStatic({ root: env.STATIC_DIR }))

  serve({ fetch: top.fetch, port: env.PORT }, info => {
    console.log(`[adits] listening on http://127.0.0.1:${info.port}`)
  })
}

void main().catch((err: Error) => {
  console.error('[adits] failed to boot:', err.message)
  process.exit(1)
})
