import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
const sections = new Set([
  "#client-health",
  "#client-onboarding",
  "#client-feedback",
  "#client-growth",
  "#client-templates",
  "#client-activity",
  "#client-follow-ups",
  "#client-requests",
]);
// Each section retries a deep link once when its initial content finishes loading.
// This handles sections above the target changing height without trapping scrolling.
export function useClientSectionAnchor(
  clientId: string | undefined,
  ready: boolean,
) {
  const { hash } = useLocation();
  const positioned = useRef("");
  useEffect(() => {
    if (!clientId || !ready || !sections.has(hash)) return;
    const key = `${clientId}:${hash}`;
    if (positioned.current === key) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView({ block: "start" });
        positioned.current = key;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [clientId, ready, hash]);
}
