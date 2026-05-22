/**
 * Seed: permissions + optional admin user.
 * Requires DB with schema-v1.sql applied and roles seeded.
 * Run: pnpm prisma db seed --schema=prisma/schema.prisma (from apps/api)
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  PERMISSION_MANIFEST,
  ROLE_PERMISSION_DEFAULTS,
} from '../src/access-control/permissions.manifest';

const prisma = new PrismaClient();

async function seedPermissions() {
  for (const entry of PERMISSION_MANIFEST) {
    await prisma.permission.upsert({
      where: { code: entry.code },
      create: { code: entry.code, description: entry.description },
      update: { description: entry.description },
    });
  }

  for (const [roleCode, permCodes] of Object.entries(ROLE_PERMISSION_DEFAULTS)) {
    const role = await prisma.role.findUnique({ where: { code: roleCode } });
    if (!role) {
      console.warn(`Role ${roleCode} missing; skip permission wiring.`);
      continue;
    }
    for (const code of permCodes) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) continue;
      const exists = await prisma.rolePermission.findFirst({
        where: { role_id: role.id, permission_id: perm.id },
      });
      if (!exists) {
        await prisma.rolePermission.create({
          data: { role_id: role.id, permission_id: perm.id },
        });
      }
    }
  }

  console.log('Permissions and role wiring updated (idempotent).');
}

async function seedAdminIfNeeded() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeAdmin123!';
  const hash = await bcrypt.hash(password, 10);

  const supervisor = await prisma.role.findUnique({
    where: { code: 'SUPERVISOR' },
  });
  if (!supervisor) {
    throw new Error('Role SUPERVISOR not found. Apply schema-v1.sql first.');
  }

  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (existing) {
    console.log('Admin user seed skipped (already exists):', email);
    return;
  }

  const ops = await prisma.role.findMany({
    where: { code: { in: ['SUPERVISOR', 'PICKER', 'PACKER', 'SHIPPER'] } },
  });

  await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      display_name: 'Administrator',
      password_hash: hash,
      user_roles_assigned: {
        create: ops.map((r) => ({ role_id: r.id })),
      },
    },
  });

  console.log(
    'Seeded admin user (all operational roles for dev):',
    email,
  );
}

/** PICKER + PACKER + SHIPPER only — triggers web “choose role” after login. */
async function seedMultiRoleTestUserIfNeeded() {
  const email =
    process.env.SEED_MULTI_ROLE_USER_EMAIL ?? 'user@example.com';
  const password =
    process.env.SEED_MULTI_ROLE_USER_PASSWORD ?? 'ChangeMeUser123!';
  const hash = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (existing) {
    console.log('Multi-role test user seed skipped (already exists):', email);
    return;
  }

  const roles = await prisma.role.findMany({
    where: { code: { in: ['PICKER', 'PACKER', 'SHIPPER'] } },
  });
  if (roles.length !== 3) {
    throw new Error(
      'Expected PICKER, PACKER, SHIPPER roles in DB. Apply schema-v1.sql first.',
    );
  }

  await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      display_name: 'Multi-role test user',
      password_hash: hash,
      user_roles_assigned: {
        create: roles.map((r) => ({ role_id: r.id })),
      },
    },
  });

  console.log(
    'Seeded multi-role test user (PICKER, PACKER, SHIPPER):',
    email,
  );
}

async function main() {
  await seedPermissions();
  await seedAdminIfNeeded();
  await seedMultiRoleTestUserIfNeeded();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
