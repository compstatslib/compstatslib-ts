/**
 * The linear-algebra entry point: `@compstats/core/linalg`.
 *
 * Base R provides `matrix()`, `t()`, `%*%`, `crossprod()`, `cbind()`,
 * `solve()`, `qr()` and `model.matrix()`, and the R package calls them
 * without exporting anything of its own. JavaScript has none of them, so
 * the port writes them here, in R's vocabulary, over a plain column-major
 * matrix type. They live behind their own entry so that a page drawing only
 * the 2D demos does not carry them, and so that this API can settle at its
 * own pace.
 *
 * Nothing here touches the DOM. See `.claude/plans/003-PLAN-linalg/PLAN.md`
 * for the design and the decisions behind it.
 */

export {
  at,
  column,
  fromColumns,
  fromRows,
  matrix,
  row,
  toColumns,
  toRows,
} from "./core/linalg/matrix";
export type { Dimnames, Matrix, MatrixOptions } from "./core/linalg/matrix";

export {
  cbind,
  crossprod,
  diag,
  identity,
  matmul,
  rbind,
  t,
  tcrossprod,
  transpose,
} from "./core/linalg/ops";
export type { MatrixOrVector } from "./core/linalg/ops";

export {
  add,
  cosine,
  div,
  dot,
  mul,
  norm,
  square,
  sub,
} from "./core/linalg/vector";
export type { VectorOrScalar } from "./core/linalg/vector";
