"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import {
  ACTIVE_ROLE_CHANGED_EVENT,
  clearSession,
  getAccessToken,
  getActiveRoleCode,
} from "@/lib/auth-storage";
import { apiBase } from "@/lib/config";
import { DeliveryNoteNumber } from "@/components/delivery-note-number";
import { formatDeliveryNoteNumber } from "@/lib/format-dn-number";
import { DN_STATUS_OPTIONS, formatDnStatusLabel } from "@/lib/dn-status";
import {
  COLUMN_LABELS,
  DEFAULT_VISIBLE_COLUMNS,
  normalizeVisibleColumns,
  type ColumnKey,
} from "@/lib/delivery-notes-columns";
import {
  columnKeyToSortField,
  type DeliveryNoteSortDir,
  type DeliveryNoteSortField,
} from "@/lib/delivery-notes-list-sort";
import { StatusBadgeWithHover } from "@/components/status-badge-with-hover";
import type { StatusContextPayload } from "@/lib/dn-status-hover";

type DeliveryNoteRow = {
  id: string;
  dn_number: string;
  sold_to_code: string;
  ship_to_code: string;
  sold_to_name: string;
  ship_to_address: string;
  ship_to_street: string | null;
  current_priority_no: number | null;
  is_rushed: boolean;
  latest_rush_reason: string | null;
  current_status: string;
  status_context: StatusContextPayload | null;
  currency_code: string | null;
  is_open: boolean;
  dn_create_date: string | null;
  requested_delivery_date: string | null;
  projected_ship_date: string | null;
  shipping_type: string | null;
  ship_to_region_state: string | null;
  /** Other open DNs globally that share ship-with grouping keys (picker hint only). */
  ship_together_other_count: number;
};

