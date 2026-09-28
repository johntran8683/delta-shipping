"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { apiBase } from "@/lib/config";
import { getAccessToken, getActiveRoleCode, ACTIVE_ROLE_CHANGED_EVENT } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";

const CREATOR_ROLES = ["SUPERVISOR", "TEAM_LEAD", "CSA"];
const PRIORITY_ROLES = ["SUPERVISOR", "TEAM_LEAD"];

type CustomerOption = {
  id: string;
  sold_to_code: string;
  sold_to_name: string;
};

type ShipToOption = {
  id: string;
  ship_to_code: string;
  ship_to_name: string;
  street1: string | null;
  city: string | null;
  state_region: string | null;
  country_code: string | null;
};

type LineRow = {
  key: number;
  material_code: string;
  material_description: string;
  so_number: string;
  order_qty: string;
  unit_price: string;
  /** Description/price came from a previous DN (auto-fill); still editable. */
  autoFilled: boolean;
};

type DetailLine = {
  material_code: string | null;
  material_description: string | null;
  so_number: string | null;
  order_qty: string | null;
  unit_price: string | null;
};

type DetailPayload = {
  id: string;
  dn_number: string;
  current_status: string;
  customer_id: string | null;
  sold_to_code: string;
  sold_to_name: string;
  ship_to_location_id: string | null;
  ship_to_code: string;
  customer_po: string | null;
  po_date: string | null;
  requested_delivery_date: string | null;
  currency_code: string | null;
  is_rushed: boolean;
  latest_rush_reason: string | null;
  current_priority_no: number | null;
  lines: DetailLine[];
};

function inputClass(extra = "") {
  return `w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${extra}`;
}

