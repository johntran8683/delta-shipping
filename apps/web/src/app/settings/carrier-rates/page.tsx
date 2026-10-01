"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { ResponseModal } from "@/components/response-modal";
import { clearSession, getAccessToken, getActiveRoleCode } from "@/lib/auth-storage";
import { formatApiErrorPayload } from "@/lib/api-error";
import { apiBase } from "@/lib/config";

type CarrierCode = "FEDEX" | "UPS" | "DHL";
type CarrierEnvironment = "SANDBOX" | "PRODUCTION";

type MaskedEnv = {
  clientId: string;
  secretSet: boolean;
  secretLast4: string | null;
  accountNumber: string | null;
  isEnabled: boolean;
} | null;

type CarrierView = {
  activeEnvironment: CarrierEnvironment;
  sandbox: MaskedEnv;
  production: MaskedEnv;
};

type SettingsView = {
  origin: {
    street?: string;
    city?: string;
    stateOrProvinceCode?: string;
    postalCode: string;
    countryCode: string;
  } | null;
  carriers: Record<CarrierCode, CarrierView>;
};

type EnvForm = {
  clientId: string;
  /** Blank keeps the stored secret. */
  clientSecret: string;
  accountNumber: string;
  isEnabled: boolean;
  secretHint: string | null;
};

type CarrierForm = {
  activeEnvironment: CarrierEnvironment;
  sandbox: EnvForm;
  production: EnvForm;
};

type OriginForm = {
  street: string;
  city: string;
  stateOrProvinceCode: string;
  postalCode: string;
  countryCode: string;
};

const CARRIERS: Array<{ code: CarrierCode; name: string; docs: string }> = [
  { code: "FEDEX", name: "FedEx", docs: "developer.fedex.com → My Projects → create API project → select Rating" },
  { code: "UPS", name: "UPS", docs: "developer.ups.com → My Apps → create app → add the Rating product" },
  { code: "DHL", name: "DHL Express", docs: "developer.dhl.com → API catalog → DHL Express - MyDHL API → create an app" },
];

const inputClass =
  "w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-100/10";

const labelClass =
  "mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400";

function roleMayEditCarrierRates(): boolean {
  const code = (getActiveRoleCode() ?? "").trim().toUpperCase();
  return code === "SUPERVISOR" || code === "SYSTEM";
}

function emptyEnv(): EnvForm {
  return {
    clientId: "",
    clientSecret: "",
    accountNumber: "",
    isEnabled: false,
    secretHint: null,
  };
}

function toEnvForm(masked: MaskedEnv): EnvForm {
  if (!masked) return emptyEnv();
  return {
    clientId: masked.clientId ?? "",
    clientSecret: "",
    accountNumber: masked.accountNumber ?? "",
    isEnabled: masked.isEnabled,
    secretHint: masked.secretSet
      ? `Saved secret ending in ${masked.secretLast4 ?? "****"}`
      : null,
  };
}

