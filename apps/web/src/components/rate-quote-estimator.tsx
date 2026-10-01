"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getAccessToken } from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";

/** The shipper's chosen estimate — passed into the Mark shipped transition. */
export type RateQuoteSelection = {
  carrierCode: string;
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  currency: string;
  totalCharge: number;
};

type RateQuote = RateQuoteSelection & {
  transitDays: number | null;
  estimatedDelivery: string | null;
};

type QuotesResponse = {
  quotes: RateQuote[];
  notices: string[];
  packageCount: number;
  deliveryNoteCount: number;
  dnNumbers: string[];
};

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatTransit(q: RateQuote): string | null {
  if (q.transitDays != null) {
    return `${q.transitDays} day${q.transitDays === 1 ? "" : "s"} transit`;
  }
  if (q.estimatedDelivery) {
    const d = new Date(q.estimatedDelivery);
    if (!Number.isNaN(d.getTime())) {
      return `Est. delivery ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
  }
  return null;
}

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const btnSecondary =
  "border border-slate-300 bg-white px-3 py-1.5 text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800";
const btnPrimary =
  "bg-slate-900 px-4 py-1.5 text-white shadow-sm hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white";
const btnGhost =
  "border border-transparent px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";

export function RateQuoteEstimator({
  deliveryNoteId,
  selected,
  onSelect,
}: {
  deliveryNoteId: string;
  selected: RateQuoteSelection | null;
  onSelect: (quote: RateQuoteSelection | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuotesResponse | null>(null);
  const [picked, setPicked] = useState<RateQuote | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchQuotes = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setError("Not signed in.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setPicked(null);
    try {
      const res = await fetch(`${apiBase}/carrier-rates/quotes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deliveryNoteId }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<QuotesResponse> & {
        message?: string;
      };
      if (!res.ok) {
        setError(
          typeof data.message === "string" && data.message
            ? data.message
            : "Could not fetch rate estimates.",
        );
        return;
      }
      setResult({
        quotes: Array.isArray(data.quotes) ? data.quotes : [],
        notices: Array.isArray(data.notices) ? data.notices : [],
        packageCount: data.packageCount ?? 0,
        deliveryNoteCount: data.deliveryNoteCount ?? 0,
        dnNumbers: Array.isArray(data.dnNumbers) ? data.dnNumbers : [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [deliveryNoteId]);

  function openModal() {
    setOpen(true);
    void fetchQuotes();
  }

  function closeModal() {
    setOpen(false);
  }

  function confirmSelection() {
    if (!picked) return;
    onSelect({
      carrierCode: picked.carrierCode,
      carrierName: picked.carrierName,
      serviceCode: picked.serviceCode,
      serviceName: picked.serviceName,
      currency: picked.currency,
      totalCharge: picked.totalCharge,
    });
    closeModal();
  }

  return (
    <div>
      {selected ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
            <span className="truncate">
              {selected.carrierName} · {selected.serviceName} —{" "}
              <span className="font-semibold tabular-nums">
                {formatMoney(selected.totalCharge, selected.currency)}
              </span>
            </span>
          </span>
          <button
            type="button"
            onClick={openModal}
            className={`${btnBase} ${btnGhost} px-2 py-1`}
          >
            Change
          </button>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`${btnBase} ${btnGhost} px-2 py-1`}
            title="Clear the selected estimate"
          >
            Clear
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className={`${btnBase} ${btnSecondary}`}
        >
          Estimate fee
        </button>
      )}

      {mounted && open
        ? createPortal(
            <div className="fixed inset-0 z-[240] flex items-end justify-center sm:items-center sm:p-6">
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px] dark:bg-black/60"
                onClick={() => {
                  if (!loading) closeModal();
                }}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Shipping rate estimates"
                className="relative z-10 flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-2xl sm:max-h-[min(88vh,40rem)] sm:rounded-2xl dark:shadow-black/40"
              >
                <div className="border-b border-[color:var(--app-border)] px-5 py-4">
                  <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                    Shipping rate estimates
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Live rates from FedEx and UPS, sorted by price. Pick one to
                    attach it to this shipment when you mark it shipped.
                  </p>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                  {loading ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Fetching live rates…
                    </p>
                  ) : error ? (
                    <p
                      role="alert"
                      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/35 dark:text-red-200"
                    >
                      {error}
                    </p>
                  ) : result ? (
                    <>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {result.packageCount} package
                        {result.packageCount === 1 ? "" : "s"}
                        {result.deliveryNoteCount > 1
                          ? ` · ${result.deliveryNoteCount} delivery notes`
                          : ""}
                      </p>
                      {result.notices.map((n, i) => (
                        <p
                          key={i}
                          role="status"
                          className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                        >
                          {n}
                        </p>
                      ))}
                      {result.quotes.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          No quotes came back. Check the carrier setup or try
                          again.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {result.quotes.map((q) => {
                            const transit = formatTransit(q);
                            const isPicked =
                              picked?.carrierCode === q.carrierCode &&
                              picked?.serviceCode === q.serviceCode;
                            return (
                              <li key={`${q.carrierCode}:${q.serviceCode}`}>
                                <button
                                  type="button"
                                  onClick={() => setPicked(q)}
                                  aria-pressed={isPicked}
                                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                                    isPicked
                                      ? "border-slate-900 bg-slate-900/[0.04] dark:border-slate-100 dark:bg-slate-100/[0.06]"
                                      : "border-slate-200/90 bg-white hover:border-slate-300 dark:border-slate-700/80 dark:bg-slate-950/50 dark:hover:border-slate-600"
                                  }`}
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                                      {q.carrierName} · {q.serviceName}
                                    </span>
                                    {transit ? (
                                      <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                                        {transit}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                                    {formatMoney(q.totalCharge, q.currency)}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--app-border)] px-5 py-4">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void fetchQuotes()}
                    className={`${btnBase} ${btnGhost}`}
                  >
                    Refresh
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={closeModal}
                      className={`${btnBase} ${btnGhost} px-4`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={loading || !picked}
                      onClick={confirmSelection}
                      className={`${btnBase} ${btnPrimary}`}
                    >
                      Use selected rate
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
