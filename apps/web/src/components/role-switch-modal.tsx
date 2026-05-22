"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

export type RoleSwitchSuccess = {
  ok: true;
  roleName: string;
  roleCode: string;
};

export type RoleSwitchFailure = {
  ok: false;
  roleName: string;
  roleCode: string;
  detail: string;
};

export type RoleSwitchFeedback = RoleSwitchSuccess | RoleSwitchFailure;

export type RoleSwitchModalProps = {
  feedback: RoleSwitchFeedback | null;
  onClose: () => void;
};

export function RoleSwitchModal({ feedback, onClose }: RoleSwitchModalProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!feedback) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [feedback, onClose]);

  useEffect(() => {
    if (!feedback) return;
    closeBtnRef.current?.focus({ preventScroll: true });
  }, [feedback]);

  useEffect(() => {
    if (!feedback) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [feedback]);

  if (!mounted || !feedback) return null;

  const isSuccess = feedback.ok;

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
        className="relative z-10 w-full max-w-sm overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] shadow-2xl dark:shadow-black/40"
      >
        <div
          className={
            isSuccess
              ? "border-b border-[var(--app-border)] bg-emerald-50/90 px-5 py-4 dark:bg-emerald-950/30"
              : "border-b border-[var(--app-border)] bg-red-50/90 px-5 py-4 dark:bg-red-950/25"
          }
        >
          <div className="flex items-start gap-3">
            <span
              className={
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
                (isSuccess
                  ? "bg-emerald-600 text-white dark:bg-emerald-500"
                  : "bg-red-600 text-white dark:bg-red-500")
              }
              aria-hidden
            >
              {isSuccess ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className={
                  "text-base font-semibold tracking-tight " +
                  (isSuccess
                    ? "text-emerald-950 dark:text-emerald-50"
                    : "text-red-950 dark:text-red-50")
                }
              >
                {isSuccess
                  ? `Switched to ${feedback.roleName}`
                  : "Couldn't switch role"}
              </h2>
              <p
                className={
                  "mt-0.5 font-mono text-xs uppercase tracking-wide " +
                  (isSuccess
                    ? "text-emerald-800/80 dark:text-emerald-200/80"
                    : "text-red-800/80 dark:text-red-200/80")
                }
              >
                {feedback.roleCode}
              </p>
            </div>
          </div>
        </div>

        <p className="px-5 py-4 text-sm text-slate-700 dark:text-slate-300">
          {isSuccess
            ? "The delivery note list was refreshed for this role. Search filters were cleared."
            : `${feedback.detail} Try again from the account menu.`}
        </p>

        <div className="flex justify-end border-t border-[var(--app-border)] px-5 py-3.5">
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className={
              isSuccess
                ? "btn-delta-primary rounded-lg px-4 py-2 text-sm font-semibold shadow-sm"
                : "rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            }
          >
            {isSuccess ? "Continue" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
