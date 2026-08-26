/**
 * The export surface of `@compstats/core/linalg`.
 *
 * A consumer imports by name, so a name that goes missing is a breaking
 * change. The list below is the contract; CHANGELOG.md records any change
 * to it.
 */

import { describe, expect, test } from "bun:test";
import * as linalg from "./linalg";

const EXPORTED = [
  // matrix
  "matrix",
  "fromRows",
  "fromColumns",
  "at",
  "row",
  "column",
  "toRows",
  "toColumns",
  // ops
  "t",
  "transpose",
  "matmul",
  "crossprod",
  "tcrossprod",
  "cbind",
  "rbind",
  "diag",
  "identity",
  // qr
  "DEFAULT_QR_TOLERANCE",
  "qr",
  "qrCoef",
  "qrFitted",
  "qrResid",
  "qrQty",
  "qrQy",
  "qrQ",
  "qrR",
  // lu
  "DEFAULT_SOLVE_TOLERANCE",
  "lu",
  "solve",
  "det",
  "determinant",
  "rcond",
  "matrixNorm",
  // vector
  "add",
  "sub",
  "mul",
  "div",
  "square",
  "dot",
  "norm",
  "cosine",
] as const;

describe("@compstats/core/linalg", () => {
  test("exports every documented function", () => {
    EXPORTED.forEach((name) => {
      const value = linalg[name];
      expect(typeof value === "function" || typeof value === "number").toBe(true);
    });
  });

  test("exports nothing undocumented", () => {
    expect(Object.keys(linalg).sort()).toEqual([...EXPORTED].sort());
  });

  test("one call through the entry: t(A) %*% A", () => {
    const a = linalg.matrix([1, 2, 3, 4, 5, 6], { nrow: 3 });
    expect(Array.from(linalg.crossprod(a).data)).toEqual([14, 32, 32, 77]);
  });
});
