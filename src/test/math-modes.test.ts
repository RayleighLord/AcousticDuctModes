import { describe, expect, it } from "vitest";
import {
  CUTOFF_TOLERANCE,
  DEFAULT_MODE,
  MAX_NORMALIZED_FREQUENCY,
  MIN_NORMALIZED_FREQUENCY,
  REFERENCE_VISUAL_PERIOD_SECONDS,
  REFERENCE_NORMALIZED_FREQUENCY,
  advanceVisualPhase,
  besselDerivativeRoot,
  besselJDerivative,
  classifyAxialRegime,
  createModeSelection,
  describeMode,
  isModeIndex,
  pressureAt,
  radialProfileAt,
  solveMode,
  validateNormalizedFrequency,
  visualPhaseAt,
  visualPhaseRate,
} from "../math";
import type { ModalSolution, ModeIndex } from "../types";

const INDICES = Array.from({ length: 11 }, (_, value) => value as ModeIndex);

describe("mode validation and immutable contracts", () => {
  it("accepts precisely the declared index and frequency ranges", () => {
    for (const index of INDICES) {
      expect(isModeIndex(index)).toBe(true);
    }
    for (const invalid of [-1, 11, 1.5, Number.NaN, "2", null]) {
      expect(isModeIndex(invalid)).toBe(false);
    }

    expect(validateNormalizedFrequency(MIN_NORMALIZED_FREQUENCY)).toBe(0.1);
    expect(validateNormalizedFrequency(MAX_NORMALIZED_FREQUENCY)).toBe(100);
    expect(() => validateNormalizedFrequency(0.099)).toThrow(RangeError);
    expect(() => validateNormalizedFrequency(100.001)).toThrow(RangeError);
    expect(() => validateNormalizedFrequency(Number.NaN)).toThrow(RangeError);
  });

  it("freezes selections, solutions, and nested numeric arrays", () => {
    const mode = createModeSelection(2, 1);
    const solution = solveMode(mode, 50);
    expect(Object.isFrozen(mode)).toBe(true);
    expect(Object.isFrozen(DEFAULT_MODE)).toBe(true);
    expect(Object.isFrozen(solution)).toBe(true);
    expect(Object.isFrozen(solution.mode)).toBe(true);
    expect(Object.isFrozen(solution.radialSamples)).toBe(true);
    expect(Object.isFrozen(solution.radialNodeRadii)).toBe(true);
  });

  it("validates radial sample count", () => {
    expect(solveMode(DEFAULT_MODE, 50, 2).radialSamples).toHaveLength(2);
    expect(() => solveMode(DEFAULT_MODE, 50, 1)).toThrow(RangeError);
    expect(() => solveMode(DEFAULT_MODE, 50, 2.5)).toThrow(RangeError);
  });
});

describe("all 121 analytic hard-wall modes", () => {
  it("preserves topology, normalization, regularity, and boundary behavior", () => {
    for (const m of INDICES) {
      let previousChi = -1;
      for (const n of INDICES) {
        const solution = solveMode(createModeSelection(m, n), 50);

        expect(solution.chi).toBeGreaterThan(previousChi);
        previousChi = solution.chi;
        expect(solution.regime).toBe("propagating");
        expect(solution.radialNodeCount).toBe(n);
        expect(solution.radialNodeRadii).toHaveLength(n);
        expect(solution.azimuthalSectorCount).toBe(m === 0 ? 0 : 2 * m);
        expect(solution.radialSamples).toHaveLength(193);
        expect(solution.radialSamples.every(Number.isFinite)).toBe(true);
        expect(Math.max(...solution.radialSamples.map(Math.abs))).toBeLessThanOrEqual(1 + 1e-10);

        const axisValue = radialProfileAt(solution, 0);
        expect(axisValue).toBeCloseTo(m === 0 ? 1 : 0, 12);
        expect(Math.abs(besselJDerivative(m, solution.chi))).toBeLessThan(5e-10);

        let previousRadius = 0;
        for (const radius of solution.radialNodeRadii) {
          expect(radius).toBeGreaterThan(previousRadius);
          expect(radius).toBeLessThan(1);
          expect(Math.abs(radialProfileAt(solution, radius))).toBeLessThan(5e-10);
          previousRadius = radius;
        }

        const peakRadius = m === 0
          ? 0
          : besselDerivativeRoot(m, 0) / solution.chi;
        expect(Math.abs(radialProfileAt(solution, peakRadius))).toBeCloseTo(1, 10);

        const theta = 0.317;
        expect(pressureAt(solution, 0.61, theta + 2 * Math.PI, 0.4, 0.2))
          .toBeCloseTo(pressureAt(solution, 0.61, theta, 0.4, 0.2), 11);
      }
    }
  });
});

