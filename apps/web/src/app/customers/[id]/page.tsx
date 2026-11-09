"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken, getActiveRoleCode } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";
import { canSeeCustomersNav, canWriteCustomers, canManageBoxContent } from "@/lib/import-access";
import { CustomerActiveBadge } from "@/components/customer-active-badge";

type CarrierAccount = {
  id: string;
  carrier_code: string;
  account_number: string;
  ship_to_location_id: string | null;
  ship_to_location?: {
    id: string;
    ship_to_code: string;
    ship_to_name: string;
  } | null;
  is_collect_enabled: boolean;
  notes: string | null;
  is_active: boolean;
};

type ShipToLocationRow = {
  id: string;
  ship_to_code: string;
  ship_to_name: string;
};

type CustomerDetail = {
  id: string;
  sold_to_code: string;
  sold_to_name: string;
  fed_id_number: string | null;
  default_contact_name: string | null;
  default_phone: string | null;
  default_email: string | null;
  shipping_preference: string | null;
  is_active: boolean;
  requires_box_content: boolean;
  ship_to_count: number;
  delivery_note_count: number;
  carrier_accounts: CarrierAccount[];
};

const emptyProfile = {
  sold_to_name: "",
  fed_id_number: "",
  default_contact_name: "",
  default_phone: "",
  default_email: "",
  shipping_preference: "",
  is_active: true,
};

/** Carriers always shown as groups, in this order. Accounts with any other
 * code still show, as their own group after these. */
const KNOWN_CARRIERS = ["FEDEX", "UPS", "DHL", "PUROLATOR"];

