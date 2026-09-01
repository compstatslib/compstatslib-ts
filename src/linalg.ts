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
  fromFrame,
  fromRows,
  matrix,
  row,
  toColumns,
  toRows,
} from "./core/linalg/matrix.js";
export type { Dimnames, Matrix, MatrixOptions } from "./core/linalg/matrix.js";

export type { FmaOption } from "./core/arith.js";
export {
  cbind,
  crossprod,
  diag,
  identity,
  matmul,
  outer,
  rbind,
  t,
  tcrossprod,
  transpose,
} from "./core/linalg/ops.js";
export type { MatrixOrVector } from "./core/linalg/ops.js";

export {
  DEFAULT_QR_TOLERANCE,
  qr,
  qrCoef,
  qrFitted,
  qrQ,
  qrQty,
  qrQy,
  qrR,
  qrResid,
} from "./core/linalg/qr.js";
export type { QrDecomposition, QrOptions } from "./core/linalg/qr.js";

export {
  DEFAULT_SOLVE_TOLERANCE,
  det,
  determinant,
  lu,
  matrixNorm,
  rcond,
  solve,
} from "./core/linalg/lu.js";
export type { LuDecomposition, LuOptions, MatrixNormType, SolveOptions } from "./core/linalg/lu.js";

export { lookup, namedVector } from "./core/linalg/namedVector.js";
export type { NamedVector } from "./core/linalg/namedVector.js";

export { modelMatrix } from "./core/linalg/modelMatrix.js";
export type { ModelMatrix, ModelSpec, Term } from "./core/linalg/modelMatrix.js";

export { lm, predictLm } from "./core/linalg/lm.js";
export type { FStatistic, LmFit, LmOptions } from "./core/linalg/lm.js";

export { cor, cov, variance } from "./core/linalg/cov.js";
export { scale } from "./core/linalg/scale.js";
export type { Scaled, ScaleOptions } from "./core/linalg/scale.js";
export { chol, chol2inv } from "./core/linalg/chol.js";
export type { CholOptions } from "./core/linalg/chol.js";
export { eigenSymmetric, isSymmetric } from "./core/linalg/eigen.js";
export type { SymmetricEigen } from "./core/linalg/eigen.js";
export { prcomp } from "./core/linalg/prcomp.js";
export type { Prcomp, PrcompOptions } from "./core/linalg/prcomp.js";

export {
  add,
  cosine,
  div,
  dot,
  mul,
  norm,
  square,
  sub,
} from "./core/linalg/vector.js";
export type { Vector, VectorOrScalar } from "./core/linalg/vector.js";