function labelClass() {
  return "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200/90 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/80">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

let lineKey = 1;
function newLine(): LineRow {
  return {
    key: lineKey++,
    material_code: "",
    material_description: "",
    so_number: "",
    order_qty: "",
    unit_price: "",
    autoFilled: false,
  };
}

export function ManualDnForm({
  mode,
  dnId,
}: {
  mode: "create" | "edit";
  dnId?: string;
}) {
  const router = useRouter();
  const [roleCode, setRoleCode] = useState(() =>
    (getActiveRoleCode() ?? "").trim().toUpperCase(),
  );
  const canCreate = CREATOR_ROLES.includes(roleCode);
  const canSetPriority = PRIORITY_ROLES.includes(roleCode);

  useEffect(() => {
    const onRoleChanged = () =>
      setRoleCode((getActiveRoleCode() ?? "").trim().toUpperCase());
    window.addEventListener(ACTIVE_ROLE_CHANGED_EVENT, onRoleChanged);
    return () =>
      window.removeEventListener(ACTIVE_ROLE_CHANGED_EVENT, onRoleChanged);
  }, []);

  const [loadingDetail, setLoadingDetail] = useState(mode === "edit");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notNew, setNotNew] = useState(false);

  const [dnNumber, setDnNumber] = useState("");
  const [originalDnNumber, setOriginalDnNumber] = useState("");
  const [dnNumberError, setDnNumberError] = useState<string | null>(null);
  const [checkingDn, setCheckingDn] = useState(false);

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [ncCode, setNcCode] = useState("");
  const [ncName, setNcName] = useState("");
  const [ncContact, setNcContact] = useState("");
  const [ncPhone, setNcPhone] = useState("");
  const [ncEmail, setNcEmail] = useState("");

  const [shipTos, setShipTos] = useState<ShipToOption[]>([]);
  const [loadingShipTos, setLoadingShipTos] = useState(false);
  const [shipToId, setShipToId] = useState("");
  const [newShipToMode, setNewShipToMode] = useState(false);
  const [nsCode, setNsCode] = useState("");
  const [nsName, setNsName] = useState("");
  const [nsStreet1, setNsStreet1] = useState("");
  const [nsCity, setNsCity] = useState("");
  const [nsState, setNsState] = useState("");
  const [nsPostal, setNsPostal] = useState("");
  const [nsCountry, setNsCountry] = useState("");
  const [nsContact, setNsContact] = useState("");
  const [nsPhone, setNsPhone] = useState("");

  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [currency, setCurrency] = useState("CAD");

  const [lines, setLines] = useState<LineRow[]>([newLine()]);
  const [isRushed, setIsRushed] = useState(false);
  const [rushReason, setRushReason] = useState("");
  const [priorityNo, setPriorityNo] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const customerBoxRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authHeaders = useCallback((): HeadersInit => {
    const t = getAccessToken();
    const h: HeadersInit = { "Content-Type": "application/json" };
    if (t) (h as Record<string, string>).Authorization = `Bearer ${t}`;
    return h;
  }, []);

  const readError = useCallback(async (res: Response) => {
    const body = await res.json().catch(() => ({}));
    return formatApiErrorPayload(body) + (res.status ? ` (HTTP ${res.status})` : "");
  }, []);

  // ---- edit mode: load existing note ------------------------------------
  useEffect(() => {
    if (mode !== "edit" || !dnId) return;
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/delivery-notes/${dnId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setDetailError(await readError(res));
          return;
        }
        const d = (await res.json()) as DetailPayload;
        if (cancelled) return;
        if ((d.current_status ?? "").toUpperCase() !== "NEW") {
          setNotNew(true);
          return;
        }
        setDnNumber(d.dn_number);
        setOriginalDnNumber(d.dn_number);
        if (d.customer_id) {
          setCustomer({
            id: d.customer_id,
            sold_to_code: d.sold_to_code,
            sold_to_name: d.sold_to_name,
          });
        }
        if (d.ship_to_location_id) setShipToId(d.ship_to_location_id);
        setPoNumber(d.customer_po ?? "");
        setPoDate((d.po_date ?? "").slice(0, 10));
        setRequestedDate((d.requested_delivery_date ?? "").slice(0, 10));
        setCurrency(d.currency_code ?? "CAD");
        setIsRushed(!!d.is_rushed);
        setRushReason(d.latest_rush_reason ?? "");
        setPriorityNo(
          d.current_priority_no != null ? String(d.current_priority_no) : "",
        );
        setLines(
          (d.lines ?? []).map((l) => ({
            ...newLine(),
            material_code: l.material_code ?? "",
            material_description: l.material_description ?? "",
            so_number: l.so_number ?? "",
            order_qty: l.order_qty ?? "",
            unit_price: l.unit_price ?? "",
          })),
        );
      } catch (e) {
        if (!cancelled)
          setDetailError(e instanceof Error ? e.message : "Request failed");
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, dnId, router, readError]);

  // ---- customer search ----------------------------------------------------
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = customerQuery.trim();
    if (q.length < 2) {
      setCustomerResults([]);
      setCustomerOpen(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const token = getAccessToken();
      if (!token) return;
      setSearchingCustomers(true);
      try {
        const params = new URLSearchParams({
          q,
          page: "1",
          pageSize: "8",
        });
        const res = await fetch(`${apiBase}/customers?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = (await res.json()) as { items?: CustomerOption[] };
        setCustomerResults(body.items ?? []);
        setCustomerOpen(true);
      } catch {
        /* ignore */
      } finally {
        setSearchingCustomers(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [customerQuery]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        customerBoxRef.current &&
        !customerBoxRef.current.contains(e.target as Node)
      ) {
        setCustomerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // ---- ship-to locations for the chosen customer ---------------------------
  useEffect(() => {
    if (!customer || newCustomerMode) {
      setShipTos([]);
      return;
    }
    const token = getAccessToken();
    if (!token) return;
    let cancelled = false;
    setLoadingShipTos(true);
    (async () => {
      try {
        const res = await fetch(
          `${apiBase}/customers/${customer.id}/ship-to-locations`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { items?: ShipToOption[] };
        if (!cancelled) setShipTos(body.items ?? []);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingShipTos(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer, newCustomerMode]);

  function selectCustomer(c: CustomerOption) {
    setCustomer(c);
    setCustomerQuery("");
    setCustomerResults([]);
    setCustomerOpen(false);
    setShipToId("");
    setNewShipToMode(false);
  }

  function clearCustomer() {
    setCustomer(null);
    setNewCustomerMode(false);
    setShipTos([]);
    setShipToId("");
    setNewShipToMode(false);
  }

  // ---- DN number uniqueness check ------------------------------------------
  const checkDnNumber = useCallback(
    async (value: string) => {
      const v = value.trim();
      if (!v) {
        setDnNumberError(null);
        return;
      }
      if (mode === "edit" && v === originalDnNumber) {
        setDnNumberError(null);
        return;
      }
      const token = getAccessToken();
      if (!token) return;
      setCheckingDn(true);
      try {
        const params = new URLSearchParams({ dnNumber: v, pageSize: "5" });
        const res = await fetch(`${apiBase}/delivery-notes?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          items?: { dn_number: string }[];
        };
        const taken = (body.items ?? []).some(
          (i) => (i.dn_number ?? "").trim().toUpperCase() === v.toUpperCase(),
        );
        setDnNumberError(taken ? `Delivery note ${v} already exists.` : null);
      } catch {
        /* ignore */
      } finally {
        setCheckingDn(false);
      }
    },
    [mode, originalDnNumber],
  );

  // ---- part auto-fill -------------------------------------------------------
  async function fillFromHistory(index: number, code: string) {
    const c = code.trim();
    if (!c) return;
    const token = getAccessToken();
    if (!token) return;
    try {
      const params = new URLSearchParams({ code: c });
      const res = await fetch(
        `${apiBase}/delivery-notes/part-suggestion?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      const s = (await res.json()) as {
        material_description: string | null;
        unit_price: string | null;
      } | null;
      if (!s) return;
      setLines((prev) =>
        prev.map((l, i) => {
          if (i !== index) return l;
          return {
            ...l,
            material_description:
              l.material_description.trim() || (s.material_description ?? ""),
            unit_price: l.unit_price.trim() || (s.unit_price ?? ""),
            autoFilled: true,
          };
        }),
      );
    } catch {
      /* ignore */
    }
  }

  function updateLine(index: number, patch: Partial<LineRow>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }

  const dnTotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = parseFloat(l.order_qty);
        const p = parseFloat(l.unit_price);
        if (!Number.isFinite(q) || !Number.isFinite(p)) return sum;
        return sum + q * p;
      }, 0),
    [lines],
  );

  // ---- submit ---------------------------------------------------------------
  function validate(): string | null {
    if (!dnNumber.trim()) return "Delivery note number is required.";
    if (dnNumberError) return dnNumberError;
    if (!newCustomerMode && !customer)
      return "Choose a customer or enter a new one.";
    if (newCustomerMode && (!ncCode.trim() || !ncName.trim()))
      return "New customer needs a code and a name.";
    if (!newShipToMode && !shipToId)
      return "Choose a ship-to location or enter a new one.";
    if (newShipToMode && (!nsCode.trim() || !nsName.trim()))
      return "New ship-to needs a code and a name.";
    const usable = lines.filter((l) => l.material_code.trim());
    if (!usable.length) return "Add at least one line item with a part number.";
    for (const l of usable) {
      const q = parseFloat(l.order_qty);
      if (!Number.isFinite(q) || q <= 0)
        return `Quantity must be greater than 0 (part ${l.material_code.trim()}).`;
      if (l.unit_price.trim()) {
        const p = parseFloat(l.unit_price);
        if (!Number.isFinite(p) || p < 0)
          return `Unit price must be 0 or more (part ${l.material_code.trim()}).`;
      }
    }
    if (canSetPriority && priorityNo.trim()) {
      const p = parseInt(priorityNo.trim(), 10);
      if (!Number.isInteger(p) || p < 1)
        return "Priority must be a whole number of 1 or more.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const problem = validate();
    if (problem) {
      setSubmitError(problem);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const usable = lines.filter((l) => l.material_code.trim());
      const payload: Record<string, unknown> = {
        dn_number: dnNumber.trim(),
        customer_po: poNumber.trim() || undefined,
        po_date: poDate || undefined,
        requested_delivery_date: requestedDate || undefined,
        currency_code: currency.trim() || undefined,
        is_rushed: isRushed,
        rush_reason: isRushed && rushReason.trim() ? rushReason.trim() : undefined,
        lines: usable.map((l) => ({
          material_code: l.material_code.trim(),
          material_description: l.material_description.trim() || undefined,
          so_number: l.so_number.trim() || undefined,
          order_qty: parseFloat(l.order_qty),
          unit_price: l.unit_price.trim() ? parseFloat(l.unit_price) : undefined,
        })),
      };
      if (newCustomerMode) {
        payload.new_customer = {
          sold_to_code: ncCode.trim(),
          sold_to_name: ncName.trim(),
          default_contact_name: ncContact.trim() || undefined,
          default_phone: ncPhone.trim() || undefined,
          default_email: ncEmail.trim() || undefined,
        };
      } else {
        payload.customer_id = customer!.id;
      }
      if (newShipToMode) {
        payload.new_ship_to = {
          ship_to_code: nsCode.trim(),
          ship_to_name: nsName.trim(),
          street1: nsStreet1.trim() || undefined,
          city: nsCity.trim() || undefined,
          state_region: nsState.trim() || undefined,
          postal_code: nsPostal.trim() || undefined,
          country_code: nsCountry.trim() || undefined,
          contact_name: nsContact.trim() || undefined,
          phone: nsPhone.trim() || undefined,
        };
      } else {
        payload.ship_to_location_id = shipToId;
      }
      if (canSetPriority && priorityNo.trim()) {
        payload.priority_no = parseInt(priorityNo.trim(), 10);
      }

      const url =
        mode === "create"
          ? `${apiBase}/delivery-notes`
          : `${apiBase}/delivery-notes/${dnId}`;
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setSubmitError(await readError(res));
        return;
      }
      const created = (await res.json()) as { id: string };
      router.push(`/delivery-notes/${created.id}`);
    } catch (e2) {
      setSubmitError(e2 instanceof Error ? e2.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!canCreate) {
    return (
      <OperationsShell title={mode === "create" ? "New delivery note" : "Edit delivery note"}>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
          Delivery notes can only be {mode === "create" ? "created" : "edited"}{" "}
          when your active role is Supervisor, Team lead, or CSA.
        </div>
      </OperationsShell>
    );
  }

  if (mode === "edit" && loadingDetail) {
    return (
      <OperationsShell title="Edit delivery note">
        <p className="text-center text-sm text-slate-500">Loading…</p>
      </OperationsShell>
    );
  }

  if (mode === "edit" && (detailError || notNew)) {
    return (
      <OperationsShell title="Edit delivery note">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-100">
          {notNew
            ? "Only delivery notes in New can be edited."
            : detailError}
        </div>
        <div className="mt-3">
          <Link
            href={dnId ? `/delivery-notes/${dnId}` : "/delivery-notes"}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300"
          >
            ← Back
          </Link>
        </div>
      </OperationsShell>
    );
  }

  return (
    <OperationsShell
      title={mode === "create" ? "New delivery note" : `Edit ${dnNumber}`}
      subtitle={
        mode === "create"
          ? "Manually created notes start in New with today's priority"
          : "Changes are allowed while the note is still in New"
      }
    >
      <form onSubmit={handleSubmit} className="mx-auto max-w-4xl space-y-4">
        <Section title="Delivery note">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelClass()} htmlFor="dn-number">
                DN number *
              </label>
              <input
                id="dn-number"
                className={inputClass("font-mono")}
                value={dnNumber}
                onChange={(e) => {
                  setDnNumber(e.target.value);
                  setDnNumberError(null);
                }}
                onBlur={(e) => void checkDnNumber(e.target.value)}
                placeholder="e.g. 12345678"
                autoComplete="off"
              />
              {checkingDn ? (
                <p className="mt-1 text-[11px] text-slate-400">Checking…</p>
              ) : dnNumberError ? (
                <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                  {dnNumberError}
                </p>
              ) : null}
            </div>
            <div>
              <label className={labelClass()} htmlFor="po-number">
                Customer PO #
              </label>
              <input
                id="po-number"
                className={inputClass()}
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass()} htmlFor="po-date">
                PO date
              </label>
              <input
                id="po-date"
                type="date"
                className={inputClass()}
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass()} htmlFor="req-date">
                Requested delivery
              </label>
              <input
                id="req-date"
                type="date"
                className={inputClass()}
                value={requestedDate}
                onChange={(e) => setRequestedDate(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass()} htmlFor="currency">
                Currency
              </label>
              <input
                id="currency"
                className={inputClass("uppercase")}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                maxLength={10}
              />
            </div>
          </div>
        </Section>

        <Section title="Customer">
          {!newCustomerMode ? (
            <div>
              {customer ? (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
                    <span className="font-mono font-medium">
                      {customer.sold_to_code}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {" "}
                      · {customer.sold_to_name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={clearCustomer}
                    className="shrink-0 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div ref={customerBoxRef} className="relative">
                  <input
                    className={inputClass()}
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    onFocus={() => {
                      if (customerResults.length) setCustomerOpen(true);
                    }}
                    placeholder="Type at least 2 characters to search customers…"
                    autoComplete="off"
                  />
                  {customerOpen && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {searchingCustomers ? (
                        <p className="px-3 py-2 text-sm text-slate-400">
                          Searching…
                        </p>
                      ) : customerResults.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-slate-400">
                          No matches.
                        </p>
                      ) : (
                        customerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectCustomer(c)}
                            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <span className="font-mono font-medium">
                              {c.sold_to_code}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {" "}
                              · {c.sold_to_name}
                            </span>
                          </button>
                        ))
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setNewCustomerMode(true);
                          setCustomerOpen(false);
                        }}
                        className="block w-full border-t border-slate-200 px-3 py-1.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        + New customer…
                      </button>
                    </div>
                  )}
                </div>
              )}
              {!customer && (
                <button
                  type="button"
                  onClick={() => setNewCustomerMode(true)}
                  className="mt-2 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  + New customer…
                </button>
              )}
            </div>
          ) : (
            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass()}>Customer code *</label>
                  <input
                    className={inputClass("font-mono uppercase")}
                    value={ncCode}
                    onChange={(e) => setNcCode(e.target.value)}
                    maxLength={30}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>Customer name *</label>
                  <input
                    className={inputClass()}
                    value={ncName}
                    onChange={(e) => setNcName(e.target.value)}
                    maxLength={255}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>Contact</label>
                  <input
                    className={inputClass()}
                    value={ncContact}
                    onChange={(e) => setNcContact(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>Phone</label>
                  <input
                    className={inputClass()}
                    value={ncPhone}
                    onChange={(e) => setNcPhone(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass()}>Email</label>
                  <input
                    className={inputClass()}
                    value={ncEmail}
                    onChange={(e) => setNcEmail(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNewCustomerMode(false)}
                className="mt-2 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                ← Pick an existing customer instead
              </button>
            </div>
          )}
        </Section>

        <Section title="Ship to">
          {!newShipToMode ? (
            <div>
              {newCustomerMode ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Enter the ship-to details below — it will be created under
                  the new customer.
                </p>
              ) : !customer ? (
                <p className="text-sm text-slate-400">
                  Choose a customer first.
                </p>
              ) : loadingShipTos ? (
                <p className="text-sm text-slate-400">Loading locations…</p>
              ) : (
                <select
                  className={inputClass()}
                  value={shipToId}
                  onChange={(e) => setShipToId(e.target.value)}
                >
                  <option value="">Select a ship-to location…</option>
                  {shipTos.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.ship_to_code} · {s.ship_to_name}
                      {[s.city, s.state_region].filter(Boolean).join(", ")
                        ? ` (${[s.city, s.state_region].filter(Boolean).join(", ")})`
                        : ""}
                    </option>
                  ))}
                </select>
              )}
              {(customer || newCustomerMode) && (
                <button
                  type="button"
                  onClick={() => {
                    setNewShipToMode(true);
                    setShipToId("");
                  }}
                  className="mt-2 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  + New ship-to…
                </button>
              )}
            </div>
          ) : (
            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass()}>Ship-to code *</label>
                  <input
                    className={inputClass("font-mono uppercase")}
                    value={nsCode}
                    onChange={(e) => setNsCode(e.target.value)}
                    maxLength={30}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>Ship-to name *</label>
                  <input
                    className={inputClass()}
                    value={nsName}
                    onChange={(e) => setNsName(e.target.value)}
                    maxLength={255}
                    autoComplete="off"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass()}>Street</label>
                  <input
                    className={inputClass()}
                    value={nsStreet1}
                    onChange={(e) => setNsStreet1(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>City</label>
                  <input
                    className={inputClass()}
                    value={nsCity}
                    onChange={(e) => setNsCity(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>State / region</label>
                  <input
                    className={inputClass()}
                    value={nsState}
                    onChange={(e) => setNsState(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>Postal code</label>
                  <input
                    className={inputClass()}
                    value={nsPostal}
                    onChange={(e) => setNsPostal(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>Country</label>
                  <input
                    className={inputClass("uppercase")}
                    value={nsCountry}
                    onChange={(e) => setNsCountry(e.target.value)}
                    maxLength={10}
                    placeholder="CA"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>Contact</label>
                  <input
                    className={inputClass()}
                    value={nsContact}
                    onChange={(e) => setNsContact(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelClass()}>Phone</label>
                  <input
                    className={inputClass()}
                    value={nsPhone}
                    onChange={(e) => setNsPhone(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
              {!newCustomerMode && (
                <button
                  type="button"
                  onClick={() => setNewShipToMode(false)}
                  className="mt-2 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  ← Pick an existing ship-to instead
                </button>
              )}
            </div>
          )}
        </Section>

        <Section title="Lines">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-2 font-semibold">Part # *</th>
                  <th className="pb-2 pr-2 font-semibold">Description</th>
                  <th className="pb-2 pr-2 font-semibold">SO #</th>
                  <th className="w-24 pb-2 pr-2 font-semibold">Qty *</th>
                  <th className="w-28 pb-2 pr-2 font-semibold">Unit price</th>
                  <th className="w-28 pb-2 pr-2 text-right font-semibold">
                    Amount
                  </th>
                  <th className="w-8 pb-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const q = parseFloat(l.order_qty);
                  const p = parseFloat(l.unit_price);
                  const amount =
                    Number.isFinite(q) && Number.isFinite(p) ? q * p : 0;
                  return (
                    <tr
                      key={l.key}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass("font-mono")}
                          value={l.material_code}
                          onChange={(e) =>
                            updateLine(i, {
                              material_code: e.target.value,
                              autoFilled: false,
                            })
                          }
                          onBlur={(e) => void fillFromHistory(i, e.target.value)}
                          placeholder="Part number"
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass()}
                          value={l.material_description}
                          onChange={(e) =>
                            updateLine(i, {
                              material_description: e.target.value,
                              autoFilled: false,
                            })
                          }
                          placeholder={
                            l.autoFilled
                              ? "Filled from history — edit if needed"
                              : "Description"
                          }
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass("font-mono")}
                          value={l.so_number}
                          onChange={(e) =>
                            updateLine(i, { so_number: e.target.value })
                          }
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass("text-right tabular-nums")}
                          value={l.order_qty}
                          onChange={(e) =>
                            updateLine(i, { order_qty: e.target.value })
                          }
                          inputMode="decimal"
                          placeholder="0"
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass("text-right tabular-nums")}
                          value={l.unit_price}
                          onChange={(e) =>
                            updateLine(i, {
                              unit_price: e.target.value,
                              autoFilled: false,
                            })
                          }
                          inputMode="decimal"
                          placeholder="0.00"
                          autoComplete="off"
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {amount.toFixed(2)}
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setLines((prev) =>
                              prev.length > 1
                                ? prev.filter((_, j) => j !== i)
                                : [newLine()],
                            )
                          }
                          className="rounded px-1.5 py-0.5 text-sm text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                          title="Remove line"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, newLine()])}
              className="text-[12px] font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
            >
              + Add line
            </button>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Total{" "}
              <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {dnTotal.toFixed(2)} {currency.trim() || "CAD"}
              </span>
            </p>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Typing a part number fills the description and unit price from its
            most recent delivery note, when known.
          </p>
        </Section>

        <Section title="Options">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={isRushed}
                onChange={(e) => setIsRushed(e.target.checked)}
              />
              <span>
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  Rush this delivery note
                </span>
                <span className="block text-[11px] text-slate-400">
                  Rushed notes sort first in the queue.
                </span>
              </span>
            </label>
            {canSetPriority && (
              <div>
                <label className={labelClass()} htmlFor="priority">
                  Priority
                </label>
                <input
                  id="priority"
                  className={inputClass("w-32 tabular-nums")}
                  value={priorityNo}
                  onChange={(e) => setPriorityNo(e.target.value)}
                  inputMode="numeric"
                  placeholder={
                    mode === "create" ? "Auto (today's)" : undefined
                  }
                  autoComplete="off"
                />
                {mode === "create" && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    Leave empty to use today&apos;s priority.
                  </p>
                )}
              </div>
            )}
          </div>
          {isRushed && (
            <div className="mt-3 max-w-md">
              <label className={labelClass()} htmlFor="rush-reason">
                Rush reason
              </label>
              <input
                id="rush-reason"
                className={inputClass()}
                value={rushReason}
                onChange={(e) => setRushReason(e.target.value)}
                placeholder="Why is this rushed?"
                autoComplete="off"
              />
            </div>
          )}
        </Section>

        {submitError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-100">
            {submitError}
          </div>
        ) : null}

        <div className="flex items-center gap-3 pb-6">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {submitting
              ? mode === "create"
                ? "Creating…"
                : "Saving…"
              : mode === "create"
                ? "Create delivery note"
                : "Save changes"}
          </button>
          <Link
            href={mode === "edit" && dnId ? `/delivery-notes/${dnId}` : "/delivery-notes"}
            className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </Link>
        </div>
      </form>
    </OperationsShell>
  );
}
