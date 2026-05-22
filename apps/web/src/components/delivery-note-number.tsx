import { formatDeliveryNoteNumber } from "@/lib/format-dn-number";
import { RushIndicator, RushIndicatorTheme } from "@/components/rush-indicator";

type DeliveryNoteNumberProps = {
  dnNumber: string;
  isRushed?: boolean;
  rushReason?: string | null;
  className?: string;
  /** Applied to the formatted number text (not the rush marker). */
  numberClassName?: string;
};

/**
 * Formatted DN with a professional rush badge and tooltip when `isRushed`.
 */
export function DeliveryNoteNumber({
  dnNumber,
  isRushed = false,
  rushReason = null,
  className = "",
  numberClassName = "",
}: DeliveryNoteNumberProps) {
  const formatted = formatDeliveryNoteNumber(dnNumber);

  return (
    <RushIndicatorTheme className={`gap-2 ${className}`.trim()}>
      <span className={numberClassName}>{formatted}</span>
      {isRushed ? (
        <RushIndicator variant="inline" rushReason={rushReason} />
      ) : null}
    </RushIndicatorTheme>
  );
}
