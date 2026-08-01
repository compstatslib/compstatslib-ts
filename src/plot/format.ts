/**
 * Number formatting shared by the plots.
 *
 * R writes numbers into a plot through `round(x, 2)` and its own coercion to
 * text. Both the regression stats block and the t-test error matrix need that
 * same treatment, so it lives here rather than in either of them.
 */

/**
 * Round to two decimals for display, and report a missing value as R does.
 *
 * R prints `round(x, 2)`, which drops a trailing zero, so 2.50 reads as "2.5".
 * R rounds half to even and this rounds half away from zero; the two differ
 * only on an exact half at the third decimal.
 *
 * @param value The number to show. Null and non-finite read as "NA".
 * @returns The text to draw.
 */
export function formatStat(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "NA";
  }
  return String(Math.round(value * 100) / 100);
}

/** How many significant digits R keeps when it turns a double into text. */
const R_SIGNIFICANT_DIGITS = 15;

/**
 * Write a number the way R's `as.character()` does.
 *
 * R keeps 15 significant digits and drops what follows, so `1 - 0.07` prints
 * as "0.93". JavaScript's `String()` instead keeps every digit needed to
 * identify the double, and prints the same subtraction as
 * "0.9299999999999999". The t-test error matrix draws `1 - alpha` untouched,
 * and alpha steps in hundredths, so without this the panel shows that run of
 * nines at one of its ten settings.
 *
 * @param value The number to show.
 * @returns The text to draw. Non-finite reads as "NA", as elsewhere.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "NA";
  }
  return String(Number(value.toPrecision(R_SIGNIFICANT_DIGITS)));
}
