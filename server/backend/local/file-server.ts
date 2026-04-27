import { env } from '../../env.js'
import type { FileServer } from '../file-server.js'

/** Local FileServer: every project lives under the same localhost origin,
 *  keyed by projectId as the first path segment. The Go binary runs as a
 *  child of the Node server (see `local/file-server-process.ts`) and serves
 *  `${ADITS_DATA_DIR}/projects/` — so a URL of `<port>/<projectId>/<path>`
 *  resolves on disk to `projects/<projectId>/<path>`.
 *
 *  Pure URL synthesis: never touches the filesystem and never probes the
 *  child. The project dir is mkdir'd at create time (`localFileStore.
 *  createProject`); the child is started with the Node server and stays up
 *  for the process lifetime. If either invariant breaks, the first real
 *  request answers 404/ECONNREFUSED — that's an ops issue, not something
 *  we should retry per-request. */
export const localFileServer: FileServer = {
  async rootUrl({ projectId }) {
    return `http://localhost:${env.FILE_SERVER_PORT}/${encodeURIComponent(projectId)}`
  },
}
