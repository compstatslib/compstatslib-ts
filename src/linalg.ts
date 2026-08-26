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
  DEFAULT_QR_TOLERANCE,
  qr,
  qrCoef,
  qrFitted,
  qrQ,
  qrQty,
  qrQy,
  qrR,
  qrResid,
} from "./core/linalg/qr";
export type { QrDecomposition, QrOptions } from "./core/linalg/qr";

export {
  DEFAULT_SOLVE_TOLERANCE,
  det,
  determinant,
  lu,
  matrixNorm,
  rcond,
  solve,
} from "./core/linalg/lu";
export type { LuDecomposition, MatrixNormType, SolveOptions } from "./core/linalg/lu";

export { lookup, namedVector } from "./core/linalg/namedVector";
export type { NamedVector } from "./core/linalg/namedVector";

export { modelMatrix } from "./core/linalg/modelMatrix";
export type { ModelMatrix, ModelSpec, Term } from "./core/linalg/modelMatrix";

export { lm } from "./core/linalg/lm";
export type { FStatistic, LmFit, LmOptions } from "./core/linalg/lm";

export { cor, cov, variance } from "./core/linalg/cov";
export { eigenSymmetric, isSymmetric } from "./core/linalg/eigen";
export type { SymmetricEigen } from "./core/linalg/eigen";
export { prcomp } from "./core/linalg/prcomp";
export type { Prcomp, PrcompOptions } from "./core/linalg/prcomp";

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
