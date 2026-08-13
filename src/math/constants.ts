import type { ModeIndex, ModeSelection } from "../types";

export const MIN_MODE_INDEX: ModeIndex = 0;
export const MAX_MODE_INDEX: ModeIndex = 10;

export const MIN_NORMALIZED_FREQUENCY = 0.1;
export const MAX_NORMALIZED_FREQUENCY = 100;
export const DEFAULT_NORMALIZED_FREQUENCY = 30;

export const CUTOFF_TOLERANCE = 1e-6;
export const DEFAULT_RADIAL_SAMPLE_COUNT = 193;
export const DUCT_LENGTH_OVER_RADIUS = 3;

export const REFERENCE_NORMALIZED_FREQUENCY = 50;
export const REFERENCE_VISUAL_PERIOD_SECONDS = 4;

export const DEFAULT_MODE: ModeSelection = Object.freeze({ m: 4, n: 1 });
