/**
 * Report the machine precision of the runtime.
 *
 * The value is the smallest number x such that 1 + x is not equal to 1.
 * It is the equivalent of `.Machine$double.eps` in R.
 *
 * @returns The double-precision epsilon.
 */
export function machinePrecision(): number {
  return Number.EPSILON;
}
