/**
 * Gaussian kernel density estimate — R's `density()` with its defaults.
 *
 * `plot_sampling()` in the R package draws two of these panels: one over the
 * population and one over the pooled samples. Both calls are `density(x)` with
 * no other argument, so this module ports that default path: the Gaussian
 * kernel, the `nrd0` bandwidth, a 512-point output grid, `cut = 3`, and
 * `ext = 4`. It also ports R's `from` and `to` arguments, which freeze the
 * ends of the reported window — the sampling plot uses them to keep one axis
 * across redraws. Verified against R 4.5.3 in `kde.test.ts`.
 *
 * The estimate is a convolution, and R computes it with an FFT rather than by
 * summing a kernel over every point. This port copies that: the cost is
 * linear in the count of values plus a fixed 1024-point transform, so pooling
 * a million sampled values stays fast. The steps, in R's own order:
 *
 * 1. Pick the bandwidth with `bwNrd0`.
 * 2. Set the reported window to `range(x) ± 3 * bw` (`cut = 3`), and the
 *    wider working window to `range(x) ± 7 * bw` (a further `ext = 4`).
 * 3. Spread the mass of the values over 512 equally spaced points of the
 *    working window, splitting each value between its two neighbors.
 * 4. Convolve that with a Gaussian of standard deviation `bw`, using a
 *    1024-point FFT, and clamp negative rounding noise to zero.
 * 5. Interpolate the result back onto the reported window.
 *
 * The two windows are different widths and must not be confused. A port that
 * runs the FFT over the reported window gives a visibly narrower curve.
 */

import { extent, quantiles, sd } from "./arith";

/** Points in the reported grid. R's `density(n = 512)` default. */
const GRID_SIZE = 512;

/** Points in the FFT grid. R pads the binned mass to twice its length. */
const FFT_SIZE = 2 * GRID_SIZE;

/** Bandwidths of reported window beyond the data. R's `cut = 3`. */
const CUT = 3;

/** Further bandwidths of working window beyond that. R's `ext = 4`. */
const EXT = 4;

/** `M_1_SQRT_2PI` of R's C sources. */
const INV_SQRT_2PI = 0.398942280401432677939946059934;

/** What the caller may change. R's other arguments are not ported. */
export interface KernelDensityOptions {
  /**
   * The bandwidth, the standard deviation of the kernel.
   *
   * The default is `bwNrd0(values)`, R's `bw = "nrd0"`. Giving the bandwidth
   * skips that selection, and with it the rule that the selection needs two
   * values — R does the same.
   */
  readonly bw?: number;
  /**
   * The low end of the reported window, R's `from`.
   *
   * The default is `min(x) - 3 * bw`, R's `cut = 3`. The working window still
   * reaches 4 bandwidths further out, and `binDist` drops the mass beyond it,
   * as R's `BinDist` does. So a window narrower than the data cuts the tails
   * off, and a wider one pads the curve with near-zero density — the frozen
   * axis the sampling plot needs across redraws.
   */
  readonly from?: number;
  /** The high end of the reported window, R's `to`. Same rules as `from`. */
  readonly to?: number;
}

/** The curve, in the shape of R's `density` object. */
export interface KernelDensityEstimate {
  /**
   * The 512 grid points. They run from `min(x) - 3 * bw` to
   * `max(x) + 3 * bw`, unless the caller froze an end with `from` or `to`.
   */
  readonly x: readonly number[];
  /** The density at each grid point. Never negative. */
  readonly y: readonly number[];
  /** The bandwidth the estimate used. */
  readonly bw: number;
  /**
   * The count of values the caller gave, before any were dropped. R reports
   * the same count, and scales the curve by the share that it kept.
   */
  readonly n: number;
}

/**
 * Pick a bandwidth by Silverman's rule, R's `bw.nrd0()`.
 *
 * The rule is `0.9 * min(sd, IQR / 1.34) * n^(-1/5)`. When that smaller of
 * the two spreads is 0 — every value the same, or every value repeated past
 * the quartiles — R walks a chain of fallbacks and takes the first that is
 * not 0: the standard deviation, then the size of the first value, then 1.
 * This keeps the rule from returning a bandwidth of 0, which would leave the
 * estimate undrawable.
 *
 * @param values The observations. All must be finite.
 * @returns The bandwidth. Always positive.
 * @throws RangeError Below two values. R stops with "need at least 2 data
 *   points", since the spread of one value has no meaning.
 */
