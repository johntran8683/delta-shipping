"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken, getActiveRoleCode } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";
import { canSeeCustomersNav, canWriteCustomers } from "@/lib/import-access";

type CarrierAccount = {
  id: string;
  carrier_code: string;
  account_number: string;
  is_collect_enabled: boolean;
  notes: string | null;
  is_active: boolean;
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

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const canWrite = canWriteCustomers(getActiveRoleCode());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permHint, setPermHint] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [savedOk, setSavedOk] = useState(false);
  const [newCarrier, setNewCarrier] = useState({
    carrier_code: "FEDEX",
    account_number: "",
    notes: "",
  });
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    account_number: "",
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

  async function addCarrierAccount(e: React.FormEvent) {
    e.preventDefault();
    const token = getAccessToken();
    if (!token || !customerId || !canWrite) return;
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
            carrier_code: newCarrier.carrier_code,
            account_number: newCarrier.account_number,
            notes: newCarrier.notes || null,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(formatApiErrorPayload(body));
        return;
      }
      setDetail(body as CustomerDetail);
      setNewCarrier({ carrier_code: "FEDEX", account_number: "", notes: "" });
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
      notes: a.notes ?? "",
      is_collect_enabled: a.is_collect_enabled,
      is_active: a.is_active,
    });
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
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
      <div className="mx-auto max-w-3xl space-y-6">
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
                <div className="grid gap-3 sm:grid-cols-2">
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
                  <label className={labelClass}>
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
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Status: {detail.is_active ? "Active" : "Inactive"}
                  </p>
                )}
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
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Courier accounts
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Used when shippers create collect shipments. Soft-deactivate
                instead of deleting.
              </p>

              <ul className="mt-4 space-y-3">
                {detail.carrier_accounts.length === 0 ? (
                  <li className="text-sm text-slate-500">
                    No courier accounts on file.
                  </li>
                ) : (
                  detail.carrier_accounts.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
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
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {a.carrier_code}
                              {!a.is_active ? " · inactive" : ""}
                              {!a.is_collect_enabled ? " · no collect" : ""}
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
                                )
                              }
                              className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                            >
                              Copy
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
                  ))
                )}
              </ul>

              {canWrite ? (
                <form
                  className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700"
                  onSubmit={addCarrierAccount}
                >
                  <h3 className="text-sm font-medium">Add courier account</h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className={labelClass}>
                      Carrier
                      <select
                        className={fieldClass}
                        value={newCarrier.carrier_code}
                        onChange={(e) =>
                          setNewCarrier((c) => ({
                            ...c,
                            carrier_code: e.target.value,
                          }))
                        }
                      >
                        <option value="FEDEX">FEDEX</option>
                        <option value="UPS">UPS</option>
                        <option value="DHL">DHL</option>
                        <option value="PUROLATOR">PUROLATOR</option>
                      </select>
                    </label>
                    <label className={labelClass + " sm:col-span-2"}>
                      Account number
                      <input
                        className={fieldClass + " font-mono"}
                        required
                        value={newCarrier.account_number}
                        onChange={(e) =>
                          setNewCarrier((c) => ({
                            ...c,
                            account_number: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label className={labelClass}>
                    Notes
                    <input
                      className={fieldClass}
                      value={newCarrier.notes}
                      onChange={(e) =>
                        setNewCarrier((c) => ({
                          ...c,
                          notes: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={saving || !newCarrier.account_number.trim()}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-600 disabled:opacity-40"
                  >
                    Add account
                  </button>
                </form>
              ) : null}
            </section>
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
