/**
 * One-off backfill: fill country_code on ship-to locations that have a
 * country_name but no country_code (imported from workbooks with a
 * "Country" name column but no code column).
 *
 * Usage (from apps/api, with DATABASE_URL set — e.g. `set -a && . ./.env && set +a`):
 *   pnpm backfill:country-codes -- --dry-run   # preview only
 *   pnpm backfill:country-codes                # apply
 *
 * Only updates rows whose name maps to a known ISO code. Rows it cannot map
 * are listed so they can be fixed by hand.
 */
import { PrismaClient } from '@prisma/client';
import { countryCodeFromName } from '../src/carrier-rates/country-codes';

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const rows = await prisma.shipToLocation.findMany({
    where: {
      OR: [{ country_code: null }, { country_code: '' }],
      NOT: [{ country_name: null }, { country_name: '' }],
    },
    select: {
      id: true,
      ship_to_code: true,
      ship_to_name: true,
      country_name: true,
    },
  });

  let updated = 0;
  const unmapped: string[] = [];
  for (const row of rows) {
    const code = countryCodeFromName(row.country_name);
    if (!code) {
      unmapped.push(
        `${row.ship_to_code} (${row.ship_to_name}): "${row.country_name}"`,
      );
      continue;
    }
    if (!dryRun) {
      await prisma.shipToLocation.update({
        where: { id: row.id },
        data: { country_code: code },
      });
    }
    updated++;
  }

  console.log(
    `${dryRun ? '[dry run] ' : ''}Scanned ${rows.length} ship-to location(s) ` +
      `with a country name but no code: ${updated} mapped to a code, ` +
      `${unmapped.length} could not be mapped.`,
  );
  if (unmapped.length > 0) {
    console.log('Unmapped (fix by hand):');
    for (const line of unmapped) console.log(`  - ${line}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
