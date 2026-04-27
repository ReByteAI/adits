import { initSplitCompare } from "../effects/split-compare.js";

// Once per browser session, autoplay a left → right sweep when the lens
// scrolls into view, then settle at the default 50% comparison.
const SESSION_KEY = "adits-lens-autoplayed";

export function initLensEffect() {
	const container = document.getElementById("lens-comparison");
	if (!container) return;

	const instance = initSplitCompare(container, {
		defaultPosition: 50,
		// Matches CSS skewX(-5deg) on .split-divider — keeps the clip-path
		// from cutting into the cards now that they're pinned to their halves.
		skewAngle: 5
	});
	if (!instance) return;

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const alreadyPlayed = (() => {
		try {
			return sessionStorage.getItem(SESSION_KEY) === "1";
		} catch {
			return false;
		}
	})();

	if (alreadyPlayed || reduceMotion) return;

	// Pin the divider to the left edge so the "after" (clean) card is fully
	// visible before the sweep kicks off.
	instance.setPositionImmediate(0);

	const observer = new IntersectionObserver(
		(entries) => {
			if (!entries[0].isIntersecting) return;
			observer.disconnect();
			try {
				sessionStorage.setItem(SESSION_KEY, "1");
			} catch {
				/* Storage may be unavailable (private mode) — fail silently. */
			}
			// Brief beat so the user registers the "after" before the sweep starts.
			setTimeout(async () => {
				// Phase 1: left → right (the "polished sweep" the user sees first).
				await instance.autoplay({ from: 0, to: 100, duration: 1400 });
				// Phase 2: settle back to the comparison view at 50%.
				await instance.autoplay({
					from: 100,
					to: 50,
					duration: 700,
					easing: (t) => 1 - Math.pow(1 - t, 3)
				});
			}, 350);
		},
		{ threshold: 0.4 }
	);
	observer.observe(container);
}