function groupCarrierAccounts(
  accounts: CarrierAccount[],
): { carrier: string; accounts: CarrierAccount[] }[] {
  const byCarrier = new Map<string, CarrierAccount[]>();
  for (const a of accounts) {
    const list = byCarrier.get(a.carrier_code) ?? [];
    list.push(a);
    byCarrier.set(a.carrier_code, list);
  }
  const others = [...byCarrier.keys()]
    .filter((c) => !KNOWN_CARRIERS.includes(c))
    .sort();
  return [...KNOWN_CARRIERS, ...others].map((carrier) => ({
    carrier,
    accounts: byCarrier.get(carrier) ?? [],
  }));
}

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const canWrite = canWriteCustomers(getActiveRoleCode());
  const canManageBoxContentFlag = canManageBoxContent(getActiveRoleCode());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permHint, setPermHint] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [savedOk, setSavedOk] = useState(false);
  /** Account id whose Copy button briefly shows "Copied". */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** Per-customer box-content requirement (packing list for customs). */
  const [boxContent, setBoxContent] = useState(false);
  const [boxContentSaving, setBoxContentSaving] = useState(false);
  /** Draft account number per carrier for the inline add rows. */
  const [newAccountNumbers, setNewAccountNumbers] = useState<
    Record<string, string>
  >({});
  /** Draft ship-to location per carrier for the inline add rows (""
   * = customer-wide account). */
  const [newAccountLocations, setNewAccountLocations] = useState<
    Record<string, string>
  >({});
  /** Ship-to locations of this customer, for the account location pickers. */
  const [locations, setLocations] = useState<ShipToLocationRow[]>([]);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    account_number: "",
    ship_to_location_id: null as string | null,
    notes: "",
    is_collect_enabled: true,
    is_active: true,
  });

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    void fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: { activeRoleCode?: string | null; permissions?: string[] }) => {
        const role = d.activeRoleCode ?? "";
        const permissions = d.permissions ?? [];
        if (!canSeeCustomersNav(role)) {
          setPermHint(
            "Customers requires active role CSA, SHIPPER, SUPERVISOR, or SYSTEM.",
          );
        } else if (!permissions.includes("customers.read")) {
          setPermHint("Missing permission customers.read for active role.");
        } else {
          setPermHint(null);
        }
      })
      .catch(() => undefined);
  }, [router]);

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token || !customerId) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/customers/${customerId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setError(
          formatApiErrorPayload(body) +
            (res.status ? ` (HTTP ${res.status})` : ""),
        );
        setDetail(null);
        return;
      }
      const d = body as CustomerDetail;
      setDetail(d);
      setBoxContent(d.requires_box_content === true);
      // Ship-to locations for the account location pickers. A failure here
      // must not block the page: without locations, accounts can still be
      // added customer-wide.
      try {
        const locRes = await fetch(
          `${apiBase}/customers/${customerId}/ship-to-locations`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (locRes.ok) {
          const locBody = (await locRes.json().catch(() => ({}))) as {
            items?: ShipToLocationRow[];
          };
          setLocations(Array.isArray(locBody.items) ? locBody.items : []);
        }
      } catch {
        /* leave locations empty */
      }
      setProfile({
        sold_to_name: d.sold_to_name ?? "",
        fed_id_number: d.fed_id_number ?? "",
        default_contact_name: d.default_contact_name ?? "",
        default_phone: d.default_phone ?? "",
        default_email: d.default_email ?? "",
        shipping_preference: d.shipping_preference ?? "",
        is_active: d.is_active,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [customerId, router]);

  useEffect(() => {
    if (permHint) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, permHint]);

  useEffect(() => {
    if (!savedOk) return;
    const t = window.setTimeout(() => setSavedOk(false), 3500);
    return () => window.clearTimeout(t);
  }, [savedOk]);

  const dirty = useMemo(() => {
    if (!detail) return false;
    return (
      profile.sold_to_name !== (detail.sold_to_name ?? "") ||
      profile.fed_id_number !== (detail.fed_id_number ?? "") ||
      profile.default_contact_name !== (detail.default_contact_name ?? "") ||
      profile.default_phone !== (detail.default_phone ?? "") ||
      profile.default_email !== (detail.default_email ?? "") ||
      profile.shipping_preference !== (detail.shipping_preference ?? "") ||
      profile.is_active !== detail.is_active
    );
  }, [detail, profile]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const token = getAccessToken();
    if (!token || !customerId || !canWrite) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/customers/${customerId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sold_to_name: profile.sold_to_name,
          fed_id_number: profile.fed_id_number || null,
          default_contact_name: profile.default_contact_name || null,
          default_phone: profile.default_phone || null,
          default_email: profile.default_email || null,
          shipping_preference: profile.shipping_preference || null,
          is_active: profile.is_active,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatApiErrorPayload(body));
        return;
      }
      const d = body as CustomerDetail;
      setDetail(d);
      setSavedOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveBoxContent() {
    const token = getAccessToken();
    if (!token || !customerId || !canManageBoxContentFlag) return;
    setBoxContentSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/customers/${customerId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requires_box_content: boxContent }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatApiErrorPayload(body));
        return;
      }
      const d = body as CustomerDetail;
      setDetail(d);
      setBoxContent(d.requires_box_content === true);
      setSavedOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBoxContentSaving(false);
    }
  }

  async function addCarrierAccountForCarrier(carrierCode: string) {
    const accountNumber = (newAccountNumbers[carrierCode] ?? "").trim();
    const shipToLocationId =
      (newAccountLocations[carrierCode] ?? "").trim() || null;
    const token = getAccessToken();
    if (!token || !customerId || !canWrite || !accountNumber) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/customers/${customerId}/carrier-accounts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            carrier_code: carrierCode,
            account_number: accountNumber,
            ship_to_location_id: shipToLocationId,
            notes: null,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatApiErrorPayload(body));
        return;
      }
      setDetail(body as CustomerDetail);
      setNewAccountNumbers((d) => ({ ...d, [carrierCode]: "" }));
      setNewAccountLocations((d) => ({ ...d, [carrierCode]: "" }));
      setSavedOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add account failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveCarrierAccount(accountId: string) {
    const token = getAccessToken();
    if (!token || !customerId || !canWrite) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/customers/${customerId}/carrier-accounts/${accountId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(editDraft),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatApiErrorPayload(body));
        return;
      }
      setDetail(body as CustomerDetail);
      setEditingAccountId(null);
      setSavedOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update account failed");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(a: CarrierAccount) {
    setEditingAccountId(a.id);
    setEditDraft({
      account_number: a.account_number,
      ship_to_location_id: a.ship_to_location_id ?? null,
      notes: a.notes ?? "",
      is_collect_enabled: a.is_collect_enabled,
      is_active: a.is_active,
    });
  }

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(
        () => setCopiedId((cur) => (cur === id ? null : cur)),
        2000,
      );
    } catch {
      /* ignore */
    }
  }

  const fieldClass =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900";
  const labelClass = "block text-sm text-slate-600 dark:text-slate-400";

  return (
    <OperationsShell
      title={detail?.sold_to_name ?? "Customer"}
      subtitle={
        detail
          ? `Sold-to ${detail.sold_to_code} · ${detail.ship_to_count} ship-to · ${detail.delivery_note_count} DNs`
          : "Customer profile and courier accounts"
      }
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <Link
          href="/customers"
          className="inline-block text-sm text-[var(--app-accent)] hover:underline"
        >
          ← All customers
        </Link>

        {permHint ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {permHint}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            {error}
          </div>
        ) : null}
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : null}

        {!loading && detail && !permHint ? (
          <>
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {detail.sold_to_name}
                </h2>
                <p className="mt-0.5 font-mono text-sm text-slate-500">
                  Sold-to {detail.sold_to_code}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <CustomerActiveBadge active={detail.is_active} />
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {detail.ship_to_count} ship-to · {detail.delivery_note_count}{" "}
                  DNs
                </span>
              </div>
            </section>

            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Profile
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Sold-to code is the business key and cannot be changed.
                {!canWrite
                  ? " View only — switch to CSA to edit."
                  : null}
              </p>
              <form className="mt-4 space-y-3" onSubmit={saveProfile}>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Identity
                    </h3>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <label className={labelClass}>
                        Sold-to code
                        <input
                          className={fieldClass + " font-mono"}
                          value={detail.sold_to_code}
                          disabled
                          readOnly
                        />
                      </label>
                      <label className={labelClass}>
                        Customer name
                        <input
                          className={fieldClass}
                          value={profile.sold_to_name}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setProfile((p) => ({
                              ...p,
                              sold_to_name: e.target.value,
                            }))
                          }
                          required
                        />
                      </label>
                      <label className={labelClass}>
                        FED ID #
                        <input
                          className={fieldClass + " font-mono"}
                          value={profile.fed_id_number}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setProfile((p) => ({
                              ...p,
                              fed_id_number: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Contact
                    </h3>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <label className={labelClass}>
                        Contact
                        <input
                          className={fieldClass}
                          value={profile.default_contact_name}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setProfile((p) => ({
                              ...p,
                              default_contact_name: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className={labelClass}>
                        Phone
                        <input
                          className={fieldClass}
                          value={profile.default_phone}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setProfile((p) => ({
                              ...p,
                              default_phone: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label
                        className={labelClass + " col-span-2"}
                      >
                        Email
                        <input
                          className={fieldClass}
                          type="email"
                          value={profile.default_email}
                          disabled={!canWrite}
                          onChange={(e) =>
                            setProfile((p) => ({
                              ...p,
                              default_email: e.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                </div>
                <label className={labelClass}>
                  Shipping preference / notes
                  <textarea
                    className={fieldClass + " min-h-[5rem]"}
                    value={profile.shipping_preference}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setProfile((p) => ({
                        ...p,
                        shipping_preference: e.target.value,
                      }))
                    }
                  />
                </label>
                {canWrite ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={profile.is_active}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          is_active: e.target.checked,
                        }))
                      }
                    />
                    Active customer
                  </label>
                ) : null}
                {canWrite ? (
                  <button
                    type="submit"
                    disabled={!dirty || saving}
                    className="rounded-lg bg-[var(--app-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Save profile"}
                  </button>
                ) : null}
              </form>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={boxContent}
                      disabled={!canManageBoxContentFlag || boxContentSaving}
                      onChange={(e) => setBoxContent(e.target.checked)}
                    />
                    Require box contents when packing
                  </label>
                  <p className="mt-1 text-xs text-slate-500">
                    When on, packers must record box contents for customs
                    packing lists.
                  </p>
                </div>
                {canManageBoxContentFlag ? (
                  <button
                    type="button"
                    disabled={
                      boxContentSaving || boxContent === (detail?.requires_box_content === true)
                    }
                    onClick={() => void saveBoxContent()}
                    className="rounded-lg bg-[var(--app-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {boxContentSaving ? "Saving…" : "Save"}
                  </button>
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {detail?.requires_box_content ? "Required" : "Not required"}
                  </p>
                )}
              </div>
            </section>
              </div>

            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Courier accounts
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Used when shippers create collect shipments. An account can
                belong to one ship-to location, or to all locations when no
                location is picked. Soft-deactivate instead of deleting.
              </p>

              <div className="mt-4 space-y-4">
                {groupCarrierAccounts(detail.carrier_accounts).map(
                  ({ carrier, accounts }) => (
                    <div key={carrier}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {carrier}
                      </h3>
                      {accounts.length === 0 ? (
                        <p className="mt-1 text-sm text-slate-500">
                          No account on file.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {accounts.map((a) => (
                            <li
                              key={a.id}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-700"
                            >
                      {editingAccountId === a.id && canWrite ? (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {a.carrier_code}
                          </div>
                          <input
                            className={fieldClass + " font-mono"}
                            value={editDraft.account_number}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                account_number: e.target.value,
                              }))
                            }
                          />
                          <label className="block text-xs font-medium text-slate-500">
                            Ship-to location
                            <select
                              className={fieldClass + " mt-1"}
                              value={editDraft.ship_to_location_id ?? ""}
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  ship_to_location_id:
                                    e.target.value || null,
                                }))
                              }
                            >
                              <option value="">
                                All locations (customer-wide)
                              </option>
                              {locations.map((loc) => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.ship_to_code} — {loc.ship_to_name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <textarea
                            className={fieldClass}
                            placeholder="Notes"
                            value={editDraft.notes}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                notes: e.target.value,
                              }))
                            }
                          />
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={editDraft.is_collect_enabled}
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  is_collect_enabled: e.target.checked,
                                }))
                              }
                            />
                            Collect enabled
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={editDraft.is_active}
                              onChange={(e) =>
                                setEditDraft((d) => ({
                                  ...d,
                                  is_active: e.target.checked,
                                }))
                              }
                            />
                            Active
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void saveCarrierAccount(a.id)}
                              className="rounded-lg bg-[var(--app-accent)] px-3 py-1.5 text-sm text-white"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingAccountId(null)}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {a.carrier_code}
                              </span>
                              {a.ship_to_location ? (
                                <span
                                  title={a.ship_to_location.ship_to_name}
                                  className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400"
                                >
                                  {a.ship_to_location.ship_to_code}
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400">
                                  All locations
                                </span>
                              )}
                              {!a.is_active ? (
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400">
                                  Inactive
                                </span>
                              ) : null}
                              {!a.is_collect_enabled ? (
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400">
                                  No collect
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 font-mono text-sm">
                              {a.account_number}
                            </div>
                            {a.notes ? (
                              <p className="mt-1 text-xs text-slate-500">
                                {a.notes}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void copyText(
                                  `${a.carrier_code} ${a.account_number}`,
                                  a.id,
                                )
                              }
                              className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                            >
                              {copiedId === a.id ? "Copied" : "Copy"}
                            </button>
                            {canWrite ? (
                              <button
                                type="button"
                                onClick={() => startEdit(a)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                              >
                                Edit
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {canWrite ? (
                        <form
                          className="mt-2 flex flex-wrap items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void addCarrierAccountForCarrier(carrier);
                          }}
                        >
                          <label
                            className="sr-only"
                            htmlFor={`new-acct-${carrier}`}
                          >
                            Account number for {carrier}
                          </label>
                          <input
                            id={`new-acct-${carrier}`}
                            className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-sm dark:border-slate-600 dark:bg-slate-900"
                            placeholder="Account number"
                            value={newAccountNumbers[carrier] ?? ""}
                            onChange={(e) =>
                              setNewAccountNumbers((d) => ({
                                ...d,
                                [carrier]: e.target.value,
                              }))
                            }
                          />
                          <label
                            className="sr-only"
                            htmlFor={`new-acct-loc-${carrier}`}
                          >
                            Ship-to location for {carrier}
                          </label>
                          <select
                            id={`new-acct-loc-${carrier}`}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                            value={newAccountLocations[carrier] ?? ""}
                            onChange={(e) =>
                              setNewAccountLocations((d) => ({
                                ...d,
                                [carrier]: e.target.value,
                              }))
                            }
                          >
                            <option value="">All locations</option>
                            {locations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                {loc.ship_to_code} — {loc.ship_to_name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            disabled={
                              saving ||
                              !(newAccountNumbers[carrier] ?? "").trim()
                            }
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-600 disabled:opacity-40"
                          >
                            Add account
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ),
                )}
              </div>


            </section>
            </div>
          </>
        ) : null}
      </div>

      <ResponseModal
        open={savedOk}
        title="Saved"
        message="Customer information updated."
        variant="success"
        onClose={() => setSavedOk(false)}
      />
    </OperationsShell>
  );
}