export default function CarrierRatesSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<{ title: string; message: string } | null>(null);

  const [origin, setOrigin] = useState<OriginForm>({
    street: "",
    city: "",
    stateOrProvinceCode: "",
    postalCode: "",
    countryCode: "CA",
  });
  const [forms, setForms] = useState<Record<CarrierCode, CarrierForm>>({
    FEDEX: { activeEnvironment: "SANDBOX", sandbox: emptyEnv(), production: emptyEnv() },
    UPS: { activeEnvironment: "SANDBOX", sandbox: emptyEnv(), production: emptyEnv() },
    DHL: { activeEnvironment: "SANDBOX", sandbox: emptyEnv(), production: emptyEnv() },
  });

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/carrier-rates/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as SettingsView;
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (res.status === 403) {
        router.replace("/settings/delivery-notes");
        return;
      }
      if (!res.ok) {
        setError(formatApiErrorPayload(body) + (res.status ? ` (HTTP ${res.status})` : ""));
        return;
      }
      if (body.origin) {
        setOrigin({
          street: body.origin.street ?? "",
          city: body.origin.city ?? "",
          stateOrProvinceCode: body.origin.stateOrProvinceCode ?? "",
          postalCode: body.origin.postalCode ?? "",
          countryCode: body.origin.countryCode ?? "CA",
        });
      }
      const next: Record<CarrierCode, CarrierForm> = {
        FEDEX: { activeEnvironment: "SANDBOX", sandbox: emptyEnv(), production: emptyEnv() },
        UPS: { activeEnvironment: "SANDBOX", sandbox: emptyEnv(), production: emptyEnv() },
        DHL: { activeEnvironment: "SANDBOX", sandbox: emptyEnv(), production: emptyEnv() },
      };
      for (const c of CARRIERS) {
        const view = body.carriers?.[c.code];
        if (!view) continue;
        next[c.code] = {
          activeEnvironment: view.activeEnvironment ?? "SANDBOX",
          sandbox: toEnvForm(view.sandbox),
          production: toEnvForm(view.production),
        };
      }
      setForms(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!roleMayEditCarrierRates()) {
      router.replace("/settings/delivery-notes");
      return;
    }
    void load();
  }, [load, router]);

  function setOriginField(field: keyof OriginForm, value: string) {
    setOrigin((prev) => ({ ...prev, [field]: value }));
  }

  function setCarrierField(
    carrier: CarrierCode,
    env: CarrierEnvironment | "active",
    field: string,
    value: string | boolean,
  ) {
    setForms((prev) => {
      const next = { ...prev };
      const carrierForm = { ...next[carrier] };
      if (env === "active") {
        carrierForm.activeEnvironment = value as CarrierEnvironment;
      } else {
        const envKey = env === "SANDBOX" ? "sandbox" : "production";
        carrierForm[envKey] = { ...carrierForm[envKey], [field]: value };
      }
      next[carrier] = carrierForm;
      return next;
    });
  }

  async function onSave() {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/carrier-rates/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          origin: {
            street: origin.street,
            city: origin.city,
            stateOrProvinceCode: origin.stateOrProvinceCode,
            postalCode: origin.postalCode,
            countryCode: origin.countryCode,
          },
          ...Object.fromEntries(
            CARRIERS.map((c) => {
              const f = forms[c.code];
              const pick = (e: typeof f.sandbox) => ({
                clientId: e.clientId,
                clientSecret: e.clientSecret,
                accountNumber: e.accountNumber,
                isEnabled: e.isEnabled,
              });
              return [
                c.code,
                {
                  activeEnvironment: f.activeEnvironment,
                  sandbox: pick(f.sandbox),
                  production: pick(f.production),
                },
              ];
            }),
          ),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        setError(formatApiErrorPayload(body) + (res.status ? ` (HTTP ${res.status})` : ""));
        return;
      }
      setNotice("Carrier rate settings saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  async function onTest(carrier: CarrierCode, env: CarrierEnvironment) {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    const form = forms[carrier][env === "SANDBOX" ? "sandbox" : "production"];
    const key = `${carrier}:${env}`;
    setTesting(key);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/carrier-rates/test-connection`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          carrierCode: carrier,
          environment: env,
          clientId: form.clientId,
          clientSecret: form.clientSecret,
          accountNumber: form.accountNumber,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setModal({
          title: "Connection failed",
          message: formatApiErrorPayload(body),
        });
        return;
      }
      setModal({
        title: "Connection succeeded",
        message: body.detail ?? "Authentication succeeded.",
      });
    } catch (e) {
      setModal({
        title: "Connection failed",
        message: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setTesting(null);
    }
  }

  function renderEnvFields(carrier: CarrierCode, env: CarrierEnvironment) {
    const form = forms[carrier][env === "SANDBOX" ? "sandbox" : "production"];
    const testKey = `${carrier}:${env}`;
    const isDhl = carrier === "DHL";
    const idLabel = isDhl ? "API username" : "Client ID";
    const secretLabel = isDhl ? "API password" : "Client secret";
    const accountPlaceholder =
      carrier === "UPS"
        ? "6-digit shipper number"
        : carrier === "DHL"
          ? "DHL Express account number"
          : "FedEx account number";
    return (
      <div className="space-y-3 rounded-lg border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {env === "SANDBOX" ? "Sandbox (testing)" : "Production"}
          </h4>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(e) => setCarrierField(carrier, env, "isEnabled", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/20 dark:border-slate-600 dark:bg-slate-900"
            />
            Enabled
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{idLabel}</label>
            <input
              className={inputClass}
              value={form.clientId}
              onChange={(e) => setCarrierField(carrier, env, "clientId", e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelClass}>Account number</label>
            <input
              className={inputClass}
              value={form.accountNumber}
              onChange={(e) => setCarrierField(carrier, env, "accountNumber", e.target.value)}
              autoComplete="off"
              placeholder={accountPlaceholder}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>{secretLabel}</label>
          <input
            type="password"
            className={inputClass}
            value={form.clientSecret}
            onChange={(e) => setCarrierField(carrier, env, "clientSecret", e.target.value)}
            autoComplete="new-password"
            placeholder={form.secretHint ? "Leave blank to keep the saved secret" : "Paste the client secret"}
          />
          {form.secretHint ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{form.secretHint}</p>
          ) : null}
        </div>
        <div>
          <button
            type="button"
            disabled={testing === testKey}
            onClick={() => void onTest(carrier, env)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {testing === testKey ? "Testing…" : "Test connection"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <OperationsShell
      title="Carrier rates"
      subtitle="Warehouse origin address and FedEx / UPS / DHL Express API credentials for live transportation-fee estimates. Supervisor or system role only."
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <nav
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-500"
          aria-label="Breadcrumb"
        >
          <Link
            href="/settings/delivery-notes"
            className="text-slate-600 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            Settings
          </Link>
          <span className="text-slate-300 dark:text-slate-600" aria-hidden>
            /
          </span>
          <span className="text-slate-900 dark:text-slate-200">Carrier rates</span>
        </nav>

        {error ? (
          <div className="rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : (
          <>
            <section className="overflow-hidden rounded-xl border border-slate-200/90 bg-[var(--app-surface)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800/90 dark:shadow-none">
              <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Warehouse origin address
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Used as the &ldquo;from&rdquo; address for every rate quote.
                </p>
              </div>
              <div className="space-y-3 px-5 py-4">
                <div>
                  <label className={labelClass}>Street</label>
                  <input
                    className={inputClass}
                    value={origin.street}
                    onChange={(e) => setOriginField("street", e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>City</label>
                    <input
                      className={inputClass}
                      value={origin.city}
                      onChange={(e) => setOriginField("city", e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>State / Province</label>
                    <input
                      className={inputClass}
                      value={origin.stateOrProvinceCode}
                      onChange={(e) => setOriginField("stateOrProvinceCode", e.target.value)}
                      autoComplete="off"
                      placeholder="BC"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Postal code *</label>
                    <input
                      className={inputClass}
                      value={origin.postalCode}
                      onChange={(e) => setOriginField("postalCode", e.target.value)}
                      autoComplete="off"
                      placeholder="V3S 1A1"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Country code *</label>
                    <input
                      className={inputClass}
                      value={origin.countryCode}
                      onChange={(e) =>
                        setOriginField("countryCode", e.target.value.toUpperCase())
                      }
                      autoComplete="off"
                      placeholder="CA"
                      maxLength={10}
                    />
                  </div>
                </div>
              </div>
            </section>

            {CARRIERS.map((c) => (
              <section
                key={c.code}
                className="overflow-hidden rounded-xl border border-slate-200/90 bg-[var(--app-surface)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800/90 dark:shadow-none"
              >
                <div className="border-b border-slate-200/80 px-5 py-4 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {c.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {c.docs}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Quotes use
                      </span>
                      {(["SANDBOX", "PRODUCTION"] as CarrierEnvironment[]).map((env) => (
                        <button
                          key={env}
                          type="button"
                          onClick={() => setCarrierField(c.code, "active", "activeEnvironment", env)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                            forms[c.code].activeEnvironment === env
                              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                              : "border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                          }`}
                        >
                          {env === "SANDBOX" ? "Sandbox" : "Production"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-4 px-5 py-4">
                  {renderEnvFields(c.code, "SANDBOX")}
                  {renderEnvFields(c.code, "PRODUCTION")}
                </div>
              </section>
            ))}

            <div className="flex items-center justify-end gap-3 pb-8">
              <button
                type="button"
                disabled={saving}
                onClick={() => void onSave()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </>
        )}
      </div>
      {modal ? (
        <ResponseModal
          open
          title={modal.title}
          message={modal.message}
          onClose={() => setModal(null)}
        />
      ) : null}
    </OperationsShell>
  );
}
