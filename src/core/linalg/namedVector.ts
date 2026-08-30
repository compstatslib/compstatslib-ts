/**
 * R's named vector: values with a name each, in order.
 *
 * A coefficient vector is the case that matters here — `coef(fit)` in R
 * prints `(Intercept)`, `x`, `z`, `x:z` above its values, and `summary()`
 * lines the standard errors up under the same names. The port holds the
 * names alongside the values rather than in an object keyed by name,
 * because a JavaScript object moves an integer-like key to the front: a
 * column called `"1"` would jump ahead of `(Intercept)`. The pair of arrays
 * keeps R's order, and pairs with `dimnames` on a `Matrix`, so the column
 * names of a model matrix become the names of a fit with no reshaping
 * (plan Q11).
 *
 * `null` is R's `NA`: a coefficient the fit could not identify.
 */

/** Values with a name each, in order. */
export interface NamedVector {
  readonly names: readonly string[];
  /** One value per name; null where R reports `NA`. */
  readonly values: readonly (number | null)[];
}

/**
 * Pair names with values.
 *
 * @param names One name per value. Copied.
 * @param values One value per name; null for R's `NA`. Copied.
 * @throws RangeError If the two lengths differ.
 */
export function namedVector(
  names: readonly string[],
  values: readonly (number | null)[],
): NamedVector {
  if (names.length !== values.length) {
    throw new RangeError(
      `a named vector needs one name per value: ${names.length} names, ${values.length} values`,
    );
  }
  return { names: [...names], values: [...values] };
}

/**
 * Read one value by name. R's `v[["name"]]`.
 *
 * @returns The value, null where the entry is R's `NA`, or undefined when
 *   no entry carries the name. With a repeated name, the first.
 */
export function lookup(v: NamedVector, name: string): number | null | undefined {
  const index = v.names.indexOf(name);
  return index === -1 ? undefined : (v.values[index] as number | null);
}