describe("axial dispersion and pressure fields", () => {
  const mode = createModeSelection(2, 1);
  const chi = solveMode(mode, 50, 2).chi;

  it("classifies both sides of cutoff with the declared absolute tolerance", () => {
    expect(classifyAxialRegime(chi, chi + 2 * CUTOFF_TOLERANCE)).toBe("propagating");
    expect(classifyAxialRegime(chi, chi - 2 * CUTOFF_TOLERANCE)).toBe("evanescent");
    expect(classifyAxialRegime(chi, chi)).toBe("cutoff");
    expect(classifyAxialRegime(chi, chi + CUTOFF_TOLERANCE / 2)).toBe("cutoff");
    expect(classifyAxialRegime(chi, chi - CUTOFF_TOLERANCE / 2)).toBe("cutoff");
  });

  it("uses the correct propagating and evanescent dispersion relations", () => {
    const propagating = solveMode(mode, 20);
    expect(propagating.axialNumber ** 2 + propagating.chi ** 2)
      .toBeCloseTo(propagating.omegaAOverC ** 2, 10);

    const evanescent = solveMode(mode, 2);
    expect(evanescent.chi ** 2 - evanescent.axialNumber ** 2)
      .toBeCloseTo(evanescent.omegaAOverC ** 2, 10);

    const cutoff = solveMode(mode, chi);
    expect(cutoff.regime).toBe("cutoff");
    expect(cutoff.axialNumber).toBe(0);
  });

  it("takes the real part of one combined azimuthal, axial, and temporal phase", () => {
    const solution = solveMode(mode, 20);
    const rho = 0.43;
    const theta = Math.PI / (3 * solution.mode.m);
    const axialPhase = Math.PI / 4;
    const zeta = axialPhase / solution.axialNumber;
    const radial = radialProfileAt(solution, rho);
    const actual = pressureAt(solution, rho, theta, zeta, 0);

    expect(actual).toBeCloseTo(
      radial * Math.cos(solution.mode.m * theta + axialPhase),
      12,
    );
    expect(actual).not.toBeCloseTo(
      radial * Math.cos(solution.mode.m * theta) * Math.cos(axialPhase),
      6,
    );
  });

  it("travels toward positive x, rotates azimuthally, and is phase-periodic", () => {
    const solution = solveMode(mode, 20);
    const phaseShift = 0.41;
    const movedCrest = pressureAt(
      solution,
      0.4,
      0.2,
      phaseShift / solution.axialNumber,
      phaseShift,
    );
    expect(movedCrest).toBeCloseTo(pressureAt(solution, 0.4, 0.2, 0, 0), 12);

    const rotatedPattern = pressureAt(
      solution,
      0.4,
      0.2 + phaseShift / solution.mode.m,
      0.7,
      0.31 + phaseShift,
    );
    expect(rotatedPattern)
      .toBeCloseTo(pressureAt(solution, 0.4, 0.2, 0.7, 0.31), 12);

    expect(pressureAt(solution, 0.4, 0.2, 0.7, 0.31 + 2 * Math.PI))
      .toBeCloseTo(pressureAt(solution, 0.4, 0.2, 0.7, 0.31), 12);
  });

  it("decays exponentially without acquiring axial phase", () => {
    const solution = solveMode(mode, 2);
    const atReference = pressureAt(solution, 0.42, 0.15, 0, 0.37);
    const zeta = 0.6;
    expect(pressureAt(solution, 0.42, 0.15, zeta, 0.37))
      .toBeCloseTo(atReference * Math.exp(-solution.axialNumber * zeta), 12);
  });

  it("uses the combined azimuthal-temporal phase at cutoff and when evanescent", () => {
    const theta = 0.37;
    const phase = 0.29;
    const rho = 0.46;

    for (const solution of [solveMode(mode, chi), solveMode(mode, 2)]) {
      const zeta = solution.regime === "evanescent" ? 0.52 : 0;
      const decay = solution.regime === "evanescent"
        ? Math.exp(-solution.axialNumber * zeta)
        : 1;
      expect(pressureAt(solution, rho, theta, zeta, phase)).toBeCloseTo(
        radialProfileAt(solution, rho)
          * decay
          * Math.cos(solution.mode.m * theta - phase),
        12,
      );
    }
  });

  it.each([
    solveMode(createModeSelection(1, 1), 20),
    solveMode(createModeSelection(2, 1), 2),
  ])("satisfies the dimensionless Helmholtz equation for $regime fields", (solution) => {
    expect(helmholtzResidual(solution, 0.53, 0.41, 0.27, 0.32)).toBeLessThan(2e-4);
  });
});

describe("slow-motion timing and descriptions", () => {
  it("maps Omega=50 to a four-second screen cycle and scales linearly", () => {
    expect(visualPhaseRate(REFERENCE_NORMALIZED_FREQUENCY)).toBeCloseTo(Math.PI / 2, 14);
    expect(visualPhaseAt(REFERENCE_VISUAL_PERIOD_SECONDS, 50)).toBeCloseTo(0, 12);
    expect(visualPhaseRate(25)).toBeCloseTo(visualPhaseRate(50) / 2, 14);
    expect(advanceVisualPhase(0, 2, 50)).toBeCloseTo(Math.PI, 14);
  });

  it("describes topology and regime in accessible prose", () => {
    expect(describeMode(createModeSelection(0, 0))).toContain("axisymmetric");
    expect(describeMode(createModeSelection(2, 1), 2)).toContain("2 nodal diameters");
    expect(describeMode(createModeSelection(2, 1), 2)).toContain("evanescent");
  });
});

function helmholtzResidual(
  solution: ModalSolution,
  rho: number,
  theta: number,
  zeta: number,
  phase: number,
): number {
  const h = 2e-4;
  const p = (r: number, t: number, z: number) => pressureAt(
    solution,
    r,
    t,
    z,
    phase,
  );
  const center = p(rho, theta, zeta);
  const radialFirst = (p(rho + h, theta, zeta) - p(rho - h, theta, zeta)) / (2 * h);
  const radialSecond = (
    p(rho + h, theta, zeta) - 2 * center + p(rho - h, theta, zeta)
  ) / (h * h);
  const angularSecond = (
    p(rho, theta + h, zeta) - 2 * center + p(rho, theta - h, zeta)
  ) / (h * h);
  const axialSecond = (
    p(rho, theta, zeta + h) - 2 * center + p(rho, theta, zeta - h)
  ) / (h * h);
  const laplacian = radialSecond
    + radialFirst / rho
    + angularSecond / (rho * rho)
    + axialSecond;
  return Math.abs(laplacian + solution.omegaAOverC ** 2 * center);
}
