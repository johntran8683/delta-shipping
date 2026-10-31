"use client";

/** Pill badge for a customer's Active/Inactive state. Same pill shape and
 * tones as the shell's StatusBadge, but with a plain label — StatusBadge
 * runs its label through the delivery-note status formatter, which would
 * mangle "Active". */
export function CustomerActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        active
          ? "border-emerald-200/90 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}
