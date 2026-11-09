/**
 * Per-location carrier accounts: parsing + matching for the backfill script.
 *
 * The FedEx recipient report (fixed-width text) and the UPS address book
 * (CSV) both carry one account per recipient row — the FedEx Express Acct#
 * and the UPS account number. This module ports the two Shipping Tools
 * parsers (fxParseRecipientReport, upsRecordsFromRows) and matches each
 * record to a ship-to location by company + postal + street, so the
 * backfill script can link the account to that location.
 *
 * Pure functions only — no Prisma, no file IO — so they are unit-tested.
 */

export type FedexRecipientRecord = {
  acct: string;
  company: string;
  addr1: string;
  addr2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  fedId: string;
  phone: string;
  fedexAcct: string;
};

/** Port of Shipping Tools' fxParseRecipientReport. */
export function parseFedexRecipientReport(text: string): FedexRecipientRecord[] {
  const kept: string[] = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((ln) => {
      if (/Recipient Detail Report/.test(ln)) return;
      if (/^Fedex Express Acct#:\S+\s*$/.test(ln)) return;
      kept.push(ln);
    });
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  kept.forEach((ln) => {
    if (/^\s*Recipient Code:/.test(ln)) {
      cur = [ln];
      blocks.push(cur);
    } else if (cur) cur.push(ln);
  });
  const out: FedexRecipientRecord[] = [];
  blocks.forEach((b) => {
    const t = b.join('\n');
    const grab = (re: RegExp): string => {
      const m = t.match(re);
      return m?.[1]?.trim() ?? '';
    };
    const first = b[0] ?? '';
    const cm = first.match(/Recipient Code:\s*(.*?)\s*(?:Country:.*)?$/);
    let code = cm?.[1]?.trim() ?? '';
    if (code === '()') code = '';
    const country = grab(/Country:\s*(\S+)\s*$/m);
    const company = grab(/Company:\s*(.+?)\s*$/m);
    const phone =
      grab(/Phone:\s*(.+?)\s{2,}Ext:/m) || grab(/Phone:\s*(\S+)/m);
    const fedId =
      grab(/Customs ID\/EIN:\s*(.*?)\s{2,}Related:/m) ||
      grab(/Customs ID\/EIN:\s*(\S+)\s*$/m);
    /* the customer's own FedEx Express account (per-record field, NOT the
       page header's account, which is stripped above) */
    const fedexAcct =
      grab(/FedEx Express Acct#:\s*(.*?)\s{2,}FedEx Express T\/C/m) ||
      grab(/FedEx Express Acct#:\s*(\S+)\s*$/m);
    /* address: the Address: line plus any continuation lines up to City: */
    const addrParts: string[] = [];
    for (let i = 0; i < b.length; i++) {
      const am = (b[i] ?? '').match(/^\s*Address:\s*(.*?)\s*$/);
      if (am) {
        if (am[1]) addrParts.push(am[1]);
        for (let j = i + 1; j < b.length; j++) {
          if (/^\s*City:/.test(b[j] ?? '')) break;
          const cont = (b[j] ?? '').trim();
          if (cont) addrParts.push(cont);
        }
        break;
      }
    }
    const city =
      grab(/City:\s*(.+?)\s{2,}St\/Pv:/m) || grab(/City:\s*(.+?)\s+St\/Pv:/m);
    const state = grab(/St\/Pv:\s*(.*?)\s{2,}Zip\/Postal:/m);
    const postal = grab(/Zip\/Postal:\s*(.+?)\s*$/m);
    if (!code && !company) return;
    out.push({
      acct: code,
      company,
      addr1: addrParts[0] ?? '',
      addr2: addrParts.slice(1).join(' '),
      city,
      state,
      postal,
      country,
      fedId,
      phone,
      fedexAcct,
    });
  });
  return out;
}

export type UpsAddressRow = {
  acct: string;
  company: string;
  addr1: string;
  addr2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  phone: string;
  email: string;
  taxId: string;
  upsAcct: string;
};

function upsNormHeader(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const UPS_COLKEYS: Record<string, string[]> = {
  acct: [
    'acct',
    'code',
    'customercode',
    'customeracct',
    'custacct',
    'recipientcode',
    'customerid',
    'id',
  ],
  company: [
    'company',
    'companyorname',
    'companyname',
    'name',
    'customer',
    'customername',
  ],
  addr1: ['addr1', 'address1', 'addres1', 'address', 'street', 'streetaddress'],
  addr2: ['addr2', 'address2'],
  city: ['city', 'cityortown', 'town'],
  state: ['state', 'stateprovince', 'stateprovincecounty', 'province', 'stateprov'],
  postal: ['postal', 'postalcode', 'zip', 'zipcode'],
  country: ['country', 'countryterritory'],
  phone: ['phone', 'telephone', 'tel'],
  email: ['email', 'emailadress', 'emailaddress', 'mail'],
  taxId: ['taxid', 'taxidnumber', 'fedid', 'ein', 'customsid'],
  upsAcct: [
    'upsaccount',
    'upsacct',
    'upsnumber',
    'upsaccountnumber',
    'billingaccount',
    'ups',
  ],
  addr3: ['addr3', 'address3'],
};

function upsSplitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? '';
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Port of Shipping Tools' upsRecordsFromRows (header matched loosely). */
export function upsRecordsFromRows(rows: string[][]): UpsAddressRow[] {
  if (!rows || rows.length < 2) {
    throw new Error('That file has no data rows.');
  }
  let hi = -1;
  let map: Record<string, number> | null = null;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const hs = (rows[r] ?? []).map(upsNormHeader);
    const m2: Record<string, number> = {};
    for (const k of Object.keys(UPS_COLKEYS)) {
      for (let i = 0; i < hs.length; i++) {
        if ((UPS_COLKEYS[k] ?? []).includes(hs[i] ?? '')) {
          m2[k] = i;
          break;
        }
      }
    }
    if (m2.company !== undefined) {
      hi = r;
      map = m2;
      break;
    }
  }
  if (hi === -1 || !map) {
    throw new Error(
      'Could not find a company column in that file — the first row must be headers (Code, Company, Address, Phone, Email, Tax ID, UPS Account…).',
    );
  }
  const out: UpsAddressRow[] = [];
  for (let k = hi + 1; k < rows.length; k++) {
    const rr = rows[k] ?? [];
    const cell = (key: string): string => {
      const ix = map?.[key];
      if (ix === undefined) return '';
      const v = rr[ix];
      return v == null ? '' : String(v).trim();
    };
    const rec: UpsAddressRow = {
      acct: cell('acct'),
      company: cell('company'),
      addr1: cell('addr1'),
      addr2: cell('addr2'),
      city: cell('city'),
      state: cell('state'),
      postal: cell('postal'),
      country: cell('country'),
      phone: cell('phone'),
      email: cell('email'),
      taxId: cell('taxId'),
      upsAcct: cell('upsAcct'),
    };
    /* WorldShip has a third address line; the UPS CSV has only two, so a
       present Address3 is appended to Address 2 rather than dropped. */
    const a3 = cell('addr3');
    if (a3) rec.addr2 = rec.addr2 ? `${rec.addr2}, ${a3}` : a3;
    if (rec.acct || rec.company) out.push(rec);
  }
  if (!out.length) {
    throw new Error('No customer rows found under the header row.');
  }
  return out;
}

/** Port of Shipping Tools' upsParseDelimited + upsRecordsFromRows. */
export function parseUpsAddressBookText(text: string): UpsAddressRow[] {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) {
    throw new Error('That file has no data rows.');
  }
  const delim = (lines[0] ?? '').includes('\t') ? '\t' : ',';
  return upsRecordsFromRows(lines.map((l) => upsSplitLine(l, delim)));
}

/* ------------------------------------------------------------------ */
/* Matching a record to a ship-to location                             */
/* ------------------------------------------------------------------ */

export function normCompany(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/['".]/g, '')
    .replace(/\s+/g, ' ');
}

export function normPostal(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

export function normStreet(s: string | null | undefined): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type LocationRow = {
  id: string;
  customer_id: string;
  ship_to_code: string;
  ship_to_name: string;
  street1: string | null;
  postal_code: string | null;
};

export type AddressRecord = {
  company: string;
  addr1: string;
  postal: string;
};

/**
 * Find the one ship-to location a record belongs to. Company and postal
 * must match exactly (normalized); the street must match when both sides
 * have one — a prefix match either way covers unit/suite suffixes
 * ("17 Kallang Junction, #01-01" vs "17 Kallang Junction"). Returns null
 * when nothing matches or when several locations match (ambiguous — the
 * backfill lists it instead of guessing).
 */
export function findLocationForRecord(
  locations: readonly LocationRow[],
  record: AddressRecord,
): LocationRow | null {
  const company = normCompany(record.company);
  const postal = normPostal(record.postal);
  const street = normStreet(record.addr1);
  if (!company || !postal) return null;
  const matches = locations.filter((loc) => {
    if (normCompany(loc.ship_to_name) !== company) return false;
    if (normPostal(loc.postal_code) !== postal) return false;
    const locStreet = normStreet(loc.street1);
    if (street && locStreet) {
      if (
        street !== locStreet &&
        !street.startsWith(locStreet) &&
        !locStreet.startsWith(street)
      ) {
        return false;
      }
    }
    return true;
  });
  if (matches.length !== 1) return null;
  const [only] = matches;
  return only ?? null;
}

/* ------------------------------------------------------------------ */
/* Deciding what to do with a matched account                          */
/* ------------------------------------------------------------------ */

export type AccountDecision =
  | { action: 'create' }
  | { action: 'link'; accountId: string }
  | { action: 'already'; accountId: string }
  | {
      action: 'conflict';
      accountId: string;
      existingLocationId: string | null;
    };

/**
 * The unique key is (customer, carrier, number), so at most one row
 * exists. Link it when it is still customer-wide; leave it when it
 * already points at this location; report a conflict when it points
 * at a *different* location instead of silently moving it.
 */
export function decideAccountUpsert(
  existing: { id: string; ship_to_location_id: string | null } | null,
  locationId: string,
): AccountDecision {
  if (!existing) return { action: 'create' };
  if (existing.ship_to_location_id === locationId) {
    return { action: 'already', accountId: existing.id };
  }
  if (existing.ship_to_location_id == null) {
    return { action: 'link', accountId: existing.id };
  }
  return {
    action: 'conflict',
    accountId: existing.id,
    existingLocationId: existing.ship_to_location_id,
  };
}
