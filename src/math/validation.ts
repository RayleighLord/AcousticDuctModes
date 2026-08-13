import type { ModeIndex, ModeSelection } from "../types";
import {
  MAX_MODE_INDEX,
  MAX_NORMALIZED_FREQUENCY,
  MIN_MODE_INDEX,
  MIN_NORMALIZED_FREQUENCY,
} from "./constants";

export function isModeIndex(value: unknown): value is ModeIndex {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= MIN_MODE_INDEX
    && value <= MAX_MODE_INDEX;
}

export function createModeSelection(m: unknown, n: unknown): ModeSelection {
  if (!isModeIndex(m) || !isModeIndex(n)) {
    throw new RangeError(
      `Mode indices must be integers from ${MIN_MODE_INDEX} through ${MAX_MODE_INDEX}.`,
    );
  }

  return Object.freeze({ m, n });
}

export function isValidNormalizedFrequency(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= MIN_NORMALIZED_FREQUENCY
    && value <= MAX_NORMALIZED_FREQUENCY;
}

export function validateNormalizedFrequency(value: unknown): number {
  if (!isValidNormalizedFrequency(value)) {
    throw new RangeError(
      `Normalized frequency must be between ${MIN_NORMALIZED_FREQUENCY} and ${MAX_NORMALIZED_FREQUENCY}.`,
    );
  }

  return value;
}
