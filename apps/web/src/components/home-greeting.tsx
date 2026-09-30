"use client";

import { useEffect, useState } from "react";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Time-aware landing headline. The server render and the first client render
 * both show the neutral fallback, and the effect swaps in the visitor's
 * local-time greeting after hydration — so there is never a hydration
 * mismatch from server/client timezone differences.
 */
export function HomeGreeting() {
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);
  return (
    <span>
      {greeting ?? "Welcome"} — let’s move{" "}
      <span className="text-[var(--app-brand)]">today’s shipments</span>.
    </span>
  );
}
