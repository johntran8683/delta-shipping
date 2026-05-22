"use client";

import { StatusBadge } from "@/components/operations-shell";
import {
  buildStatusHoverContent,
  type BuildStatusHoverInput,
  type StatusHoverSection,
} from "@/lib/dn-status-hover";

type StatusBadgeWithHoverProps = {
  status: string;
  isOpen?: boolean;
  hoverInput?: BuildStatusHoverInput;
  className?: string;
};

function SectionBlock({ section }: { section: StatusHoverSection }) {
  if (section.kind === "note") {
    return (
      <div className="rounded-lg border border-slate-200/90 bg-slate-50/90 px-3 py-2.5 dark:border-slate-600/80 dark:bg-slate-900/50">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-500">
          {section.label}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-800 dark:text-slate-200">
          {section.body}
        </p>
      </div>
    );
  }

  if (section.kind === "result") {
    return (
      <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/60 px-3 py-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/25">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-800/90 dark:text-emerald-400/90">
          {section.label}
        </p>
        {section.lines && section.lines.length > 0 ? (
          <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-emerald-950 dark:text-emerald-100/90">
            {section.lines.map((line) => (
              <li key={line} className="flex gap-2">
                <span
                  className="mt-[0.35rem] h-1 w-1 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs font-medium leading-relaxed text-emerald-950 dark:text-emerald-100/90">
            {section.body}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-500">
        {section.label}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
        {section.body}
      </p>
    </div>
  );
}

function StatusHoverCard({
  title,
  sections,
  compact,
}: {
  title: string;
  sections: StatusHoverSection[];
  compact?: boolean;
}) {
  const isPickPack =
    compact ||
    sections.every((s) => s.kind === "note" || s.kind === "result");

  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-0 top-full z-[100] mt-2 w-[16.5rem] max-w-[min(19rem,calc(100vw-2rem))] opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/status:opacity-100 group-hover/status:translate-y-0 group-focus-within/status:opacity-100 group-focus-within/status:translate-y-0 translate-y-1 max-sm:hidden"
    >
      <span className="block overflow-hidden rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-[0_10px_28px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.06)] ring-1 ring-black/[0.04] dark:shadow-[0_14px_36px_rgba(0,0,0,0.5)] dark:ring-white/[0.06]">
        <span className="block h-0.5 bg-[var(--app-brand)]" aria-hidden />
        <span className="block px-3.5 py-3">
          <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-50">
            {title}
          </span>
          <span
            className={`mt-2.5 flex flex-col ${isPickPack ? "gap-2" : "gap-2.5"}`}
          >
            {sections.map((s) => (
              <SectionBlock key={s.label} section={s} />
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}

function ariaSummary(sections: StatusHoverSection[]): string {
  return sections
    .map((s) => {
      const text =
        s.lines?.length ? s.lines.join(". ") : s.body ?? "";
      return `${s.label}: ${text}`;
    })
    .join(". ");
}

export function StatusBadgeWithHover({
  status,
  isOpen,
  hoverInput,
  className = "",
}: StatusBadgeWithHoverProps) {
  const hover = buildStatusHoverContent(status, hoverInput ?? {});

  if (!hover) {
    return (
      <span className={className}>
        <StatusBadge status={status} isOpen={isOpen} />
      </span>
    );
  }

  const compact = hover.sections.every(
    (s) => s.kind === "note" || s.kind === "result",
  );

  return (
    <span
      className={`group/status relative inline-flex ${className}`.trim()}
    >
      <span
        tabIndex={0}
        className="inline-flex cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-brand)] focus-visible:ring-offset-1 dark:ring-offset-slate-950"
        aria-label={`${hover.title}. ${ariaSummary(hover.sections)}`}
      >
        <StatusBadge status={status} isOpen={isOpen} />
      </span>
      <StatusHoverCard
        title={hover.title}
        sections={hover.sections}
        compact={compact}
      />
    </span>
  );
}
