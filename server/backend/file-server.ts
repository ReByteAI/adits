/**
 * The `FileServer` seam.
 *
 * Each project has exactly one HTTP origin that serves its `/code` tree to
 * the browser. The server is a Go binary that does path-safe static serving
 * plus a handful of request-path rewrites (HTML injection, iframe asset
 * rerouting, etc.). In rebyte the binary runs inside a per-project VM on
 * `:8080`; in local it runs as a child of the Node process, pointed at the
 * shared projects directory.
 *
 * The interface is a single operation: synthesize the project's root URL.
 * It does NOT wake the VM, probe the child, or otherwise block on liveness
 * — sandboxes are treated as Lambdas, so the first real request to the URL
 * is what resumes a paused VM (the sandbox gateway auto-resumes on
 * connect; the local child is a long-lived process that boots with the
 * Node server). Returns null when the URL can't be synthesized at all
 * (e.g. rebyte project with no sandboxId yet) — clients render
 * "not available" rather than treating null as a transient state.
 */

export interface FileServer {
  rootUrl(opts: { userId: string; projectId: string }): Promise<string | null>
}
