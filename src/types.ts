/** Integer mode indices supported by the explorer. */
export type ModeIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * A cylindrical-duct mode. `m` is the azimuthal order and `n` is the number
 * of interior radial nodal circles.
 */
export interface ModeSelection {
  readonly m: ModeIndex;
  readonly n: ModeIndex;
}

export type AxialRegime = "propagating" | "cutoff" | "evanescent";

/** Immutable analytic data used by both the UI and the renderer. */
export interface ModalSolution {
  readonly mode: ModeSelection;
  /** The dimensionless transverse eigenvalue, displayed as k_mn. */
  readonly chi: number;
  /** The dimensionless angular frequency displayed as omega. */
  readonly omegaAOverC: number;
  readonly regime: AxialRegime;
  /** |k_x|: real for propagation, imaginary magnitude for evanescence, zero at cutoff. */
  readonly axialNumber: number;
  readonly radialNodeCount: number;
  readonly azimuthalSectorCount: number;
  /** Interior nodal radii divided by the duct radius, in ascending order. */
  readonly radialNodeRadii: readonly number[];
  /**
   * Uniform samples of the signed, normalized radial eigenfunction. Sample i
   * belongs to rho = i / (radialSamples.length - 1).
   */
  readonly radialSamples: readonly number[];
  /** Positive divisor used to normalize J_m(k_mn rho) to unit peak magnitude. */
  readonly radialNormalization: number;
}

/** Accepted application state; transient renderer state deliberately lives elsewhere. */
export interface ControllerState {
  readonly mode: ModeSelection;
  readonly omegaAOverC: number;
  readonly playing: boolean;
  readonly uiVisible: boolean;
  readonly reducedMotion: boolean;
}
