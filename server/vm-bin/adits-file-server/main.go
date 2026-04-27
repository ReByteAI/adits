// adits-file-server is a static HTTP server that runs inside every
// Adits project's VM. It serves /code as a static tree on port 8080
// and injects a bridge <script> into every HTML response so the page
// can talk to the Adits host via postMessage across the cross-origin
// boundary.

package main

import (
	_ "embed"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Stamped at build time via `-ldflags="-X main.Version=..."`.
var Version = "v2"

//go:embed inject.js
var injectJS []byte

const injectBlock = `<!-- adits:inject v1 --><base href="/"><script src="/_adits/inject.js" defer></script>`

var (
	rootFlag = flag.String("root", "/code", "directory to serve")
	portFlag = flag.Int("port", 8080, "listen port")
	// Default to loopback. Hosted works because Portal's socat forwarder
	// targets the VM's localhost listener; local uses loopback to avoid
	// exposing the tree on the LAN.
	hostFlag = flag.String("host", "127.0.0.1", "listen host")
)

func main() {
	flag.Parse()

	// Override Go's stdlib MIME table where we disagree.
	for ext, typ := range map[string]string{
		".napkin": "application/json; charset=utf-8",
		".html":   "text/html; charset=utf-8",
		".htm":    "text/html; charset=utf-8",
		".js":     "application/javascript; charset=utf-8",
		".mjs":    "application/javascript; charset=utf-8",
		".json":   "application/json; charset=utf-8",
		".css":    "text/css; charset=utf-8",
		".svg":    "image/svg+xml; charset=utf-8",
		".wav":    "audio/wav",
		".m4a":    "audio/mp4",
		".webp":   "image/webp",
		".woff2":  "font/woff2",
	} {
		_ = mime.AddExtensionType(ext, typ)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/_adits/health", handleHealth)
	mux.HandleFunc("/_adits/version", handleVersion)
	mux.HandleFunc("/_adits/inject.js", handleInjectJS)
	mux.HandleFunc("/_adits/", handleReservedCatchall)
	mux.HandleFunc("/", handleStatic)

	addr := fmt.Sprintf("%s:%d", *hostFlag, *portFlag)
	log.Printf("adits-file-server %s listening on %s, serving %s", Version, addr, *rootFlag)
	if err := http.ListenAndServe(addr, logRequests(mux)); err != nil {
		log.Fatal(err)
	}
}

// logRequests wraps a handler with one log line per request.
func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		lrw := &loggingWriter{ResponseWriter: w, status: 200}
		h.ServeHTTP(lrw, r)
		log.Printf("%s %s %d %dB %s", r.Method, r.URL.Path, lrw.status, lrw.size, time.Since(start))
	})
}

type loggingWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (w *loggingWriter) WriteHeader(status int) { w.status = status; w.ResponseWriter.WriteHeader(status) }
func (w *loggingWriter) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	w.size += n
	return n, err
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, "ok")
}

func handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, Version)
}

func handleInjectJS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("ETag", `"`+Version+`"`)
	if match := r.Header.Get("If-None-Match"); match == `"`+Version+`"` {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(injectJS)))
		return
	}
	_, _ = w.Write(injectJS)
}

func handleReservedCatchall(w http.ResponseWriter, r *http.Request) {
	// Unknown /_adits/* path — reserved namespace for future tooling;
	// shadow any file that happens to sit at the same path on disk.
	http.NotFound(w, r)
}

func handleStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w)
		return
	}

	// Resolve request path to a filesystem path, rejecting anything
	// that escapes the root. filepath.Join + CleanPath handle `..`,
	// multi-slash, etc. — we then verify the absolute resolved path
	// is still under the absolute root.
	rootAbs, err := filepath.Abs(*rootFlag)
	if err != nil {
		http.Error(w, "server misconfigured", http.StatusInternalServerError)
		return
	}
	// Resolve the root's own symlinks so the containment check below
	// compares fully-canonical paths on both sides. Without this,
	// e.g. /tmp on macOS resolves to /private/tmp for the target but
	// not the root, and every request 403s.
	if r2, err := filepath.EvalSymlinks(rootAbs); err == nil {
		rootAbs = r2
	}
	clean := filepath.Clean("/" + r.URL.Path) // leading / ensures filepath.Clean treats it as absolute
	target := filepath.Join(rootAbs, clean)
	// Resolve symlinks before the containment check so a symlink
	// pointing outside the root gets blocked.
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		if os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}
		// Other error (permission, etc.) — treat as 404 to avoid
		// leaking information about the filesystem.
		http.NotFound(w, r)
		return
	}
	if !strings.HasPrefix(resolved+string(filepath.Separator), rootAbs+string(filepath.Separator)) && resolved != rootAbs {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	info, err := os.Stat(resolved)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if info.IsDir() {
		// Directory: try <dir>/index.html. No auto-generated listing.
		indexPath := filepath.Join(resolved, "index.html")
		indexInfo, err := os.Stat(indexPath)
		if err != nil || indexInfo.IsDir() {
			http.NotFound(w, r)
			return
		}
		resolved = indexPath
		info = indexInfo
	}

	// Ensure the final file is still under root (EvalSymlinks was on
	// the parent, but index.html could in theory be a symlink we just
	// appended to `resolved`).
	if !strings.HasPrefix(resolved+string(filepath.Separator), rootAbs+string(filepath.Separator)) && resolved != rootAbs {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")

	if isHTML(resolved) {
		serveHTML(w, r, resolved, info)
		return
	}

	// Non-HTML: use http.ServeFile for range + ETag + conditional GET handling.
	w.Header().Set("Cache-Control", "public, max-age=60")
	http.ServeFile(w, r, resolved)
}

func methodNotAllowed(w http.ResponseWriter) {
	w.Header().Set("Allow", "GET, HEAD")
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func isHTML(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".html" || ext == ".htm"
}

// serveHTML reads the file, injects the bridge <script>, and writes
// the result. Range requests on HTML are intentionally ignored — the
// body changes size after injection, so byte ranges aren't stable.
func serveHTML(w http.ResponseWriter, r *http.Request, path string, info os.FileInfo) {
	body, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "read failed", http.StatusInternalServerError)
		return
	}

	body = injectIntoHTML(body)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, must-revalidate")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
	// Weak ETag based on path + modtime + size; new content = new
	// content-length, which feeds into this implicitly.
	etag := fmt.Sprintf(`W/"%x-%x-%d"`, info.ModTime().UnixNano(), info.Size(), len(body))
	w.Header().Set("ETag", etag)
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(body)
}

