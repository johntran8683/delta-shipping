"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

export type ResponseModalVariant = "error" | "success" | "info";

export type ResponseModalProps = {
  open: boolean;
  onClose: () => void;
  message: string;
  title?: string;
  variant?: ResponseModalVariant;
  confirmLabel?: string;
};

const DEFAULT_TITLES: Record<ResponseModalVariant, string> = {
  error: "Something went wrong",
  success: "Success",
  info: "Notice",
};

export function ResponseModal({
  open,
  onClose,
  message,
  title,
  variant = "error",
  confirmLabel = "OK",
}: ResponseModalProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted || !open) return null;

  const resolvedTitle = title ?? DEFAULT_TITLES[variant];

  const titleColor =
    variant === "error"
      ? "text-red-800 dark:text-red-200"
      : variant === "success"
        ? "text-emerald-900 dark:text-emerald-100"
        : "text-slate-900 dark:text-slate-100";

  const panel = (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px] dark:bg-black/55"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(88vh,36rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-2xl dark:shadow-black/40"
      >
        <div
          className={`border-b border-[color:var(--app-border)] px-5 py-4 ${titleColor}`}
        >
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {resolvedTitle}
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {message}
          </pre>
        </div>
        <div className="flex justify-end border-t border-[color:var(--app-border)] px-5 py-4">
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
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
