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

type AddressView = {
  name: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string;
  countryCode: string;
};

type SuggestedAddress = {
  city: string | null;
  state: string;
  postalCode: string;
  countryCode: string;
};

type AddressCheck = {
  status: "ready" | "confirm" | "blocked";
  message: string | null;
  current: AddressView;
  suggestions: SuggestedAddress[];
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

function countryLabel(code: string): string {
  if (code === "US") return "United States";
  if (code === "CA") return "Canada";
  return code;
}

function placeLine(city: string | null, state: string | null): string | null {
  const parts = [city, state].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
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
  primaryButton,
}: {
  deliveryNoteId: string;
  selected: RateQuoteSelection | null;
  onSelect: (quote: RateQuoteSelection | null) => void;
  /** Render the "Estimate fee" trigger as the primary action. */
  primaryButton?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuotesResponse | null>(null);
  const [picked, setPicked] = useState<RateQuote | null>(null);
  const [addressCheck, setAddressCheck] = useState<AddressCheck | null>(null);
  const [step, setStep] = useState<"check" | "confirm" | "quotes">("check");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  /** Address confirmed for this dialog. Undefined means the saved ship-to. */
  const [quoteDestination, setQuoteDestination] = useState<
    SuggestedAddress | undefined
  >(undefined);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchQuotes = useCallback(
    async (destination?: SuggestedAddress) => {
      const token = getAccessToken();
      if (!token) {
        setError("Not signed in.");
        return;
      }
      setStep("quotes");
      setLoading(true);
      setError(null);
      setResult(null);
      setPicked(null);
      setAddressCheck(null);
      setQuoteDestination(destination);
      try {
        const res = await fetch(`${apiBase}/carrier-rates/quotes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            deliveryNoteId,
            ...(destination
              ? {
                  destination: {
                    city: destination.city ?? undefined,
                    stateOrProvinceCode: destination.state,
                    postalCode: destination.postalCode,
                    countryCode: destination.countryCode,
                  },
                }
              : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<QuotesResponse> & {
          message?: string | string[];
        };
        if (!res.ok) {
          setError(messageOf(data.message) ?? "Could not fetch rate estimates.");
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
    },
    [deliveryNoteId],
  );

  const checkAddress = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }
    setStep("check");
    setLoading(true);
    setError(null);
    setResult(null);
    setPicked(null);
    setAddressCheck(null);
    try {
      const res = await fetch(`${apiBase}/carrier-rates/address-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deliveryNoteId }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AddressCheck> & {
        message?: string | string[];
      };
      if (!res.ok) {
        setError(messageOf(data.message) ?? "Could not check the ship-to address.");
        return;
      }
      const check: AddressCheck = {
        status: data.status === "confirm" || data.status === "blocked" ? data.status : "ready",
        message: typeof data.message === "string" ? data.message : null,
        current: data.current ?? {
          name: null,
          street: null,
          city: null,
          state: null,
          postalCode: "",
          countryCode: "",
        },
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
      };
      if (check.status === "ready") {
        await fetchQuotes(undefined);
        return;
      }
      setSuggestionIndex(0);
      setStep("confirm");
      setAddressCheck(check);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }, [deliveryNoteId, fetchQuotes]);

  function openModal() {
    setOpen(true);
    void checkAddress();
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

  const confirming = addressCheck != null && !result;
  const canUseSuggestion =
    confirming &&
    addressCheck.status === "confirm" &&
    addressCheck.suggestions.length > 0;

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
          className={`${btnBase} ${primaryButton ? btnPrimary : btnSecondary}`}
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
                aria-label={confirming ? "Check the ship-to address" : "Shipping rate estimates"}
                className="relative z-10 flex max-h-[min(92dvh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-2xl sm:max-h-[min(88vh,44rem)] sm:rounded-2xl dark:shadow-black/40"
              >
                <div className="border-b border-[color:var(--app-border)] px-5 py-4">
                  <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                    {confirming ? "Check the ship-to address" : "Shipping rate estimates"}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {confirming
                      ? addressCheck.status === "blocked"
                        ? "A quote needs a postal code and a country on the ship-to."
                        : addressCheck.suggestions.length === 0
                          ? "No city or state can be suggested for this postal code. You can still estimate with the address as entered. The customer ship-to is not changed."
                          : "The postal code does not match the city and state on this note. Choose which address to quote. The customer ship-to is not changed."
                      : "Live rates from this note's carrier, sorted by price. Pick one to attach it to this shipment when you mark it shipped."}
                  </p>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                  {loading ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {step === "quotes"
                        ? "Fetching live rates…"
                        : "Checking the ship-to address…"}
                    </p>
                  ) : error ? (
                    <p
                      role="alert"
                      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/35 dark:text-red-200"
                    >
                      {error}
                    </p>
                  ) : confirming ? (
                    <AddressConfirm
                      check={addressCheck}
                      suggestionIndex={suggestionIndex}
                      onSelectSuggestion={setSuggestionIndex}
                    />
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
                  {confirming ? (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={closeModal}
                      className={`${btnBase} ${btnGhost} px-4`}
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        void (step === "quotes"
                          ? fetchQuotes(quoteDestination)
                          : checkAddress())
                      }
                      className={`${btnBase} ${btnGhost}`}
                    >
                      Refresh
                    </button>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    {confirming ? (
                      <>
                        {addressCheck.status === "confirm" ? (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => void fetchQuotes(undefined)}
                            className={`${btnBase} ${btnSecondary}`}
                          >
                            Estimate with the address as entered
                          </button>
                        ) : null}
                        {canUseSuggestion ? (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                              void fetchQuotes(
                                addressCheck.suggestions[suggestionIndex],
                              )
                            }
                            className={`${btnBase} ${btnPrimary}`}
                          >
                            Use this address
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
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

function messageOf(message: string | string[] | undefined): string | null {
  if (typeof message === "string" && message) return message;
  if (Array.isArray(message) && message.length > 0) return message.join(" ");
  return null;
}

function AddressConfirm({
  check,
  suggestionIndex,
  onSelectSuggestion,
}: {
  check: AddressCheck;
  suggestionIndex: number;
  onSelectSuggestion: (index: number) => void;
}) {
  return (
    <div className="space-y-3">
      {check.message ? (
        <p
          role="status"
          className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {check.message}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <AddressCard title="Address on the note" address={check.current} />
        {check.suggestions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-3 py-2.5 dark:border-slate-600">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Suggested address
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              No suggestion for this postal code.
            </p>
          </div>
        ) : check.suggestions.length === 1 ? (
          <AddressCard
            title="Suggested address"
            address={check.suggestions[0]}
            emphasized
          />
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Suggested addresses
            </legend>
            {check.suggestions.map((suggestion, index) => {
              const selected = index === suggestionIndex;
              return (
                <label
                  key={`${suggestion.state}-${suggestion.city ?? ""}-${index}`}
                  className={`flex cursor-pointer gap-2 rounded-xl border px-3 py-2.5 ${
                    selected
                      ? "border-slate-900 bg-slate-900/[0.04] dark:border-slate-100 dark:bg-slate-100/[0.06]"
                      : "border-slate-200/90 bg-white dark:border-slate-700/80 dark:bg-slate-950/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="suggested-address"
                    className="mt-1"
                    checked={selected}
                    onChange={() => onSelectSuggestion(index)}
                  />
                  <AddressLines address={suggestion} />
                </label>
              );
            })}
          </fieldset>
        )}
      </div>
    </div>
  );
}

function AddressCard({
  title,
  address,
  emphasized,
}: {
  title: string;
  address: AddressView | SuggestedAddress;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        emphasized
          ? "border-slate-900 bg-slate-900/[0.04] dark:border-slate-100 dark:bg-slate-100/[0.06]"
          : "border-slate-200/90 bg-white dark:border-slate-700/80 dark:bg-slate-950/50"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </p>
      <div className="mt-1">
        <AddressLines address={address} />
      </div>
    </div>
  );
}

function AddressLines({
  address,
}: {
  address: AddressView | SuggestedAddress;
}) {
  const named = "name" in address ? address : null;
  const cityState = placeLine(address.city, address.state);
  return (
    <div className="text-sm leading-relaxed text-slate-800 dark:text-slate-100">
      {named?.name ? <p className="font-medium">{named.name}</p> : null}
      {named?.street ? <p>{named.street}</p> : null}
      {cityState ? <p>{cityState}</p> : null}
      <p>
        {address.postalCode || "No postal code"}
        {address.countryCode ? ` · ${countryLabel(address.countryCode)}` : ""}
      </p>
    </div>
  );
}
