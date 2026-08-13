import type { AxialRegime, ModalSolution, ModeSelection } from "../types";
import { besselJInteger } from "./bessel";
import {
  CUTOFF_TOLERANCE,
  DEFAULT_NORMALIZED_FREQUENCY,
  DEFAULT_RADIAL_SAMPLE_COUNT,
} from "./constants";
import { besselDerivativeRoot, radialEigenvalue } from "./eigenvalues";
import { createModeSelection, validateNormalizedFrequency } from "./validation";

export function classifyAxialRegime(
  chi: number,
  omegaAOverC: number,
): AxialRegime {
  if (!Number.isFinite(chi) || chi < 0) {
    throw new RangeError("Transverse eigenvalue must be finite and non-negative.");
  }
  const omega = validateNormalizedFrequency(omegaAOverC);
  const distanceFromCutoff = omega - chi;
  if (Math.abs(distanceFromCutoff) <= CUTOFF_TOLERANCE) {
    return "cutoff";
  }
  return distanceFromCutoff > 0 ? "propagating" : "evanescent";
}

function radialNormalization(mode: ModeSelection, chi: number): number {
  if (chi === 0) {
    return 1;
  }

  let peak = Math.abs(besselJInteger(mode.m, 0));
  // Every interior radial extremum is a derivative root. Inspecting them
  // makes the normalization analytic rather than sampling-resolution based.
  for (let rootIndex = 0; rootIndex <= mode.n; rootIndex += 1) {
    const extremum = besselDerivativeRoot(mode.m, rootIndex as ModeSelection["n"]);
    if (extremum <= chi + CUTOFF_TOLERANCE) {
      peak = Math.max(peak, Math.abs(besselJInteger(mode.m, extremum)));
    }
  }
  peak = Math.max(peak, Math.abs(besselJInteger(mode.m, chi)));

  if (!(peak > 0) || !Number.isFinite(peak)) {
    throw new Error("Could not normalize the radial eigenfunction.");
  }
  return peak;
}

function besselZeroBetween(order: number, lower: number, upper: number): number {
  let left = lower;
  let right = upper;
  let leftValue = besselJInteger(order, left);

  // Interlacing of J_m and J'_m guarantees one and only one root in each of
  // these brackets. Seventy iterations put the result well below one ulp.
  for (let iteration = 0; iteration < 70; iteration += 1) {
    const middle = (left + right) / 2;
    const middleValue = besselJInteger(order, middle);
    if (middleValue === 0) {
      return middle;
    }
    if (Math.sign(leftValue) === Math.sign(middleValue)) {
      left = middle;
      leftValue = middleValue;
    } else {
      right = middle;
    }
  }
  return (left + right) / 2;
}

function interiorRadialNodeRadii(mode: ModeSelection, chi: number): readonly number[] {
  const radii: number[] = [];
  for (let nodeIndex = 0; nodeIndex < mode.n; nodeIndex += 1) {
    const lower = besselDerivativeRoot(mode.m, nodeIndex as ModeSelection["n"]);
    const upper = besselDerivativeRoot(mode.m, (nodeIndex + 1) as ModeSelection["n"]);
    radii.push(besselZeroBetween(mode.m, lower, upper) / chi);
  }
  return Object.freeze(radii);
}

function validateSampleCount(sampleCount: number): number {
  if (!Number.isInteger(sampleCount) || sampleCount < 2) {
    throw new RangeError("Radial sample count must be an integer of at least 2.");
  }
  return sampleCount;
}

export function solveMode(
  selection: ModeSelection,
  omegaAOverC: number,
  sampleCount = DEFAULT_RADIAL_SAMPLE_COUNT,
): ModalSolution {
  const mode = createModeSelection(selection.m, selection.n);
  const omega = validateNormalizedFrequency(omegaAOverC);
  const count = validateSampleCount(sampleCount);
  const chi = radialEigenvalue(mode);
  const regime = classifyAxialRegime(chi, omega);
  const axialNumber = regime === "cutoff"
    ? 0
    : Math.sqrt(Math.abs(omega * omega - chi * chi));
  const normalization = radialNormalization(mode, chi);

  const radialSamples = Array.from({ length: count }, (_, index) => {
    const rho = index / (count - 1);
    const value = chi === 0
      ? 1
      : besselJInteger(mode.m, chi * rho) / normalization;
    return Math.abs(value) < 1e-15 ? 0 : value;
  });

  return Object.freeze({
    mode,
    chi,
    omegaAOverC: omega,
    regime,
    axialNumber,
    radialNodeCount: mode.n,
    azimuthalSectorCount: mode.m === 0 ? 0 : 2 * mode.m,
    radialNodeRadii: interiorRadialNodeRadii(mode, chi),
    radialSamples: Object.freeze(radialSamples),
    radialNormalization: normalization,
  });
}

export function radialProfileAt(solution: ModalSolution, rho: number): number {
  if (!Number.isFinite(rho) || rho < 0 || rho > 1) {
    throw new RangeError("Normalized radius rho must lie between 0 and 1.");
  }
  if (solution.chi === 0) {
    return 1;
  }
  return besselJInteger(solution.mode.m, solution.chi * rho)
    / solution.radialNormalization;
}

/** Evaluate dimensionless pressure at cylindrical coordinates and visual phase. */
export function pressureAt(
  solution: ModalSolution,
  rho: number,
  theta: number,
  zeta: number,
  phase: number,
): number {
  if (!Number.isFinite(theta) || !Number.isFinite(phase)) {
    throw new TypeError("Angle and phase must be finite.");
  }
  if (!Number.isFinite(zeta) || zeta < 0) {
    throw new RangeError("Normalized axial coordinate zeta must be non-negative.");
  }

  const radial = radialProfileAt(solution, rho);
  const azimuthalPhase = solution.mode.m * theta;
  if (solution.regime === "propagating") {
    return radial * Math.cos(
      azimuthalPhase + solution.axialNumber * zeta - phase,
    );
  }
  if (solution.regime === "evanescent") {
    return radial
      * Math.exp(-solution.axialNumber * zeta)
      * Math.cos(azimuthalPhase - phase);
  }
  return radial * Math.cos(azimuthalPhase - phase);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Concise accessible prose for the currently accepted mode. */
export function describeMode(
  selection: ModeSelection,
  omegaAOverC = DEFAULT_NORMALIZED_FREQUENCY,
): string {
  const solution = solveMode(selection, omegaAOverC, 2);
  const topology = solution.mode.m === 0
    ? "axisymmetric"
    : `${plural(solution.mode.m, "nodal diameter")} and ${plural(solution.azimuthalSectorCount, "azimuthal sector")}`;
  return `Azimuthal order ${solution.mode.m}, radial order ${solution.mode.n}: ${topology}, ${plural(solution.radialNodeCount, "interior radial nodal circle")}; ${solution.regime} at angular frequency ${solution.omegaAOverC}.`;
}
