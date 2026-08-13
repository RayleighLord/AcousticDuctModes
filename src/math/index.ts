export type {
  AxialRegime,
  ControllerState,
  ModalSolution,
  ModeIndex,
  ModeSelection,
} from "../types";

export {
  CUTOFF_TOLERANCE,
  DEFAULT_MODE,
  DEFAULT_NORMALIZED_FREQUENCY,
  DEFAULT_RADIAL_SAMPLE_COUNT,
  DUCT_LENGTH_OVER_RADIUS,
  MAX_MODE_INDEX,
  MAX_NORMALIZED_FREQUENCY,
  MIN_MODE_INDEX,
  MIN_NORMALIZED_FREQUENCY,
  REFERENCE_NORMALIZED_FREQUENCY,
  REFERENCE_VISUAL_PERIOD_SECONDS,
} from "./constants";
export { besselJDerivative, besselJInteger } from "./bessel";
export {
  BESSEL_DERIVATIVE_ROOTS,
  besselDerivativeRoot,
  radialEigenvalue,
} from "./eigenvalues";
export {
  classifyAxialRegime,
  describeMode,
  pressureAt,
  radialProfileAt,
  solveMode,
} from "./modes";
export {
  advanceVisualPhase,
  normalizeVisualPhase,
  visualPhaseAt,
  visualPhaseRate,
} from "./timing";
export {
  createModeSelection,
  isModeIndex,
  isValidNormalizedFrequency,
  validateNormalizedFrequency,
} from "./validation";
