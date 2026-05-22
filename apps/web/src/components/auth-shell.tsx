import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/** Black band + Delta logo (login, home, choose-role). */
export function AuthBrandHeader() {
  return (
    <header className="shrink-0 border-b border-[var(--app-sidebar-border)] bg-[var(--app-sidebar-bg)] px-5 py-6 sm:px-8 sm:py-7">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-2 text-center">
        <Link href="/" className="inline-block" title="Delta Controls — Shipping">
          <Image
            src="/delta-controls-logo.png"
            alt="Delta Controls"
            width={200}
            height={48}
            className="h-10 w-auto max-w-[min(100%,13rem)] object-contain sm:h-11"
            priority
          />
        </Link>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--app-sidebar-muted)]">
          Shipping operations
        </p>
      </div>
    </header>
  );
}

export type AuthShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  /** Link above the card (e.g. back to home). */
  backLink?: { href: string; label: string };
  /** Narrower card for forms; wider for role list. */
  width?: "md" | "lg";
  footer?: ReactNode;
};

export function AuthShell({
  children,
  title,
  subtitle,
  backLink,
  width = "md",
  footer,
}: AuthShellProps) {
  const maxW = width === "lg" ? "max-w-lg" : "max-w-md";

  return (
    <div className="flex min-h-screen flex-col bg-[var(--app-canvas)] text-[var(--app-fg)]">
      <AuthBrandHeader />

      <main className="flex flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8 sm:py-12">
        <div className={`w-full ${maxW}`}>
          {backLink ? (
            <p className="mb-5">
              <Link
                href={backLink.href}
                className="text-sm font-medium text-slate-500 transition hover:text-[var(--app-brand)]"
              >
                {backLink.label}
              </Link>
            </p>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] shadow-[0_1px_2px_rgb(0_0_0/0.04),0_20px_40px_-24px_rgb(0_0_0/0.12)]">
            {(title || subtitle) && (
              <div className="border-b border-[var(--app-border)] bg-slate-50/80 px-6 py-5 dark:bg-slate-900/30">
                {title ? (
                  <h1 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                    <span
                      className="size-0 shrink-0 border-y-[5px] border-l-[7px] border-y-transparent border-l-[var(--app-brand)]"
                      aria-hidden
                    />
                    {title}
                  </h1>
                ) : null}
                {subtitle ? (
                  <p className="mt-2 pl-[1.125rem] text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            )}
            <div className="px-6 py-6 sm:px-7 sm:py-7">{children}</div>
          </div>

          {footer ? (
            <div className="mt-6 text-center text-xs text-slate-500">{footer}</div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