type DeliveryNoteListResponse = {
  items: DeliveryNoteRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type DeliveryNoteDailyStats = {
  date: string;
  timezone: string;
  due_today: number;
  picked_total: number;
  packed_total: number;
  shipped_today: number;
};

type DnSuffixSuggestion = {
  id: string;
  dn_number: string;
  current_status: string;
  current_priority_no: number | null;
  is_rushed: boolean;
  sold_to_name: string;
};

type ShipTogetherPeer = {
  id: string;
  dn_number: string;
  current_status: string;
  /** Sum of line open quantities from API (string decimal). */
  total_products?: string;
};

/** Picker bulk selection built from suggestion picks (status from pick time; API validates transitions). */
type PickerChosenDn = {
  id: string;
  dn_number: string;
  current_status: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

function formatTotalProducts(raw: string | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function DeliveryNotesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<DeliveryNoteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [openFilter, setOpenFilter] = useState<"open" | "closed">("open");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dnNumberFilter, setDnNumberFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [shipToFilter, setShipToFilter] = useState("");
  const [draftPageSize, setDraftPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<DeliveryNoteSortField>("priority");
  const [sortDir, setSortDir] = useState<DeliveryNoteSortDir>("asc");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [importBanner, setImportBanner] = useState<string | null>(null);
  const [importReportReady, setImportReportReady] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(
    DEFAULT_VISIBLE_COLUMNS,
  );
  const [myPickingOnly, setMyPickingOnly] = useState(false);
  const [pickerChosen, setPickerChosen] = useState<PickerChosenDn[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pickerQuickDn, setPickerQuickDn] = useState("");
  const [pickerSuggestions, setPickerSuggestions] = useState<
    DnSuffixSuggestion[]
  >([]);
  const [pickerSuggestOpen, setPickerSuggestOpen] = useState(false);
  const [pickerSuggestLoading, setPickerSuggestLoading] = useState(false);
  const [pickerSuggestHighlight, setPickerSuggestHighlight] = useState(0);
  const pickerQuickWrapRef = useRef<HTMLDivElement>(null);

  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [shipTogetherModal, setShipTogetherModal] = useState<{
    anchorId: string;
    anchorDn: string;
    items: ShipTogetherPeer[];
    loading: boolean;
    error: string | null;
  } | null>(null);

  const importBatchId = searchParams.get("importBatch");

  const isPicker = getActiveRoleCode() === "PICKER";

  const [dailyStats, setDailyStats] = useState<DeliveryNoteDailyStats | null>(
    null,
  );
  const [dailyStatsLoading, setDailyStatsLoading] = useState(false);

  /** Align with API enum strings; chips may lag until table row syncs. */
  function normDnStatus(s: string): string {
    return String(s ?? "")
      .trim()
      .toUpperCase();
  }

  const pickerChosenFresh = useMemo(() => {
    return pickerChosen.map((c) => {
      const row = rows.find((r) => r.id === c.id);
      if (row) {
        return { ...c, current_status: row.current_status };
      }
      return c;
    });
  }, [pickerChosen, rows]);

  const columns = useMemo(() => {
    return visibleColumns.map((key) => ({ key, label: COLUMN_LABELS[key] }));
  }, [visibleColumns]);

  const hasActiveFilters = useMemo(
    () =>
      dnNumberFilter.trim().length > 0 ||
      customerFilter.trim().length > 0 ||
      shipToFilter.trim().length > 0 ||
      statusFilter.trim().length > 0 ||
      openFilter !== "open" ||
      myPickingOnly,
    [
      customerFilter,
      dnNumberFilter,
      openFilter,
      shipToFilter,
      statusFilter,
      myPickingOnly,
    ],
  );

  const canBulkStartPicking =
    isPicker &&
    pickerChosenFresh.length > 0 &&
    pickerChosenFresh.every((c) => {
      const st = normDnStatus(c.current_status);
      return st === "PRIORITIZED" || st === "IMPORTED";
    });

  const canBulkMarkPicked =
    isPicker &&
    ((pickerChosenFresh.length > 0 &&
      pickerChosenFresh.every(
        (c) => normDnStatus(c.current_status) === "PICKING",
      )) ||
      (myPickingOnly &&
        pickerChosen.length === 0 &&
        rows.length > 0 &&
        rows.every((r) => normDnStatus(r.current_status) === "PICKING")));

  function bulkTransitionIds(toStatus: "PICKING" | "PICKED"): string[] {
    if (pickerChosen.length > 0) {
      return pickerChosen.map((c) => c.id);
    }
    if (
      toStatus === "PICKED" &&
      myPickingOnly &&
      rows.length > 0
    ) {
      return rows.map((r) => r.id);
    }
    return [];
  }

  const loadDailyStats = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    setDailyStatsLoading(true);
    try {
      const res = await fetch(`${apiBase}/delivery-notes/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as DeliveryNoteDailyStats;
      setDailyStats(data);
    } catch {
      /* non-blocking */
    } finally {
      setDailyStatsLoading(false);
    }
  }, [router]);

  async function load(
    nextPage = page,
    nextPageSize = pageSize,
    q?: {
      openFilter?: "open" | "closed";
      statusFilter?: string;
      dnNumberFilter?: string;
      customerFilter?: string;
      shipToFilter?: string;
      myPickingOnly?: boolean;
      sortBy?: DeliveryNoteSortField;
      sortDir?: DeliveryNoteSortDir;
    },
  ) {
    const token = getAccessToken();
    if (!token) return;

    const openF = q?.openFilter ?? openFilter;
    const statusF = q?.statusFilter ?? statusFilter;
    const dnF = q?.dnNumberFilter ?? dnNumberFilter;
    const custF = q?.customerFilter ?? customerFilter;
    const shipF = q?.shipToFilter ?? shipToFilter;
    const myPick = q?.myPickingOnly ?? myPickingOnly;
    const sortByVal = q?.sortBy ?? sortBy;
    const sortDirVal = q?.sortDir ?? sortDir;

    const params = new URLSearchParams();
    params.set("is_open", openF === "open" ? "true" : "false");
    if (myPick) {
      params.set("myPicking", "true");
    } else if (statusF) {
      params.set("status", statusF);
    }
    const dn = dnF.trim();
    if (dn) params.set("dnNumber", dn);
    const cust = custF.trim();
    if (cust) params.set("customer", cust);
    const st = shipF.trim();
    if (st) params.set("shipTo", st);
    params.set("page", String(Math.max(1, nextPage)));
    params.set("pageSize", String(Math.min(200, Math.max(1, nextPageSize))));
    params.set("sortBy", sortByVal);
    params.set("sortDir", sortDirVal);

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/delivery-notes?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as
        | DeliveryNoteListResponse
        | { message?: string };
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        const msg =
          typeof (data as { message?: string }).message === "string"
            ? (data as { message?: string }).message!
            : JSON.stringify(data);
        setError(msg);
        setRows([]);
        setTotal(0);
        setTotalPages(1);
        return;
      }

      const payload = data as DeliveryNoteListResponse;
      setRows(Array.isArray(payload.items) ? payload.items : []);
      setTotal(typeof payload.total === "number" ? payload.total : 0);
      setTotalPages(
        typeof payload.totalPages === "number"
          ? Math.max(1, payload.totalPages)
          : 1,
      );
      setPage(typeof payload.page === "number" ? payload.page : nextPage);
      setPageSize(
        typeof payload.pageSize === "number" ? payload.pageSize : nextPageSize,
      );
      setDraftPageSize(
        typeof payload.pageSize === "number" ? payload.pageSize : nextPageSize,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }

  const openShipTogetherPeers = useCallback(
    async (row: DeliveryNoteRow) => {
      setShipTogetherModal({
        anchorId: row.id,
        anchorDn: row.dn_number,
        items: [],
        loading: true,
        error: null,
      });
      const token = getAccessToken();
      if (!token) {
        clearSession();
        router.replace("/login");
        setShipTogetherModal(null);
        return;
      }
      try {
        const res = await fetch(
          `${apiBase}/delivery-notes/${encodeURIComponent(row.id)}/ship-together-peers`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = (await res.json().catch(() => ({}))) as {
          items?: ShipTogetherPeer[];
          message?: string;
        };
        if (res.status === 401) {
          clearSession();
          router.replace("/login");
          setShipTogetherModal(null);
          return;
        }
        if (!res.ok) {
          const msg =
            typeof data.message === "string"
              ? data.message
              : "Could not load combinable delivery notes.";
          setShipTogetherModal((m) =>
            m && m.anchorId === row.id
              ? { ...m, loading: false, error: msg }
              : m,
          );
          return;
        }
        const items = data.items;
        setShipTogetherModal((m) =>
          m && m.anchorId === row.id
            ? {
                ...m,
                items: Array.isArray(items) ? items : [],
                loading: false,
              }
            : m,
        );
      } catch (e) {
        setShipTogetherModal((m) =>
          m && m.anchorId === row.id
            ? {
                ...m,
                loading: false,
                error: e instanceof Error ? e.message : "Request failed",
              }
            : m,
        );
      }
    },
    [router],
  );

  useEffect(() => {
    if (!shipTogetherModal) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setShipTogetherModal(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [shipTogetherModal]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    void fetch(`${apiBase}/me/delivery-notes-table-columns`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        if (res.ok) {
          const raw = (body as { visibleColumns?: unknown }).visibleColumns;
          setVisibleColumns(normalizeVisibleColumns(raw));
        }
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    void load(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial guarded load
  }, [ready, router]);

  useEffect(() => {
    if (!ready) return;
    void loadDailyStats();
  }, [ready, loadDailyStats]);

  /** Role switch keeps this page mounted; reset queue/filters so the new role sees its default list. */
  useEffect(() => {
    if (!ready) return;
    const onActiveRoleChanged = () => {
      void clearFiltersAndRefresh();
      void loadDailyStats();
    };
    window.addEventListener(ACTIVE_ROLE_CHANGED_EVENT, onActiveRoleChanged);
    return () =>
      window.removeEventListener(ACTIVE_ROLE_CHANGED_EVENT, onActiveRoleChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearFiltersAndRefresh is stable enough for this listener
  }, [ready]);

  useEffect(() => {
    if (!importBatchId || !ready) return;
    const token = getAccessToken();
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      const res = await fetch(`${apiBase}/import/batches/${importBatchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      const d = (await res.json()) as {
        status: string;
        summary_message: string | null;
      };
      if (cancelled) return;
      setImportBanner(
        `Import ${importBatchId.slice(0, 8)}… — ${d.status}${
          d.summary_message ? `: ${d.summary_message}` : ""
        }`,
      );
      if (
        d.status === "SUCCESS" ||
        d.status === "PARTIAL" ||
        d.status === "FAILED"
      ) {
        setImportReportReady(true);
        void load(page, pageSize);
        return true;
      }
      return false;
    };
    void poll();
    const id = setInterval(async () => {
      const done = await poll();
      if (done) clearInterval(id);
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll only for import batch
  }, [importBatchId, ready]);

  async function applyPageSizeChange(normalized: number) {
    const n = Math.min(200, Math.max(1, normalized));
    setDraftPageSize(n);
    setPage(1);
    setPageSize(n);
    await load(1, n);
  }

  async function clearFiltersAndRefresh() {
    setDnNumberFilter("");
    setCustomerFilter("");
    setShipToFilter("");
    setStatusFilter("");
    setOpenFilter("open");
    setMyPickingOnly(false);
    setPickerChosen([]);
    setPickerQuickDn("");
    setPickerSuggestions([]);
    setPickerSuggestOpen(false);
    setPage(1);
    await load(1, pageSize, {
      dnNumberFilter: "",
      customerFilter: "",
      shipToFilter: "",
      statusFilter: "",
      openFilter: "open",
      myPickingOnly: false,
    });
  }

  async function applyFilters() {
    setPage(1);
    await load(1, pageSize);
  }

  async function toggleSortForColumn(colKey: ColumnKey) {
    const field = columnKeyToSortField(colKey);
    if (!field) return;
    let nextDir: DeliveryNoteSortDir = "asc";
    if (field === sortBy) {
      nextDir = sortDir === "asc" ? "desc" : "asc";
    }
    setSortBy(field);
    setSortDir(nextDir);
    setPage(1);
    await load(1, pageSize, { sortBy: field, sortDir: nextDir });
  }

  async function goToPage(nextPage: number) {
    const bounded = Math.min(Math.max(nextPage, 1), totalPages);
    await load(bounded, pageSize);
  }

  async function runBulkTransition(toStatus: "PICKING" | "PICKED") {
    const token = getAccessToken();
    if (!token) return;
    const ids = bulkTransitionIds(toStatus);
    if (ids.length === 0) return;
    setBulkSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/delivery-notes/bulk-transition`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ids,
          toStatus,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        const msg =
          typeof (data as { message?: string }).message === "string"
            ? (data as { message?: string }).message!
            : JSON.stringify(data);
        setError(msg);
        return;
      }
      const processed =
        (data as { processed?: number }).processed ?? ids.length;
      setSuccessMessage(
        `Updated ${processed} delivery note${processed === 1 ? "" : "s"}.`,
      );
      setPickerChosen([]);
      await load(page, pageSize);
      void loadDailyStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBulkSubmitting(false);
    }
  }

  const fetchPickerSuggestions = useCallback(
    async (digits: string) => {
      const token = getAccessToken();
      if (!token) return;
      setPickerSuggestLoading(true);
      try {
        const res = await fetch(
          `${apiBase}/delivery-notes/suggestions?q=${encodeURIComponent(digits)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          setPickerSuggestions([]);
          setPickerSuggestOpen(false);
          return;
        }
        const items = (data as { items?: DnSuffixSuggestion[] }).items;
        setPickerSuggestions(Array.isArray(items) ? items : []);
        setPickerSuggestOpen(true);
        setPickerSuggestHighlight(0);
      } finally {
        setPickerSuggestLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!isPicker) return;
    const digits = pickerQuickDn.replace(/\D/g, "");
    if (digits.length < 4) {
      setPickerSuggestions([]);
      setPickerSuggestOpen(false);
      return;
    }
    const tid = window.setTimeout(() => {
      void fetchPickerSuggestions(digits);
    }, 280);
    return () => window.clearTimeout(tid);
  }, [pickerQuickDn, isPicker, fetchPickerSuggestions]);

  useEffect(() => {
    if (!pickerSuggestOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const el = pickerQuickWrapRef.current;
      if (el && !el.contains(e.target as Node)) {
        setPickerSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [pickerSuggestOpen]);

  function addPickerChoice(s: DnSuffixSuggestion) {
    setPickerChosen((prev) => {
      if (prev.some((p) => p.id === s.id)) return prev;
      return [
        ...prev,
        {
          id: s.id,
          dn_number: s.dn_number,
          current_status: s.current_status,
        },
      ];
    });
    setPickerQuickDn("");
    setPickerSuggestions([]);
    setPickerSuggestOpen(false);
  }

  function removePickerChoice(id: string) {
    setPickerChosen((prev) => prev.filter((p) => p.id !== id));
  }

  function onPickerQuickKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const digits = pickerQuickDn.replace(/\D/g, "");
    if (e.key === "Escape") {
      setPickerSuggestOpen(false);
      if (digits.length === 0) setPickerQuickDn("");
      return;
    }
    if (
      e.key === "Backspace" &&
      digits.length === 0 &&
      pickerChosen.length > 0
    ) {
      e.preventDefault();
      setPickerChosen((prev) => prev.slice(0, -1));
      return;
    }
    if (!pickerSuggestOpen || pickerSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPickerSuggestHighlight((h) =>
        Math.min(h + 1, pickerSuggestions.length - 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPickerSuggestHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = pickerSuggestions[pickerSuggestHighlight];
      if (item) addPickerChoice(item);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-canvas)] text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  const fieldClass =
    "h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500";

  return (
    <OperationsShell title="Delivery notes">
      <div className="space-y-2">
        <section
          aria-label="Today's delivery note statistics"
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-200/90 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-950/80"
        >
          <h2 className="sr-only">Today</h2>
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {(
              [
                ["Due", dailyStats?.due_today, "Open notes due today"],
                ["Picked", dailyStats?.picked_total, "Open notes in Picked"],
                ["Packed", dailyStats?.packed_total, "Open notes in Packed"],
                ["Shipped", dailyStats?.shipped_today, "Marked shipped today"],
              ] as const
            ).map(([label, value, title]) => (
              <div key={label} className="flex items-baseline gap-1.5" title={title}>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  {label}
                </dt>
                <dd className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                  {dailyStatsLoading && dailyStats == null ? "…" : (value ?? "—")}
                </dd>
              </div>
            ))}
          </dl>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-400">
            <span className="tabular-nums">{dailyStats?.date ?? "PT"}</span>
            <button
              type="button"
              disabled={dailyStatsLoading}
              onClick={() => void loadDailyStats()}
              className="font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50 dark:hover:text-slate-200"
            >
              {dailyStatsLoading ? "…" : "Refresh"}
            </button>
          </div>
        </section>

        {importBanner && (
          <div
            role="status"
            className="flex gap-3 rounded-2xl border border-sky-200/90 bg-sky-50/90 px-3 py-2 text-sm text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/35 dark:text-sky-100"
          >
            <span
              className="mt-0.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-500"
              aria-hidden
            />
            <div className="min-w-0 leading-relaxed">
              <p>{importBanner}</p>
              {importBatchId && importReportReady ? (
                <Link
                  href={`/import/report/${importBatchId}`}
                  className="mt-1 inline-block font-medium underline underline-offset-2 hover:text-sky-700 dark:hover:text-sky-200"
                >
                  View import result report
                </Link>
              ) : null}
            </div>
          </div>
        )}

        <form
          className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-950/80"
          onSubmit={(e) => {
            e.preventDefault();
            void applyFilters();
          }}
        >
          <label htmlFor="filter-dn-number" className="sr-only">
            DN #
          </label>
          <input
            id="filter-dn-number"
            type="search"
            autoComplete="off"
            value={dnNumberFilter}
            onChange={(e) => setDnNumberFilter(e.target.value)}
            placeholder="DN #"
            title="Partial match on delivery note number"
            className={`${fieldClass} w-28`}
          />
          <label htmlFor="filter-customer" className="sr-only">
            Customer
          </label>
          <input
            id="filter-customer"
            type="search"
            autoComplete="off"
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            placeholder="Customer"
            title="Partial match on customer name or sold-to code"
            className={`${fieldClass} w-40`}
          />
          <label htmlFor="filter-ship-to" className="sr-only">
            Ship-to
          </label>
          <input
            id="filter-ship-to"
            type="search"
            autoComplete="off"
            value={shipToFilter}
            onChange={(e) => setShipToFilter(e.target.value)}
            placeholder="Ship-to"
            title="Partial match on ship-to code or address fields"
            className={`${fieldClass} min-w-[8rem] flex-1`}
          />
          <label htmlFor="filter-open" className="sr-only">
            Open
          </label>
          <select
            id="filter-open"
            value={openFilter}
            onChange={(e) =>
              setOpenFilter(e.target.value as "open" | "closed")
            }
            className={`${fieldClass} w-[5.5rem]`}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <label htmlFor="filter-status" className="sr-only">
            Status
          </label>
          <select
            id="filter-status"
            value={statusFilter}
            disabled={loading || myPickingOnly}
            title={
              myPickingOnly
                ? "Turn off My picking to filter by status"
                : "Status"
            }
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${fieldClass} w-36 disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <option value="">Any status</option>
            {DN_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "SHIPPED" ? "Shipped today" : formatDnStatusLabel(s)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading}
            title="Apply filters"
            className="inline-flex h-8 items-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {loading ? "…" : "Apply"}
          </button>
          <button
            type="button"
            disabled={loading || !hasActiveFilters}
            title="Reset all filters and refresh"
            onClick={() => void clearFiltersAndRefresh()}
            className="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Clear
          </button>
          {statusFilter.trim().toUpperCase() === "SHIPPED" ? (
            <p className="basis-full text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              Shipped today, Vancouver time, open and closed.
            </p>
          ) : null}
        </form>

        {isPicker ? (
          <div className="rounded-xl border border-slate-200/90 bg-white px-3 py-3 shadow-sm ring-1 ring-slate-950/[0.03] dark:border-slate-800 dark:bg-slate-950/80 dark:ring-white/[0.04]">
            <div className="relative mb-3 min-w-0" ref={pickerQuickWrapRef}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <label
                    htmlFor="picker-quick-dn"
                    className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                  >
                    Scan delivery notes
                  </label>
                  <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    Last digits of the DN. Add matches to the list.
                  </p>
                </div>
                {pickerChosen.length > 0 ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                    onClick={() => setPickerChosen([])}
                  >
                    Clear list
                  </button>
                ) : null}
              </div>
              <div className="relative flex min-h-10 flex-wrap items-center gap-1 rounded-lg border border-slate-200/95 bg-white px-1.5 py-1 dark:border-slate-600 dark:bg-slate-900/90">
                {pickerChosen.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex max-w-full items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 pl-2 text-xs text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <span className="truncate font-mono tabular-nums">
                      {formatDeliveryNoteNumber(c.dn_number)}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded px-0.5 text-base leading-none text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                      aria-label={`Remove ${formatDeliveryNoteNumber(c.dn_number)}`}
                      onClick={() => removePickerChoice(c.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <div className="relative min-w-[10rem] flex-1">
                  <input
                    id="picker-quick-dn"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={pickerQuickDn}
                    onChange={(e) => setPickerQuickDn(e.target.value)}
                    onKeyDown={onPickerQuickKeyDown}
                    placeholder={
                      pickerChosen.length === 0
                        ? "Last digits…"
                        : "Add another…"
                    }
                    title="Matches DN numbers ending with these digits. Excludes shipped, cancelled, and on hold."
                    className="h-7 w-full min-w-0 border-0 bg-transparent px-1 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100"
                  />
                  {pickerSuggestLoading ? (
                    <span
                      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-slate-400"
                      aria-hidden
                    >
                      …
                    </span>
                  ) : null}
                </div>
              </div>
              {pickerSuggestOpen &&
              pickerSuggestions.length > 0 &&
              !pickerSuggestLoading ? (
                <ul
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900"
                >
                  {pickerSuggestions.map((s, i) => (
                    <li key={s.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === pickerSuggestHighlight}
                        className={`flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${
                          i === pickerSuggestHighlight
                            ? "bg-slate-100 dark:bg-slate-800"
                            : ""
                        }`}
                        onMouseEnter={() => setPickerSuggestHighlight(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addPickerChoice(s)}
                      >
                        <DeliveryNoteNumber
                          dnNumber={s.dn_number}
                          isRushed={s.is_rushed}
                          numberClassName="font-mono font-medium text-slate-900 dark:text-slate-100"
                        />
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">
                          {s.current_status}
                          {s.current_priority_no != null
                            ? ` · #${s.current_priority_no}`
                            : ""}{" "}
                          · {s.sold_to_name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : pickerSuggestOpen &&
                !pickerSuggestLoading &&
                pickerQuickDn.replace(/\D/g, "").length >= 4 ? (
                <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-500 shadow-lg dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400">
                  No matching delivery notes (or all excluded as shipped /
                  cancelled / on hold).
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 dark:border-slate-800/90">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label
                  htmlFor="picker-my-queue"
                  className="group flex max-w-md cursor-pointer items-start gap-3 rounded-lg border border-transparent p-1 transition hover:border-slate-200/80 hover:bg-slate-50/90 dark:hover:border-slate-700 dark:hover:bg-slate-900/50 sm:items-center"
                  title="Filters the table below to PICKING notes you started."
                >
                  <span className="relative mt-0.5 inline-flex h-6 w-10 shrink-0 sm:mt-0">
                    <input
                      id="picker-my-queue"
                      type="checkbox"
                      checked={myPickingOnly}
                      disabled={loading}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setMyPickingOnly(next);
                        setPage(1);
                        void load(1, pageSize, { myPickingOnly: next });
                      }}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full bg-slate-200 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-slate-400 peer-checked:bg-emerald-600 peer-disabled:opacity-40 dark:bg-slate-700 dark:peer-checked:bg-emerald-600"
                    />
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm ring-1 ring-black/[0.06] transition-transform duration-200 ease-out peer-checked:translate-x-4 dark:ring-white/10"
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">
                      My queue
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                      Table: only <span className="font-medium text-slate-600 dark:text-slate-300">PICKING</span> you started.
                    </span>
                  </span>
                </label>

                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                  <button
                    type="button"
                    disabled={bulkSubmitting || !canBulkStartPicking}
                    title="Move selected notes to PICKING"
                    onClick={() => void runBulkTransition("PICKING")}
                    className="inline-flex h-9 min-h-9 items-center justify-center rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                  >
                    Start picking
                  </button>
                  <button
                    type="button"
                    disabled={bulkSubmitting || !canBulkMarkPicked}
                    title={
                      myPickingOnly && pickerChosen.length === 0
                        ? "Mark every delivery note on this page as picked (your queue)"
                        : "Complete picking for notes you claimed"
                    }
                    onClick={() => void runBulkTransition("PICKED")}
                    className="inline-flex h-9 min-h-9 items-center justify-center rounded-lg border border-emerald-700/90 bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-40 dark:border-emerald-600 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                  >
                    Mark picked
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/95 text-left dark:border-slate-800 dark:bg-slate-900/80">
                  {columns.map((col) => {
                    const sortField = columnKeyToSortField(col.key);
                    const isActive = sortField != null && sortField === sortBy;
                    return (
                      <th
                        key={col.key}
                        className="whitespace-nowrap px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500"
                      >
                        {sortField ? (
                          <button
                            type="button"
                            onClick={() => void toggleSortForColumn(col.key)}
                            className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 -mx-1 transition hover:bg-slate-200/80 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${
                              isActive
                                ? "text-slate-900 dark:text-slate-100"
                                : ""
                            }`}
                            aria-sort={
                              isActive
                                ? sortDir === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                          >
                            <span>{col.label}</span>
                            <span
                              className="inline-flex w-3 flex-col text-[9px] leading-none text-slate-400"
                              aria-hidden
                            >
                              <span
                                className={
                                  isActive && sortDir === "asc"
                                    ? "text-[var(--app-brand)]"
                                    : ""
                                }
                              >
                                ▲
                              </span>
                              <span
                                className={
                                  isActive && sortDir === "desc"
                                    ? "text-[var(--app-brand)]"
                                    : ""
                                }
                              >
                                ▼
                              </span>
                            </span>
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading ? (
                  <tr>
                    <td
                      colSpan={Math.max(1, columns.length)}
                      className="px-3 py-10 text-center text-sm text-slate-500 dark:text-slate-500"
                    >
                      No delivery notes match these filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 transition-colors hover:bg-slate-50/90 dark:border-slate-800/80 dark:hover:bg-slate-900/40"
                    >
                      {columns.map((col) => {
                        if (col.key === "current_priority_no") {
                          return (
                            <td
                              key={col.key}
                              className="whitespace-nowrap px-3 py-1.5 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400"
                            >
                              {r.current_priority_no ?? "—"}
                            </td>
                          );
                        }
                        if (col.key === "dn_number") {
                          return (
                            <td
                              key={col.key}
                              className="whitespace-nowrap px-3 py-1.5"
                            >
                              <div className="flex items-center gap-1.5">
                                <Link
                                  href={`/delivery-notes/${r.id}`}
                                  className="font-mono text-[13px] font-medium text-slate-900 hover:text-sky-800 hover:underline dark:text-slate-100 dark:hover:text-sky-300"
                                >
                                  <DeliveryNoteNumber
                                    dnNumber={r.dn_number}
                                    isRushed={r.is_rushed}
                                    rushReason={r.latest_rush_reason}
                                  />
                                </Link>
                                {(r.ship_together_other_count ?? 0) > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => void openShipTogetherPeers(r)}
                                    className="rounded bg-amber-50 px-1 py-px text-[10px] font-semibold tabular-nums text-amber-800 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/60"
                                    title={`${r.ship_together_other_count} other note${r.ship_together_other_count === 1 ? "" : "s"} share this customer, ship-to, and ship type. Click to list them.`}
                                    aria-label={`${r.ship_together_other_count} other note${r.ship_together_other_count === 1 ? "" : "s"} to ship together`}
                                  >
                                    +{r.ship_together_other_count}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          );
                        }
                        if (col.key === "sold_to_name") {
                          return (
                            <td
                              key={col.key}
                              title={r.sold_to_name}
                              className="max-w-[12rem] truncate whitespace-nowrap px-3 py-1.5 text-slate-800 dark:text-slate-200"
                            >
                              {r.sold_to_name}
                            </td>
                          );
                        }
                        if (col.key === "ship_to_address") {
                          const place = [r.ship_to_street, r.ship_to_region_state]
                            .filter(Boolean)
                            .join(", ");
                          return (
                            <td
                              key={col.key}
                              className="max-w-[18rem] px-3 py-1.5 text-slate-800 dark:text-slate-200"
                              title={
                                place
                                  ? `${r.ship_to_address} — ${place}`
                                  : r.ship_to_address
                              }
                            >
                              <div className="truncate">
                                <span>{r.ship_to_address}</span>
                                {r.ship_to_region_state ? (
                                  <span className="text-slate-400 dark:text-slate-500">
                                    {" "}
                                    · {r.ship_to_region_state}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                          );
                        }
                        if (col.key === "current_status") {
                          return (
                            <td
                              key={col.key}
                              className="overflow-visible whitespace-nowrap px-3 py-1.5"
                            >
                              <StatusBadgeWithHover
                                status={r.current_status}
                                isOpen={r.is_open}
                                hoverInput={{
                                  statusContext: r.status_context ?? null,
                                }}
                              />
                            </td>
                          );
                        }
                        if (col.key === "shipping_type") {
                          return (
                            <td
                              key={col.key}
                              className="max-w-[9rem] truncate whitespace-nowrap px-3 py-1.5 text-slate-600 dark:text-slate-300"
                              title={r.shipping_type ?? undefined}
                            >
                              {r.shipping_type ?? "—"}
                            </td>
                          );
                        }
                        if (col.key === "requested_delivery_date") {
                          return (
                            <td
                              key={col.key}
                              className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600 dark:text-slate-300"
                            >
                              {formatDate(r.requested_delivery_date)}
                            </td>
                          );
                        }
                        return (
                          <td
                            key={col.key}
                            className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600 dark:text-slate-300"
                          >
                            {formatDate(r.projected_ship_date)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="tabular-nums">
                {loading
                  ? "Loading…"
                  : `${rows.length} of ${total.toLocaleString()}`}
              </p>
              <div className="flex items-center gap-1.5">
                <label htmlFor="rows-per-page" className="font-medium text-slate-600 dark:text-slate-300">
                  Rows
                </label>
                <input
                  id="rows-per-page"
                  type="number"
                  min={1}
                  max={200}
                  value={draftPageSize}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v)) {
                      setDraftPageSize(Math.min(200, Math.max(1, v)));
                    }
                  }}
                  onBlur={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    const n = Math.min(
                      200,
                      Math.max(1, Number.isFinite(parsed) ? parsed : pageSize),
                    );
                    setDraftPageSize(n);
                    if (n !== pageSize) {
                      void applyPageSizeChange(n);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  title="Leave field or press Enter to apply page size"
                  className="h-7 w-12 rounded border border-slate-200 bg-white px-1 text-center text-xs tabular-nums text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <Link
                href="/settings/delivery-notes"
                className="font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
              >
                Columns
              </Link>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void goToPage(page - 1)}
                disabled={loading || page <= 1}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                Previous
              </button>
              <span className="min-w-[5.5rem] text-center tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => void goToPage(page + 1)}
                disabled={loading || page >= totalPages}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      <ResponseModal
        open={!!error}
        onClose={() => setError(null)}
        message={error ?? ""}
        variant="error"
      />
      <ResponseModal
        open={!!successMessage}
        onClose={() => setSuccessMessage(null)}
        message={successMessage ?? ""}
        variant="success"
      />
      {shipTogetherModal
        ? createPortal(
            <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 sm:p-6">
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute inset-0 bg-slate-950/40 dark:bg-black/50"
                onClick={() => setShipTogetherModal(null)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="ship-together-dialog-title"
                aria-describedby="ship-together-dialog-desc"
                className="relative z-10 flex max-h-[min(90vh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[color:var(--app-border)] bg-[var(--app-surface)] shadow-xl ring-1 ring-black/[0.04] dark:shadow-black/30 dark:ring-white/[0.06]"
              >
                <div className="shrink-0 border-b border-[color:var(--app-border)] px-5 py-4">
                  <h2
                    id="ship-together-dialog-title"
                    className="text-sm font-semibold leading-snug tracking-tight text-slate-900 dark:text-slate-100"
                  >
                    Same cluster as{" "}
                    <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                      {formatDeliveryNoteNumber(shipTogetherModal.anchorDn)}
                    </span>
                  </h2>
                  <p
                    id="ship-together-dialog-desc"
                    className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400"
                  >
                    Customer, ship-to, location, and ship type match. Shipped,
                    on hold, and cancelled are excluded. Scope is company-wide.
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {shipTogetherModal.loading ? (
                    <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                      Loading list…
                    </p>
                  ) : shipTogetherModal.error ? (
                    <p className="text-sm text-red-800 dark:text-red-200">
                      {shipTogetherModal.error}
                    </p>
                  ) : shipTogetherModal.items.length === 0 ? (
                    <p className="py-6 text-center text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                      No other combinable notes right now. Status may have
                      changed since the table loaded.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2" role="list">
                      {shipTogetherModal.items.map((p) => {
                        const qtyLabel = formatTotalProducts(p.total_products);
                        return (
                          <li key={p.id}>
                            <Link
                              href={`/delivery-notes/${p.id}`}
                              className="group flex items-center justify-between gap-4 rounded-lg border border-slate-200/90 bg-slate-50/40 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/80 dark:bg-slate-900/30 dark:hover:border-slate-600 dark:hover:bg-slate-900/60"
                              onClick={() => setShipTogetherModal(null)}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-sm font-medium text-sky-800 underline decoration-sky-300/80 underline-offset-2 group-hover:text-sky-950 dark:text-sky-300 dark:decoration-sky-600/80 dark:group-hover:text-sky-100">
                                  {formatDeliveryNoteNumber(p.dn_number)}
                                </div>
                                <div className="mt-1 truncate text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  {p.current_status}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                                  {qtyLabel}
                                </div>
                                <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Total products
                                </div>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 justify-end border-t border-[color:var(--app-border)] px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setShipTogetherModal(null)}
                    className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </OperationsShell>
  );
}

export default function DeliveryNotesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--app-canvas)] text-sm text-slate-500">
          Loading…
        </div>
      }
    >
      <DeliveryNotesContent />
    </Suspense>
  );
}
