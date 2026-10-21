"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

export type ConfirmModalProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  /** Optional detail shown as its own highlighted row (e.g. the DN number
   * of the note already in progress). */
  highlightLabel?: string;
  highlightValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

/**
 * In-app replacement for window.confirm, styled after ResponseModal:
 * same portal, backdrop, panel and footer language. Used for
 * "proceed anyway" warnings (e.g. starting a second note while one is
 * already in progress). Cancel is the safe default: it takes the focus,
 * and Escape / backdrop click also cancel.
 */
export function ConfirmModal({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  highlightLabel,
  highlightValue,
  confirmLabel = "Proceed anyway",
  cancelLabel = "Cancel",
}: ConfirmModalProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (!open) return;
    cancelBtnRef.current?.focus({ preventScroll: true });
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted || !open) return null;

  const panel = (
    <div className="fixed inset-0 z-[240] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Cancel and close dialog"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px] dark:bg-black/55"
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(88vh,36rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-2xl dark:shadow-black/40"
      >
        <div className="flex items-center gap-3 border-b border-[color:var(--app-border)] px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </span>
          <h2
            id={titleId}
            className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100"
          >
            {title}
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {message}
          </p>
          {highlightValue ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
              <span className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-200">
                {highlightLabel ?? "In progress"}
              </span>
              <span className="font-mono text-sm font-semibold text-amber-900 dark:text-amber-100">
                {highlightValue}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-[color:var(--app-border)] px-5 py-4">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[color:var(--app-border)] bg-transparent px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
