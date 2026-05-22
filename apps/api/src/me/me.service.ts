import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeDeliveryNotesVisibleColumns,
  type DeliveryNotesColumnKey,
} from './delivery-notes-column-prefs';

function isMissingUserUiPreferencesTable(e: unknown): boolean {
  if (!(e instanceof PrismaClientKnownRequestError)) return false;
  if (e.code === 'P2021') return true;
  return (
    typeof e.message === 'string' &&
    e.message.includes('user_ui_preferences') &&
    e.message.includes('does not exist')
  );
}

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async getDeliveryNotesTableColumns(userId: string): Promise<{
    visibleColumns: DeliveryNotesColumnKey[];
  }> {
    try {
      const row = await this.prisma.userUiPreference.findUnique({
        where: { user_id: userId },
        select: { delivery_notes_visible_columns: true },
      });
      const raw = row?.delivery_notes_visible_columns ?? null;
      return {
        visibleColumns: normalizeDeliveryNotesVisibleColumns(raw),
      };
    } catch (e) {
      if (isMissingUserUiPreferencesTable(e)) {
        return {
          visibleColumns: normalizeDeliveryNotesVisibleColumns(null),
        };
      }
      throw e;
    }
  }

  async putDeliveryNotesTableColumns(
    userId: string,
    visibleColumns: unknown,
  ): Promise<{ visibleColumns: DeliveryNotesColumnKey[] }> {
    const normalized = normalizeDeliveryNotesVisibleColumns(visibleColumns);
    try {
      await this.prisma.userUiPreference.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          delivery_notes_visible_columns: normalized,
        },
        update: {
          delivery_notes_visible_columns: normalized,
        },
      });
      return { visibleColumns: normalized };
    } catch (e) {
      if (isMissingUserUiPreferencesTable(e)) {
        throw new ServiceUnavailableException(
          'Table user_ui_preferences is missing. From the repo root run `pnpm db:migrate`, or `pnpm --filter api run prisma:ensure-ui-prefs`. (Idempotent SQL; safe on existing databases.)',
        );
      }
      throw e;
    }
  }
}
