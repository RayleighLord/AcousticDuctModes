import {
  REFERENCE_NORMALIZED_FREQUENCY,
  REFERENCE_VISUAL_PERIOD_SECONDS,
} from "./constants";
import { validateNormalizedFrequency } from "./validation";

const TAU = 2 * Math.PI;

export function visualPhaseRate(omegaAOverC: number): number {
  const omega = validateNormalizedFrequency(omegaAOverC);
  return TAU / REFERENCE_VISUAL_PERIOD_SECONDS
    * (omega / REFERENCE_NORMALIZED_FREQUENCY);
}

export function normalizeVisualPhase(phase: number): number {
  if (!Number.isFinite(phase)) {
    throw new TypeError("Visual phase must be finite.");
  }
  return ((phase % TAU) + TAU) % TAU;
}

export function advanceVisualPhase(
  phase: number,
  elapsedSeconds: number,
  omegaAOverC: number,
): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError("Elapsed screen time must be finite and non-negative.");
  }
  return normalizeVisualPhase(
    phase + elapsedSeconds * visualPhaseRate(omegaAOverC),
  );
}

export function visualPhaseAt(
  elapsedSeconds: number,
  omegaAOverC: number,
  initialPhase = 0,
): number {
  return advanceVisualPhase(initialPhase, elapsedSeconds, omegaAOverC);
}
