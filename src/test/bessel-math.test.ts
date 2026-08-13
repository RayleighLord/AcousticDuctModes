import { describe, expect, it } from "vitest";
import {
  BESSEL_DERIVATIVE_ROOTS,
  besselJDerivative,
  besselJInteger,
} from "../math";

describe("integer-order Bessel evaluation", () => {
  it.each([
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0.7651976865579666],
    [1, 1, 0.44005058574493355],
    [2, 1, 0.1149034849319005],
    [0, 20, 0.16702466434058322],
    [1, 20, 0.06683312417584993],
    [7, 20, -0.18422139772059445],
    [10, 46.8289594465646, 0.11795191665644031],
  ])("matches a trusted reference for J_%i(%f)", (order, x, expected) => {
    expect(besselJInteger(order, x)).toBeCloseTo(expected, 10);
  });

  it("obeys integer-order and argument parity", () => {
    for (let order = 0; order <= 10; order += 1) {
      const parity = order % 2 === 0 ? 1 : -1;
      expect(besselJInteger(order, -4.5)).toBeCloseTo(
        parity * besselJInteger(order, 4.5),
        13,
      );
      expect(besselJInteger(-order, 4.5)).toBeCloseTo(
        parity * besselJInteger(order, 4.5),
        13,
      );
    }
  });

  it("matches a centered numerical derivative", () => {
    // A slightly wider stencil avoids magnifying the last few ulps of the
    // alternating power series around x = 15.
    const h = 2e-4;
    for (let order = 0; order <= 10; order += 1) {
      for (const x of [0.5, 5, 15, 30, 46]) {
        const finiteDifference = (
          besselJInteger(order, x + h) - besselJInteger(order, x - h)
        ) / (2 * h);
        expect(besselJDerivative(order, x)).toBeCloseTo(finiteDifference, 6);
      }
    }
  });

  it("rejects non-integer orders and non-finite arguments", () => {
    expect(() => besselJInteger(0.5, 1)).toThrow(TypeError);
    expect(() => besselJInteger(0, Number.NaN)).toThrow(TypeError);
    expect(() => besselJDerivative(1, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("verified J'_m root table", () => {
  it("contains exactly 121 finite, increasing convention-aligned roots", () => {
    expect(BESSEL_DERIVATIVE_ROOTS).toHaveLength(11);
    expect(BESSEL_DERIVATIVE_ROOTS[0]?.[0]).toBe(0);

    for (const row of BESSEL_DERIVATIVE_ROOTS) {
      expect(row).toHaveLength(11);
      for (let index = 0; index < row.length; index += 1) {
        expect(Number.isFinite(row[index])).toBe(true);
        if (index > 0) {
          expect(row[index] as number).toBeGreaterThan(row[index - 1] as number);
        }
      }
    }
  });

  it("satisfies the rigid-wall derivative condition for all 121 modes", () => {
    for (let m = 0; m <= 10; m += 1) {
      for (let n = 0; n <= 10; n += 1) {
        const chi = BESSEL_DERIVATIVE_ROOTS[m]?.[n];
        expect(chi).toBeDefined();
        expect(Math.abs(besselJDerivative(m, chi as number))).toBeLessThan(5e-10);
      }
    }
  });
});