// injectIntoHTML splices the bridge <script> tag into an HTML document.
// Strategy:
//  1. If the first 4 KB contains `<!-- adits-noinject -->`, return the
//     body untouched.
//  2. Else search for `<head` (case-insensitive) and splice after the
//     next `>`.
//  3. Else search for `<html` and splice after the next `>`, wrapped
//     in `<head>…</head>`.
//  4. Else splice at byte 0, wrapped in `<head>…</head>`.
//
// No HTML parsing — byte-level splice. Simple, fast, tolerant of
// malformed HTML the way browsers are.
func injectIntoHTML(body []byte) []byte {
	if scanWindow(body, 4096, []byte("<!-- adits-noinject -->")) >= 0 {
		return body
	}

	// Look for <head first (case-insensitive).
	if i := scanTagOpen(body, 8192, "head"); i >= 0 {
		if end := indexByteFrom(body, i, '>'); end >= 0 {
			return splice(body, end+1, []byte(injectBlock))
		}
	}

	// No <head — look for <html.
	if i := scanTagOpen(body, 8192, "html"); i >= 0 {
		if end := indexByteFrom(body, i, '>'); end >= 0 {
			return splice(body, end+1, []byte("<head>"+injectBlock+"</head>"))
		}
	}

	// No <head, no <html — splice at byte 0.
	return append([]byte("<head>"+injectBlock+"</head>"), body...)
}

// scanTagOpen finds the first opening tag `<name` (case-insensitive)
// in the first `limit` bytes of body, returning its byte offset, or
// -1 if not found.
func scanTagOpen(body []byte, limit int, name string) int {
	if limit > len(body) {
		limit = len(body)
	}
	window := body[:limit]
	// Lowercase copy for search; index into original positions.
	lower := make([]byte, len(window))
	for i, b := range window {
		if b >= 'A' && b <= 'Z' {
			lower[i] = b + 32
		} else {
			lower[i] = b
		}
	}
	needle := []byte("<" + name)
	idx := 0
	for {
		rel := indexBytesFrom(lower, idx, needle)
		if rel < 0 {
			return -1
		}
		// Confirm the next byte after `<name` is not a letter/digit
		// (so `<heading` doesn't match `<head`). Space, `>`, tab, `/`,
		// newline all fine.
		next := rel + len(needle)
		if next >= len(lower) {
			return -1
		}
		c := lower[next]
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
			return rel
		}
		idx = next
	}
}

// scanWindow returns the first occurrence of needle within body[:limit],
// or -1. Pure byte search; no case normalization.
func scanWindow(body []byte, limit int, needle []byte) int {
	if limit > len(body) {
		limit = len(body)
	}
	return indexBytesFrom(body[:limit], 0, needle)
}

func indexBytesFrom(hay []byte, from int, needle []byte) int {
	if from >= len(hay) {
		return -1
	}
	sub := hay[from:]
	// stdlib bytes.Index, but we don't want to import bytes just for
	// this. Inline the naive search — inputs are small (8 KB max).
outer:
	for i := 0; i+len(needle) <= len(sub); i++ {
		for j := 0; j < len(needle); j++ {
			if sub[i+j] != needle[j] {
				continue outer
			}
		}
		return from + i
	}
	return -1
}

func indexByteFrom(hay []byte, from int, b byte) int {
	for i := from; i < len(hay); i++ {
		if hay[i] == b {
			return i
		}
	}
	return -1
}

func splice(body []byte, at int, insert []byte) []byte {
	out := make([]byte, 0, len(body)+len(insert))
	out = append(out, body[:at]...)
	out = append(out, insert...)
	out = append(out, body[at:]...)
	return out
}
