import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

/**
 * Returns YYYY-MM-DD for the “business date” with a 5am cutoff
 * in the provided timezone (default America/Toronto).
 */
export function getBusinessDate(tz = process.env.NEXT_PUBLIC_TZ || "America/Toronto") {
  const now = new Date();
  // Get the local hour *in the target timezone*
  const hourInTZ = Number(formatInTimeZone(now, tz, "H")); // 0–23
  const effective = hourInTZ < 5 ? addDays(now, -1) : now;
  return formatInTimeZone(effective, tz, "yyyy-MM-dd");
}
