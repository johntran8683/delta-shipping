"use client";

import type { ReactNode } from "react";

const RUSH_TITLE = "Rush order";
const RUSH_SUBTITLE = "Supervisor expedite";
const RUSH_BODY_FALLBACK =
  "Flagged for expedited handling. The queue priority number is not changed.";

function RushBoltIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M9.5 1.5 3 9h4.5l-1 5.5L13 7H8.5l1-5.5Z" />
    </svg>
  );
}

type RushIndicatorProps = {
  /** `inline` sits beside DN text; `chip` is for status rows. */
  variant?: "inline" | "chip";
  /** Latest supervisor reason when marked rush (shown in tooltip). */
  rushReason?: string | null;
  className?: string;
};

/** Applies rush badge color tokens to children. */
export function RushIndicatorTheme({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center [--rush-bg:rgb(234_11_42/0.07)] [--rush-border:rgb(234_11_42/0.2)] [--rush-border-strong:rgb(234_11_42/0.35)] [--rush-fg:#9f1239] [--rush-shadow:0_1px_2px_rgb(234_11_42/0.1)] dark:[--rush-bg:rgb(234_11_42/0.16)] dark:[--rush-border:rgb(255_42_71/0.35)] dark:[--rush-border-strong:rgb(255_42_71/0.5)] dark:[--rush-fg:#fecdd3] ${className}`.trim()}
    >
      {children}
    </span>
  );
}

/**
 * Rush badge with a professional hover/focus tooltip (app surface + Delta accent).
 */
export function RushIndicator({
  variant = "inline",
  rushReason,
  className = "",
}: RushIndicatorProps) {
  const reasonText = rushReason?.trim() || null;
  const ariaLabel = reasonText
    ? `${RUSH_TITLE}. Reason: ${reasonText}`
    : `${RUSH_TITLE}. ${RUSH_BODY_FALLBACK}`;

  const trigger =
    variant === "chip" ? (
      <span
        tabIndex={0}
        className="inline-flex cursor-help items-center gap-1.5 rounded-md border border-[color:var(--rush-border)] bg-[color:var(--rush-bg)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--rush-fg)] shadow-[var(--rush-shadow)] outline-none transition-[border-color,box-shadow] duration-150 hover:border-[color:var(--rush-border-strong)] hover:shadow-[0_2px_8px_rgb(234_11_42/0.12)] focus-visible:ring-2 focus-visible:ring-[var(--app-brand)] focus-visible:ring-offset-1 dark:ring-offset-slate-950"
        aria-label={ariaLabel}
      >
        <span className="flex h-4 w-4 items-center justify-center rounded bg-[var(--app-brand)] text-white">
          <RushBoltIcon className="h-2.5 w-2.5" />
        </span>
        {RUSH_TITLE}
      </span>
    ) : (
      <span
        tabIndex={0}
        className="inline-flex cursor-help items-center gap-1 rounded-md border border-[color:var(--rush-border)] bg-[color:var(--rush-bg)] py-0.5 pl-1 pr-1.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--rush-fg)] shadow-[var(--rush-shadow)] outline-none transition-[border-color,box-shadow] duration-150 hover:border-[color:var(--rush-border-strong)] hover:shadow-[0_2px_8px_rgb(234_11_42/0.12)] focus-visible:ring-2 focus-visible:ring-[var(--app-brand)] focus-visible:ring-offset-1 dark:ring-offset-slate-950"
        aria-label={ariaLabel}
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-[var(--app-brand)] text-white">
          <RushBoltIcon className="h-2.5 w-2.5" />
        </span>
        Rush
      </span>
    );

  return (
    <span
      className={`group/rush relative inline-flex shrink-0 align-middle ${className}`.trim()}
    >
      {trigger}
      <RushTooltip rushReason={reasonText} />
    </span>
  );
}

function RushTooltip({ rushReason }: { rushReason: string | null }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-[100] w-[17rem] -translate-y-1/2 translate-x-1 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/rush:opacity-100 group-hover/rush:translate-x-0 group-focus-within/rush:opacity-100 group-focus-within/rush:translate-x-0 max-sm:hidden"
    >
      <span
        className="absolute right-full top-1/2 -mr-px h-0 w-0 -translate-y-1/2 border-y-[7px] border-r-[8px] border-y-transparent border-r-[color:var(--app-border)]"
        aria-hidden
      />
      <span
        className="absolute right-full top-1/2 mr-0.5 h-0 w-0 -translate-y-1/2 border-y-[6px] border-r-[7px] border-y-transparent border-r-[var(--app-surface)]"
        aria-hidden
      />

      <span className="block overflow-hidden rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-[0_10px_28px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.06)] ring-1 ring-black/[0.04] dark:shadow-[0_14px_36px_rgba(0,0,0,0.5)] dark:ring-white/[0.06]">
        <span className="block h-0.5 bg-[var(--app-brand)]" aria-hidden />
        <span className="block px-3.5 pb-3.5 pt-3">
          <span className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--app-brand)] text-white shadow-sm">
              <RushBoltIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[13px] font-semibold leading-snug text-slate-900 dark:text-slate-50">
                {RUSH_TITLE}
              </span>
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--app-brand)]">
                {RUSH_SUBTITLE}
              </span>
              {rushReason ? (
                <span className="mt-2.5 block rounded-lg border border-[color:var(--app-border)] bg-slate-50/90 px-2.5 py-2 dark:bg-slate-900/60">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">
                    Reason
                  </span>
                  <span className="mt-1 block text-xs font-medium leading-relaxed text-slate-800 dark:text-slate-200">
                    {rushReason}
                  </span>
                </span>
              ) : (
                <span className="mt-2.5 block border-t border-[color:var(--app-border)] pt-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {RUSH_BODY_FALLBACK}
                </span>
              )}
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