export function bwNrd0(values: readonly number[]): number {
  if (values.length < 2) {
    throw new RangeError(`need at least 2 data points, got ${values.length}`);
  }

  const spread = sd(values);
  const [lowerQuartile, upperQuartile] = quantiles(values, [0.25, 0.75]);
  const iqrSpread = (upperQuartile - lowerQuartile) / 1.34;
  const scale = fallbackScale(spread, iqrSpread, values[0]);

  return 0.9 * scale * Math.pow(values.length, -0.2);
}

/** Take the first candidate of R's chain that is not 0. */
function fallbackScale(
  spread: number,
  iqrSpread: number,
  first: number,
): number {
  const smaller = Math.min(spread, iqrSpread);
  if (smaller !== 0) {
    return smaller;
  }
  if (spread !== 0) {
    return spread;
  }
  return Math.abs(first) !== 0 ? Math.abs(first) : 1;
}

/**
 * Estimate the density of the values.
 *
 * R takes a matrix here and flattens it. This port takes the flat array, so a
 * caller that pools several samples flattens them first. R flattens a matrix
 * column by column, which for `plot_sampling()` means one whole sample after
 * another.
 *
 * Values that are infinite are dropped, and the curve is scaled by the share
 * of values that remain, as in R. A value that is NaN is refused: R reads it
 * as a missing value and stops.
 *
 * @param values The observations.
 * @param options The bandwidth and the window ends, if the caller sets them.
 * @returns The grid, the density on it, the bandwidth, and the count of
 *   values given.
 * @throws RangeError If the bandwidth has to be selected from fewer than two
 *   values, if a given bandwidth is not positive and finite, if a given
 *   window end is not finite, if a value is NaN, or if no value is finite.
 */
export function kernelDensity(
  values: readonly number[],
  options: KernelDensityOptions = {},
): KernelDensityEstimate {
  const finite = finiteValuesOf(values);
  const bw = options.bw ?? bwNrd0(finite);

  if (!Number.isFinite(bw) || bw <= 0) {
    throw new RangeError(`bw must be positive and finite, got ${bw}`);
  }
  if (finite.length === 0) {
    throw new RangeError("need at least 1 finite value, got none");
  }

  if (options.from !== undefined && !Number.isFinite(options.from)) {
    throw new RangeError(`non-finite 'from': ${options.from}`);
  }
  if (options.to !== undefined && !Number.isFinite(options.to)) {
    throw new RangeError(`non-finite 'to': ${options.to}`);
  }

  const [lowest, highest] = extent(finite);
  const from = options.from ?? lowest - CUT * bw;
  const to = options.to ?? highest + CUT * bw;
  const lo = from - EXT * bw;
  const up = to + EXT * bw;

  const binned = binDist(finite, lo, up, finite.length / values.length);
  const kernel = gaussianKernel(lo, up, bw);
  const density = convolve(binned, kernel);

  const working = gridOf(lo, up);
  const x = gridOf(from, to);
  const y = x.map((point) => interpolate(working, density, point));

  return { x, y, bw, n: values.length };
}

/** Drop the values that are not finite. Refuse a value that is NaN. */
function finiteValuesOf(values: readonly number[]): readonly number[] {
  if (values.every((value) => Number.isFinite(value))) {
    return values;
  }
  if (values.some((value) => Number.isNaN(value))) {
    throw new RangeError("values contain a missing value");
  }
  return values.filter((value) => Number.isFinite(value));
}

/**
 * Spread the mass of the values over the working grid — R's `C_BinDist`.
 *
 * Each value carries mass `1 / count` and lands between two grid points. The
 * split is proportional to the distance to each: a value three quarters of
 * the way from one point to the next gives a quarter of its mass to the point
 * behind it and three quarters to the point ahead. Rounding each value to its
 * nearest point instead would step the curve.
 *
 * @param values The finite observations.
 * @param lo The low end of the working window.
 * @param up The high end of the working window.
 * @param keptShare The share of the caller's values that reached here, R's
 *   `totMass`. It is 1 unless infinite values were dropped.
 * @returns The mass on the first 512 points, zero-padded to 1024 for the FFT.
 */
