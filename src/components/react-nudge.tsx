"use client";

import { useEffect, useState } from "react";

const EVERY_MS = 1000;

/**
 * Works around a React bug (react/react#37830, fixed upstream by #36134) in the React that
 * Next 15.5 bundles: in a production build a screen update can be dropped, so a save's new page
 * never shows (buttons stay disabled) or a link does nothing. Any later state update releases it,
 * so this makes a tiny one every second while the tab is visible. Renders nothing.
 * Remove once Next ships a React with the fix (check with the e2e stress test).
 */
export function ReactNudge() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    }, EVERY_MS);
    return () => clearInterval(id);
  }, []);
  return null;
}
