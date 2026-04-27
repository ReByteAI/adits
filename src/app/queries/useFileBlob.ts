import { useQuery } from '@tanstack/react-query'
import { fetchFileBlob } from '../api.ts'

/**
 * Cached blob URL for a server-stored file.
 *
 * The query is keyed by `['file-blob', fileId]` and returns a
 * `blob:` URL string created via `URL.createObjectURL`. Because
 * `staleTime: Infinity` is set and file ids are content-addressed by
 * the server, the same fileId always returns the same cached URL
 * without a second fetch. This is the structural fix for the
 * CardGrid preview flicker: consumers no longer see a `<img src>`
 * attribute change across file-list refetches.
 *
 * Cleanup is handled centrally by the query cache subscriber in
 * `query-client.ts`, which calls `URL.revokeObjectURL` when an
 * entry is evicted (`gcTime`, manual `removeQueries`, or
 * `clear()`).
 *
 * Pass `enabled: false` to skip the query entirely — used by
 * `FileCard` for optimistic local uploads (which carry their own
 * local `URL.createObjectURL(file)` in `FileData.thumb`) and for
 * file types that don't need a blob preview (links, tasks).
 */
export function useFileBlob(fileId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['file-blob', fileId],
    queryFn: async () => {
      const blob = await fetchFileBlob(fileId)
      return URL.createObjectURL(blob)
    },
    enabled: !!fileId && options?.enabled !== false,
    staleTime: Infinity,
    // gcTime: Infinity is set as a default in `query-client.ts`, so
    // both this observer AND the `ensureQueryData` call inside
    // `store.ts:lazyFetchFileBlobs` pick it up automatically. That
    // avoids a desync with the store's `FileData.thumb` string: the
    // entry is never evicted mid-session, so the URL the store holds
    // stays valid until `queryClient.clear()` runs on sign-out.
  })
}