function binDist(
  values: readonly number[],
  lo: number,
  up: number,
  keptShare: number,
): Float64Array {
  const bins = new Float64Array(FFT_SIZE);
  const step = (up - lo) / (GRID_SIZE - 1);
  const weight = keptShare / values.length;
  const lastPair = GRID_SIZE - 2;

  // An index loop, against the map convention of CLAUDE.md: every value adds
  // to two entries of one shared accumulator, which a map cannot express.
  // This is also the only step whose cost grows with the count of values, so
  // it stays a single pass with no allocation.
  for (let i = 0; i < values.length; i += 1) {
    const position = (values[i] - lo) / step;
    const behind = Math.floor(position);
    const ahead = position - behind;

    if (behind >= 0 && behind <= lastPair) {
      bins[behind] += (1 - ahead) * weight;
      bins[behind + 1] += ahead * weight;
    } else if (behind === -1) {
      bins[0] += ahead * weight;
    } else if (behind === lastPair + 1) {
      bins[behind] += (1 - ahead) * weight;
    }
  }

  return bins;
}

/**
 * Build the kernel over the lags of the working grid — R's `kords`.
 *
 * The grid runs from lag 0 up to twice the width of the window, and then the
 * second half is replaced by the negative lags in reverse. That folding is
 * what makes the circular convolution of the FFT behave like the ordinary one
 * over a finite window.
 */
function gaussianKernel(lo: number, up: number, bw: number): Float64Array {
  const span = ((FFT_SIZE - 1) / (GRID_SIZE - 1)) * (up - lo);
  const step = span / (FFT_SIZE - 1);
  const lags = Array.from({ length: FFT_SIZE }, (_, index) => index * step);
  const folded = lags.map((lag, index) =>
    index > GRID_SIZE ? -lags[FFT_SIZE - index] : lag,
  );

  return Float64Array.from(folded, (lag) => dnorm(lag, bw));
}

/**
 * The density of a normal distribution at `at`, centered on 0 — R's `dnorm`.
 *
 * Beyond five standard deviations R splits the value in two and exponentiates
 * each part, which keeps the far tail of the kernel accurate to the last bits.
 * This copies that split so the tails of the curve track R's.
 */
function dnorm(at: number, sd: number): number {
  const z = Math.abs(at) / sd;

  if (z < 5) {
    return (INV_SQRT_2PI * Math.exp(-0.5 * z * z)) / sd;
  }
  // Beyond this the density is below the smallest normal double.
  if (z > Math.sqrt(-2 * Math.LN2 * (-1021 + 1 - 53))) {
    return 0;
  }

  const head = Math.round(z * 65536) / 65536;
  const tail = z - head;
  return (
    (INV_SQRT_2PI / sd) *
    (Math.exp(-0.5 * head * head) * Math.exp((-0.5 * tail - head) * tail))
  );
}

/**
 * Convolve the binned mass with the kernel through the frequency domain.
 *
 * The transform of a convolution is the product of the transforms, so one
 * inverse transform of that product gives the whole curve. R does exactly
 * this, and clamps the result at 0 because the rounding of the transform can
 * leave a density slightly below 0 where it should be flat.
 *
 * @returns The density on the 512 working grid points.
 */
function convolve(binned: Float64Array, kernel: Float64Array): Float64Array {
  const massReal = Float64Array.from(binned);
  const massImaginary = new Float64Array(FFT_SIZE);
  const kernelReal = Float64Array.from(kernel);
  const kernelImaginary = new Float64Array(FFT_SIZE);

  fftInPlace(massReal, massImaginary, false);
  fftInPlace(kernelReal, kernelImaginary, false);

  // An index loop, against the map convention of CLAUDE.md: this multiplies
  // two arrays in place, one complex pair at a time, to avoid four more
  // 1024-point allocations per redraw.
  for (let i = 0; i < FFT_SIZE; i += 1) {
    const real =
      massReal[i] * kernelReal[i] +
      massImaginary[i] * kernelImaginary[i];
    const imaginary =
      massImaginary[i] * kernelReal[i] -
      massReal[i] * kernelImaginary[i];
    massReal[i] = real;
    massImaginary[i] = imaginary;
  }

  fftInPlace(massReal, massImaginary, true);

  return Float64Array.from(massReal.subarray(0, GRID_SIZE), (value) =>
    Math.max(0, value / FFT_SIZE),
  );
}

