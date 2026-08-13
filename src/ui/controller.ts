import {
  DEFAULT_MODE,
  DEFAULT_NORMALIZED_FREQUENCY,
  MAX_NORMALIZED_FREQUENCY,
  MIN_NORMALIZED_FREQUENCY,
  createModeSelection
} from "../math";
import type { ControllerState, ModeIndex, ModeSelection } from "../types";

export type ModeAxis = "m" | "n";

export interface InitialControllerOptions {
  readonly reducedMotion?: boolean;
  readonly mode?: ModeSelection;
  readonly omegaAOverC?: number;
}

export type ControllerAction =
  | { readonly type: "set-mode"; readonly mode: ModeSelection }
  | { readonly type: "set-mode-index"; readonly axis: ModeAxis; readonly value: ModeIndex }
  | { readonly type: "set-frequency"; readonly omegaAOverC: number }
  | { readonly type: "set-playing"; readonly playing: boolean }
  | { readonly type: "toggle-playing" }
  | { readonly type: "set-ui-visible"; readonly uiVisible: boolean }
  | { readonly type: "toggle-ui" }
  | { readonly type: "set-reduced-motion"; readonly reducedMotion: boolean }
  | { readonly type: "reset" };

export function createInitialControllerState(
  options: InitialControllerOptions = {}
): Readonly<ControllerState> {
  const reducedMotion = options.reducedMotion ?? false;
  const mode = options.mode ?? DEFAULT_MODE;
  const omegaAOverC = validateNormalizedFrequency(
    options.omegaAOverC ?? DEFAULT_NORMALIZED_FREQUENCY
  );

  return freezeState({
    mode: createModeSelection(mode.m, mode.n),
    omegaAOverC,
    playing: !reducedMotion,
    uiVisible: true,
    reducedMotion
  });
}

/** Pure immutable state transition for accepted application state. */
export function reduceControllerState(
  state: Readonly<ControllerState>,
  action: ControllerAction
): Readonly<ControllerState> {
  switch (action.type) {
    case "set-mode":
      return withMode(state, action.mode);
    case "set-mode-index":
      return withMode(state, {
        m: action.axis === "m" ? action.value : state.mode.m,
        n: action.axis === "n" ? action.value : state.mode.n
      });
    case "set-frequency": {
      const omegaAOverC = validateNormalizedFrequency(action.omegaAOverC);
      return omegaAOverC === state.omegaAOverC
        ? state
        : freezeState({ ...state, omegaAOverC });
    }
    case "set-playing":
      return action.playing === state.playing
        ? state
        : freezeState({ ...state, playing: action.playing });
    case "toggle-playing":
      return freezeState({ ...state, playing: !state.playing });
    case "set-ui-visible":
      return action.uiVisible === state.uiVisible
        ? state
        : freezeState({ ...state, uiVisible: action.uiVisible });
    case "toggle-ui":
      return freezeState({ ...state, uiVisible: !state.uiVisible });
    case "set-reduced-motion":
      if (action.reducedMotion === state.reducedMotion) return state;
      return freezeState({
        ...state,
        reducedMotion: action.reducedMotion,
        playing: action.reducedMotion ? false : state.playing
      });
    case "reset":
      return createInitialControllerState({ reducedMotion: state.reducedMotion });
  }
}

export function isValidNormalizedFrequency(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= MIN_NORMALIZED_FREQUENCY &&
    value <= MAX_NORMALIZED_FREQUENCY
  );
}

export function validateNormalizedFrequency(value: number): number {
  if (!isValidNormalizedFrequency(value)) {
    throw new RangeError(
      `Angular frequency must be between ${MIN_NORMALIZED_FREQUENCY} and ` +
        `${MAX_NORMALIZED_FREQUENCY}; received ${value}.`
    );
  }
  return value;
}

function withMode(
  state: Readonly<ControllerState>,
  mode: ModeSelection
): Readonly<ControllerState> {
  const validated = createModeSelection(mode.m, mode.n);
  if (validated.m === state.mode.m && validated.n === state.mode.n) return state;
  return freezeState({ ...state, mode: validated });
}

function freezeState(state: ControllerState): Readonly<ControllerState> {
  if (!Object.isFrozen(state.mode)) Object.freeze(state.mode);
  return Object.freeze(state);
}
