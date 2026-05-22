import { dn_status } from '@prisma/client';

/** Whether a supervisor may mark this delivery note as rush. */
export function deliveryNoteEligibleForRush(
  status: dn_status,
  isOpen: boolean,
): boolean {
  if (!isOpen) return false;
  if (status === dn_status.CANCELLED || status === dn_status.ON_HOLD) {
    return false;
  }
  return true;
}

export function rushMarkBlockedMessage(
  status: dn_status,
  isOpen: boolean,
): string {
  if (!isOpen) {
    return 'Cannot mark rush: delivery note is closed.';
  }
  if (status === dn_status.CANCELLED) {
    return 'Cannot mark rush: delivery note is cancelled.';
  }
  if (status === dn_status.ON_HOLD) {
    return 'Cannot mark rush: delivery note is on hold.';
  }
  return 'Cannot mark rush for this delivery note.';
}
