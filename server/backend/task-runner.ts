/**
 * The `TaskRunner` seam — local treats a task as a child `claude -p` process,
 * rebyte treats it as a relay REST resource.
 *
 * Streaming: producers (stdout / relay events) write per-prompt frames into
 * Postgres `frames` table. Readers poll. No StreamStore, no Redis pub/sub.
 * The single SSE endpoint (`/api/app/prompts/:pid/stream`) consumes
 * `streamFrames()` which polls the underlying source — local: the frames
 * table; rebyte: the relay's `/v1/tasks/:tid/events` SSE passthrough.
 */

/** Shape returned from `POST /projects/:pid/tasks`. */
export interface CreateTaskResult {
  id: string
  workspaceId?: string
  url?: string
  status?: string
  createdAt?: string
}

/** Minimal info for `GET /tasks/:tid`. */
export interface TaskState {
  id: string
  status: string
  title?: string
}

/** Full transcript shape returned by `GET /tasks/:tid/content`. The frames
 *  list is the prompt's transcript so far — for terminal prompts it's the
 *  whole thing; for running prompts it's a point-in-time snapshot the client
 *  uses as a starting point before opening the per-prompt SSE.
 *
 *  Local builds this from the `frames` table. Rebyte passes through whatever
 *  the relay's `/v1/tasks/:tid/content` returns; the relay's response keys
 *  are mapped 1:1. */
export interface TaskContent {
  id: string
  status: string
  prompts: Array<{
    id: string
    userPrompt: string
    executor: string
    model: string | null
    status: string
    submittedAt: string
    completedAt: string | null
    /** Frames in submission order. Each carries its `seq` so the SSE can
     *  resume from a specific point. */
    frames: Array<{ seq: number; data: unknown }>
    /** Populated iff the agent wrote `.adits/questions.json` on this turn. */
    formPayload: unknown
  }>
}

/** Items the per-prompt SSE yields. `frame` is a transcript chunk; `done`
 *  signals terminal status and ends the iteration. */
export type StreamItem =
  | { type: 'frame'; seq: number; data: unknown }
  | { type: 'done'; status: string }

export interface TaskRunner {
  create(opts: {
    userId: string
    projectId: string
    prompt: string
    extras?: Record<string, unknown>
  }): Promise<CreateTaskResult>
  get(userId: string, taskId: string): Promise<TaskState | null>
  getContent(userId: string, taskId: string, include?: string): Promise<TaskContent | null>
  followup(opts: {
    userId: string
    taskId: string
    prompt: string
    extras?: Record<string, unknown>
  }): Promise<{ promptId: string } | null>
  /** Cancel all currently-running prompts for a task. Local kills the child
   *  process; rebyte fires upstream cancel + aborts pipes. Returns null if
   *  the task is not found. */
  cancel(opts: { userId: string; taskId: string }): Promise<{ canceled: number } | null>
  /** Stream this prompt's frames after `fromSeq`, then yield a single `done`
   *  marker once the prompt reaches terminal status. The route wraps each
   *  yielded item in an SSE `data:` line; the runner doesn't know about HTTP. */
  streamFrames(opts: {
    userId: string
    promptId: string
    fromSeq: number
    signal: AbortSignal
  }): AsyncIterable<StreamItem>
}
