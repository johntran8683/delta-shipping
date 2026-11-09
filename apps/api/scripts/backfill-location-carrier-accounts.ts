/**
 * One-off backfill: link carrier accounts to ship-to locations from the
 * FedEx recipient report and the UPS address book — the two databases that
 * carry one account per recipient row.
 *
 * Usage (from apps/api, with DATABASE_URL set — e.g. `set -a && . ./.env && set +a`):
 *   pnpm backfill:location-accounts -- --fedex <recipient-report.txt> --ups <address-book.csv> [--dry-run]
 *   pnpm backfill:location-accounts -- --fedex <recipient-report.txt> --dry-run
 *
 * Either file may be omitted; at least one is required. --dry-run prints
 * what would change without writing anything.
 *
 * Matching: each record finds its location by company + postal + street
 * (see findLocationForRecord). A record with no account, no matching
 * location, or several matching locations is listed, not guessed. An
 * account number already on file as customer-wide is linked to the
 * location; one already linked elsewhere is a conflict and is left alone.
 * Locations are never created by this script — a record whose location
 * does not exist yet needs the location first (daily DN import or manual
 * creation), then a re-run.
 */
import { readFile } from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import {
  decideAccountUpsert,
  findLocationForRecord,
  parseFedexRecipientReport,
  parseUpsAddressBookText,
  type LocationRow,
} from '../src/import/location-carrier-accounts';

const prisma = new PrismaClient();

type SourceResult = {
  source: string;
  read: number;
  withAccount: number;
  created: number;
  linked: number;
  already: number;
  conflicts: string[];
  unmatched: string[];
};

const LIST_CAP = 50;

function argValue(flag: string): string | null {
  const ix = process.argv.indexOf(flag);
  if (ix === -1 || ix + 1 >= process.argv.length) return null;
  const v = process.argv[ix + 1] ?? '';
  return v.startsWith('--') ? null : v;
}

function capList(items: string[]): string {
  if (items.length <= LIST_CAP) return items.map((i) => `  • ${i}`).join('\n');
  return (
    items.slice(0, LIST_CAP).map((i) => `  • ${i}`).join('\n') +
    `\n  … and ${items.length - LIST_CAP} more`
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const fedexPath = argValue('--fedex');
  const upsPath = argValue('--ups');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  if (!fedexPath && !upsPath) {
    console.error(
      'Give at least one file: --fedex <recipient-report.txt> and/or --ups <address-book.csv>.',
    );
    process.exit(1);
  }

  const locations = (await prisma.shipToLocation.findMany({
    where: { is_active: true },
    select: {
      id: true,
      customer_id: true,
      ship_to_code: true,
      ship_to_name: true,
      street1: true,
      postal_code: true,
    },
  })) as LocationRow[];

  const accounts = await prisma.customerCarrierAccount.findMany({
    select: {
      id: true,
      customer_id: true,
      carrier_code: true,
      account_number: true,
      ship_to_location_id: true,
    },
  });
  const byKey = new Map(
    accounts.map((a) => [
      `${a.customer_id}|${a.carrier_code}|${a.account_number}`,
      a,
    ]),
  );

  const results: SourceResult[] = [];

  async function apply(
    source: string,
    carrier: string,
    records: { company: string; addr1: string; postal: string; account: string }[],
    notes: string,
  ): Promise<SourceResult> {
    const r: SourceResult = {
      source,
      read: records.length,
      withAccount: 0,
      created: 0,
      linked: 0,
      already: 0,
      conflicts: [],
      unmatched: [],
    };
    for (const rec of records) {
      if (!rec.account.trim()) continue;
      r.withAccount += 1;
      const loc = findLocationForRecord(locations, rec);
      if (!loc) {
        r.unmatched.push(
          `${rec.company} — ${rec.addr1}, ${rec.postal} (${carrier} ${rec.account})`,
        );
        continue;
      }
      const existing =
        byKey.get(
          `${loc.customer_id}|${carrier}|${rec.account.trim()}`,
        ) ?? null;
      const decision = decideAccountUpsert(existing, loc.id);
      if (decision.action === 'already') {
        r.already += 1;
        continue;
      }
      if (decision.action === 'conflict') {
        r.conflicts.push(
          `${rec.company} — ${rec.addr1}, ${rec.postal}: ${carrier} ${rec.account} already belongs to another location`,
        );
        continue;
      }
      if (dryRun) {
        if (decision.action === 'create') r.created += 1;
        else r.linked += 1;
        continue;
      }
      if (decision.action === 'create') {
        const created = await prisma.customerCarrierAccount.create({
          data: {
            customer_id: loc.customer_id,
            carrier_code: carrier,
            account_number: rec.account.trim(),
            ship_to_location_id: loc.id,
            is_collect_enabled: true,
            notes,
            is_active: true,
          },
          select: { id: true },
        });
        byKey.set(`${loc.customer_id}|${carrier}|${rec.account.trim()}`, {
          id: created.id,
          customer_id: loc.customer_id,
          carrier_code: carrier,
          account_number: rec.account.trim(),
          ship_to_location_id: loc.id,
        });
        r.created += 1;
      } else {
        await prisma.customerCarrierAccount.update({
          where: { id: decision.accountId },
          data: { ship_to_location_id: loc.id },
        });
        const prev = byKey.get(
          `${loc.customer_id}|${carrier}|${rec.account.trim()}`,
        );
        if (prev) prev.ship_to_location_id = loc.id;
        r.linked += 1;
      }
    }
    return r;
  }

  if (fedexPath) {
    const text = await readFile(fedexPath, 'utf8');
    const recs = parseFedexRecipientReport(text);
    results.push(
      await apply(
        `FedEx recipient report (${fedexPath})`,
        'FEDEX',
        recs.map((r) => ({
          company: r.company,
          addr1: r.addr1,
          postal: r.postal,
          account: r.fedexAcct,
        })),
        'Backfilled from FedEx recipient report',
      ),
    );
  }
  if (upsPath) {
    const text = await readFile(upsPath, 'utf8');
    const recs = parseUpsAddressBookText(text);
    results.push(
      await apply(
        `UPS address book (${upsPath})`,
        'UPS',
        recs.map((r) => ({
          company: r.company,
          addr1: r.addr1,
          postal: r.postal,
          account: r.upsAcct,
        })),
        'Backfilled from UPS address book',
      ),
    );
  }

  for (const r of results) {
    console.log(
      `${dryRun ? '[dry run] ' : ''}${r.source}: ${r.read} rows, ` +
        `${r.withAccount} with an account — ${r.created} created, ` +
        `${r.linked} linked, ${r.already} already linked, ` +
        `${r.conflicts.length} conflicts, ${r.unmatched.length} unmatched.`,
    );
    if (r.conflicts.length) {
      console.log('Conflicts (left alone):\n' + capList(r.conflicts));
    }
    if (r.unmatched.length) {
      console.log(
        'Unmatched (no location found — create the location, then re-run):\n' +
          capList(r.unmatched),
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