/**
 * Transform in place, by the radix-2 Cooley-Tukey algorithm.
 *
 * The length must be a power of two; here it is always 1024. The forward
 * transform matches R's `fft(z)` and the inverse matches
 * `fft(z, inverse = TRUE)`, which R leaves unscaled — the caller divides.
 *
 * @param real The real parts. Replaced by the result.
 * @param imaginary The imaginary parts. Replaced by the result.
 * @param inverse Whether to run the inverse transform.
 */
function fftInPlace(
  real: Float64Array,
  imaginary: Float64Array,
  inverse: boolean,
): void {
  const size = real.length;
  const half = size >> 1;

  // Index loops throughout, against the map convention of CLAUDE.md: the
  // algorithm is a fixed pattern of in-place swaps and butterflies over pairs
  // of indices, which is what makes it O(n log n) instead of O(n^2).
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = half;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const swappedReal = real[i];
      const swappedImaginary = imaginary[i];
      real[i] = real[j];
      imaginary[i] = imaginary[j];
      real[j] = swappedReal;
      imaginary[j] = swappedImaginary;
    }
  }

  const direction = inverse ? 1 : -1;
  const cosines = new Float64Array(half);
  const sines = new Float64Array(half);
  for (let k = 0; k < half; k += 1) {
    const angle = (direction * 2 * Math.PI * k) / size;
    cosines[k] = Math.cos(angle);
    sines[k] = Math.sin(angle);
  }

  for (let span = 1; span < size; span <<= 1) {
    const stride = half / span;
    for (let start = 0; start < size; start += span << 1) {
      for (let k = 0; k < span; k += 1) {
        const even = start + k;
        const odd = even + span;
        const cosine = cosines[k * stride];
        const sine = sines[k * stride];
        const oddReal =
          real[odd] * cosine - imaginary[odd] * sine;
        const oddImaginary =
          real[odd] * sine + imaginary[odd] * cosine;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] = real[even] + oddReal;
        imaginary[even] = imaginary[even] + oddImaginary;
      }
    }
  }
}

/**
 * Build 512 equally spaced points from `from` to `to`, as R's `seq.int` does.
 *
 * R pins both ends and computes each point between them from the start, not
 * by adding up steps. Interior points can still differ from R's by one unit
 * in the last place: R's C loop rounds its multiply-and-add once where this
 * rounds twice. That is a relative difference near 1e-16, far below the
 * tolerance the tests hold the curve to.
 */
function gridOf(from: number, to: number): number[] {
  const step = (to - from) / (GRID_SIZE - 1);
  const points = Array.from(
    { length: GRID_SIZE },
    (_, index) => from + index * step,
  );
  points[GRID_SIZE - 1] = to;
  return points;
}

/**
 * Read the density at a point between two grid points — R's `approx`.
 *
 * The search is the bisection R uses, including its two tests for landing
 * exactly on a grid point. The reported window always sits inside the working
 * window, so the two guards for a point outside it are unreachable; they hold
 * the ends flat rather than returning R's NA.
 */
function interpolate(
  grid: readonly number[],
  values: Float64Array,
  at: number,
): number {
  let low = 0;
  let high = grid.length - 1;

  if (at < grid[low]) {
    return values[low];
  }
  if (at > grid[high]) {
    return values[high];
  }

  while (low < high - 1) {
    const middle = (low + high) >> 1;
    if (at < grid[middle]) {
      high = middle;
    } else {
      low = middle;
    }
  }

  if (at === grid[high]) {
    return values[high];
  }
  if (at === grid[low]) {
    return values[low];
  }

  const lowValue = values[low];
  const highValue = values[high];
  const lowPoint = grid[low];
  const highPoint = grid[high];
  return (
    lowValue +
    (highValue - lowValue) * ((at - lowPoint) / (highPoint - lowPoint))
  );
}
