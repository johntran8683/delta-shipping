import Link from "next/link";
import { AuthBrandHeader } from "@/components/auth-shell";
import { SignInForm } from "@/components/sign-in-form";

function IconDelivery({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M4 12h16" />
    </svg>
  );
}

function IconSheet({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M10 13h4M10 17h4M10 9h2" />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

const highlights = [
  {
    Icon: IconDelivery,
    title: "Delivery notes",
    caption: "Queue, priorities, and status workflow",
  },
  {
    Icon: IconSheet,
    title: "Daily imports",
    caption: "Structured spreadsheet ingestion",
  },
  {
    Icon: IconShield,
    title: "Role-based access",
    caption: "Permissions aligned to your assignment",
  },
] as const;

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--app-canvas)] text-[var(--app-fg)]">
      <a
        href="#sign-in-panel"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--app-surface)] focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:outline-none focus:ring-2 focus:ring-[color:var(--app-brand)]"
      >
        Skip to sign in
      </a>

      <AuthBrandHeader />

      <main className="flex flex-1 flex-col justify-center px-5 py-14 sm:px-8 sm:py-16 lg:py-20">
          <div className="mx-auto grid w-full max-w-5xl gap-12 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-center lg:gap-16">
            <div className="max-w-xl lg:mx-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                Internal workspace
              </p>
              <h1 className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[1.65rem] font-semibold leading-snug tracking-tight text-slate-900 sm:text-3xl lg:text-[2rem] dark:text-white">
                <span
                  className="size-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-[var(--app-brand)]"
                  aria-hidden
                />
                <span>
                  Coordinate shipments with{" "}
                  <span className="text-[var(--app-brand)]">clarity</span> and
                  control.
                </span>
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-[0.9375rem] dark:text-slate-400">
                Sign in to work delivery notes, supervisor priorities, and
                supervised imports—scoped to what your role allows.
              </p>

              <ul className="mt-9 space-y-4 border-t border-[color:var(--app-border)] pt-8">
                {highlights.map(({ Icon, title, caption }) => (
                  <li key={title} className="flex gap-3 sm:gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--app-border)] bg-[var(--app-surface)] text-slate-600 shadow-[var(--app-header-shadow)] dark:text-slate-300">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {title}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {caption}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="mt-8 text-xs text-slate-500 dark:text-slate-500">
                Need a bookmarkable URL?{" "}
                <Link
                  href="/login"
                  className="font-medium text-[color:var(--app-brand)] underline decoration-slate-300/80 underline-offset-4 transition hover:opacity-90 dark:decoration-slate-600"
                >
                  Open the sign-in page
                </Link>
                .
              </p>
            </div>

            <div
              id="sign-in-panel"
              className="mx-auto w-full max-w-md scroll-mt-8 lg:mx-0 lg:max-w-none"
            >
              <div className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] shadow-[0_1px_2px_rgb(0_0_0/0.04),0_20px_40px_-24px_rgb(0_0_0/0.12)]">
                <div className="border-b border-[var(--app-border)] bg-slate-50/80 px-7 py-5 dark:bg-slate-900/30">
                  <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                    <span
                      className="size-0 border-y-[5px] border-l-[7px] border-y-transparent border-l-[var(--app-brand)]"
                      aria-hidden
                    />
                    Sign in
                  </h2>
                  <p className="mt-2 pl-[1.125rem] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Use your organization email and password.
                  </p>
                </div>
                <div className="px-7 py-7">
                  <SignInForm />
                </div>
              </div>
            </div>
          </div>
        </main>

      <footer className="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-surface)]/60 px-5 py-4 text-center text-[11px] text-slate-500 backdrop-blur-sm">
        © {new Date().getFullYear()} Delta Controls · Confidential internal use
      </footer>
    </div>
  );
}
