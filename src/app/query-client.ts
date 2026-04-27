import { QueryClient } from '@tanstack/react-query'

/**
 * Shared React Query client for the whole app.
 *
 * This client is currently used ONLY by the `useFileBlob` query that
 * backs CardGrid preview rendering. The rest of the app still talks
 * to the Zustand store at `src/app/store.ts`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The blob query doesn't benefit from aggressive refetching —
      // file content is content-addressed by id, so the URL never
      // stales. Other queries can override these defaults if we add
      // any later.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      // `gcTime: Infinity` prevents React Query from ever evicting a
      // cached entry during a session. This is required for
      // `['file-blob', id]` specifically: the store in `store.ts`
      // writes the blob URL string into `FileData.thumb`/`src` and
      // has no way to react to eviction, so a revoked URL would
      // leave a stale string in the store and flash a broken image
      // on the next render. Held until sign-out fires
      // `queryClient.clear()`, which the blob cleanup subscriber
      // observes to revoke all URLs in one pass.
      gcTime: Infinity,
    },
  },
})

/**
 * Revoke object URLs when their cache entry is evicted.
 *
 * React Query has no built-in eviction callback, so we subscribe to
 * the cache events and react to `removed`. The length guard matters:
 * the subscriber fires on every cache event across every key shape,
 * and `key[1]` would be `undefined` on a key like `['projects']`.
 */
queryClient.getQueryCache().subscribe(event => {
  if (event.type !== 'removed') return
  const key = event.query.queryKey
  if (!Array.isArray(key) || key.length < 2 || key[0] !== 'file-blob') return
  const url = event.query.state.data
  if (typeof url === 'string' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
})
