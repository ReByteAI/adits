/**
 * Backend selector. Reads `ADITS_BACKEND` once at module load and exports the
 * chosen implementations. Route handlers import from this module and don't
 * know which backend they're running against.
 *
 * Phase 1 ships only the `rebyte` FileStore. `local` mode is a hard error
 * until LocalFileStore lands (Phase 2).
 */

import { env } from '../env.js'
import type { FileStore } from './file-store.js'
import type { FileServer } from './file-server.js'
import type { TaskRunner } from './task-runner.js'
import { rebyteFileStore } from './rebyte/file-store.js'
import { rebyteFileServer } from './rebyte/file-server.js'
import { rebyteTaskRunner } from './rebyte/task-runner.js'
import { localFileStore } from './local/file-store.js'
import { localFileServer } from './local/file-server.js'
import { localTaskRunner } from './local/task-runner.js'

function selectImpls(): { fileStore: FileStore; fileServer: FileServer; taskRunner: TaskRunner } {
  switch (env.ADITS_BACKEND) {
    case 'rebyte':
      return { fileStore: rebyteFileStore, fileServer: rebyteFileServer, taskRunner: rebyteTaskRunner }
    case 'local':
      return { fileStore: localFileStore, fileServer: localFileServer, taskRunner: localTaskRunner }
  }
}

const impls = selectImpls()

export const fileStore = impls.fileStore
export const fileServer = impls.fileServer
export const taskRunner = impls.taskRunner

export type { FileStore, FileEntry, ProjectRow } from './file-store.js'
export type { FileServer } from './file-server.js'
export type { TaskRunner, CreateTaskResult, TaskState, TaskContent } from './task-runner.js'
