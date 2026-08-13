import { describe, expect, it } from "vitest";

import { createModeSelection } from "../math";
import {
  createInitialControllerState,
  reduceControllerState,
  validateNormalizedFrequency
} from "../ui/controller";

describe("immutable duct explorer controller", () => {
  it("starts at mode (4, 1), angular frequency 30, playing, and visible", () => {
    expect(createInitialControllerState()).toEqual({
      mode: { m: 4, n: 1 },
      omegaAOverC: 30,
      playing: true,
      uiVisible: true,
      reducedMotion: false
    });
  });

  it("starts paused and remains paused when reduced motion is enabled", () => {
    const initial = createInitialControllerState({ reducedMotion: true });
    expect(initial.playing).toBe(false);

    const playing = reduceControllerState(initial, { type: "set-playing", playing: true });
    const stillReduced = reduceControllerState(playing, {
      type: "set-reduced-motion",
      reducedMotion: true
    });
    expect(stillReduced).toBe(playing);

    const normal = createInitialControllerState();
    const reduced = reduceControllerState(normal, {
      type: "set-reduced-motion",
      reducedMotion: true
    });
    expect(reduced.playing).toBe(false);
    expect(reduced.reducedMotion).toBe(true);
  });

  it("updates mode and frequency without mutating earlier state", () => {
    const initial = createInitialControllerState();
    const modeChanged = reduceControllerState(initial, {
      type: "set-mode-index",
      axis: "m",
      value: 7
    });
    const frequencyChanged = reduceControllerState(modeChanged, {
      type: "set-frequency",
      omegaAOverC: 12.5
    });

    expect(initial.mode).toEqual({ m: 4, n: 1 });
    expect(initial.omegaAOverC).toBe(30);
    expect(modeChanged.mode).toEqual({ m: 7, n: 1 });
    expect(frequencyChanged.omegaAOverC).toBe(12.5);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(frequencyChanged)).toBe(true);
    expect(Object.isFrozen(frequencyChanged.mode)).toBe(true);
  });

  it("returns the same object for accepted idempotent updates", () => {
    const initial = createInitialControllerState();
    expect(
      reduceControllerState(initial, {
        type: "set-mode",
        mode: createModeSelection(4, 1)
      })
    ).toBe(initial);
    expect(
      reduceControllerState(initial, { type: "set-frequency", omegaAOverC: 30 })
    ).toBe(initial);
  });

  it("rejects non-finite and out-of-range frequencies", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0.099, 100.001]) {
      expect(() => validateNormalizedFrequency(value)).toThrow(RangeError);
    }
    expect(validateNormalizedFrequency(0.1)).toBe(0.1);
    expect(validateNormalizedFrequency(100)).toBe(100);
  });

  it("toggles playback and clean view and resets accepted state", () => {
    let state = createInitialControllerState({
      mode: createModeSelection(8, 9),
      omegaAOverC: 12,
      reducedMotion: true
    });
    state = reduceControllerState(state, { type: "toggle-playing" });
    state = reduceControllerState(state, { type: "toggle-ui" });
    expect(state.playing).toBe(true);
    expect(state.uiVisible).toBe(false);

    state = reduceControllerState(state, { type: "reset" });
    expect(state).toEqual({
      mode: { m: 4, n: 1 },
      omegaAOverC: 30,
      playing: false,
      uiVisible: true,
      reducedMotion: true
    });
  });
});
