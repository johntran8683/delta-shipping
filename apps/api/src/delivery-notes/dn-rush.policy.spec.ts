import { dn_status } from '@prisma/client';
import {
  deliveryNoteEligibleForRush,
  rushMarkBlockedMessage,
} from './dn-rush.policy';

describe('deliveryNoteEligibleForRush', () => {
  it('allows open prioritized notes', () => {
    expect(
      deliveryNoteEligibleForRush(dn_status.PRIORITIZED, true),
    ).toBe(true);
  });

  it('blocks cancelled, on hold, and closed', () => {
    expect(deliveryNoteEligibleForRush(dn_status.CANCELLED, true)).toBe(
      false,
    );
    expect(deliveryNoteEligibleForRush(dn_status.ON_HOLD, true)).toBe(false);
    expect(deliveryNoteEligibleForRush(dn_status.PICKING, false)).toBe(false);
    expect(deliveryNoteEligibleForRush(dn_status.SHIPPED, false)).toBe(
      false,
    );
  });
});

describe('rushMarkBlockedMessage', () => {
  it('describes the blocking reason', () => {
    expect(rushMarkBlockedMessage(dn_status.CANCELLED, true)).toMatch(
      /cancelled/i,
    );
    expect(rushMarkBlockedMessage(dn_status.ON_HOLD, true)).toMatch(/hold/i);
    expect(rushMarkBlockedMessage(dn_status.SHIPPED, false)).toMatch(
      /closed/i,
    );
  });
});
