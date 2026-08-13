import katex from "katex";

import { DEFAULT_MODE } from "../math";
import type { ModeIndex, ModeSelection } from "../types";
import type { ModeAxis } from "./controller";

export const MIN_MODE_INDEX = 0;
export const MAX_MODE_INDEX = 10;

export interface ModeSelectorChange {
  readonly axis: ModeAxis;
  readonly value: ModeIndex;
  readonly values: ModeSelection;
}

export interface ModeSelectorsOptions {
  readonly initialValues?: Partial<ModeSelection>;
  readonly onChange?: (change: ModeSelectorChange) => void;
  readonly onCommit?: (change: ModeSelectorChange) => void;
}

interface SelectorElements {
  readonly field: HTMLElement;
  readonly input: HTMLInputElement;
  readonly value: HTMLOutputElement;
}

/** Controlled native vertical sliders for the analytic mode indices. */
export class ModeSelectors {
  readonly root: HTMLElement;

  private readonly options: ModeSelectorsOptions;
  private readonly selectors: Record<ModeAxis, SelectorElements>;
  private readonly cleanup: Array<() => void> = [];
  private destroyed = false;

  constructor(host: HTMLElement, options: ModeSelectorsOptions = {}) {
    this.root = host;
    this.options = options;
    this.root.classList.add("mode-selectors");
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", "Choose azimuthal and radial mode numbers");

    const initialValues: ModeSelection = {
      m: normalizeModeIndex(options.initialValues?.m ?? DEFAULT_MODE.m),
      n: normalizeModeIndex(options.initialValues?.n ?? DEFAULT_MODE.n)
    };

    this.selectors = {
      m: this.createSelector("m", initialValues.m),
      n: this.createSelector("n", initialValues.n)
    };
    this.root.replaceChildren(this.selectors.m.field, this.selectors.n.field);
    this.bindSelector("m");
    this.bindSelector("n");
    this.setValues(initialValues);
  }

  setValues(values: Readonly<ModeSelection>): void {
    this.assertActive();
    this.updateSelector("m", normalizeModeIndex(values.m));
    this.updateSelector("n", normalizeModeIndex(values.n));
  }

  getValues(): ModeSelection {
    this.assertActive();
    return this.readValues();
  }

  setDisabled(disabled: boolean): void {
    this.assertActive();
    this.selectors.m.input.disabled = disabled;
    this.selectors.n.input.disabled = disabled;
    this.root.setAttribute("aria-disabled", String(disabled));
  }

  focus(axis: ModeAxis): void {
    this.assertActive();
    this.selectors[axis].input.focus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const dispose of this.cleanup.splice(0)) dispose();
    this.root.replaceChildren();
    this.root.classList.remove("mode-selectors");
    this.root.removeAttribute("role");
    this.root.removeAttribute("aria-label");
    this.root.removeAttribute("aria-disabled");
  }

  private createSelector(axis: ModeAxis, initialValue: ModeIndex): SelectorElements {
    const field = document.createElement("section");
    field.className = "mode-selector";
    field.dataset.axis = axis;

    const heading = document.createElement("div");
    heading.className = "mode-selector__heading";

    const label = document.createElement("label");
    label.className = "mode-selector__label";
    label.htmlFor = `${axis}-slider`;
    renderMath(label, axis);

    const value = document.createElement("output");
    value.id = `${axis}-value-math`;
    value.className = "mode-selector__value";
    value.htmlFor = `${axis}-slider`;
    value.setAttribute("aria-hidden", "true");
    heading.append(label, value);

    const sliderFrame = document.createElement("div");
    sliderFrame.className = "mode-selector__slider-frame";

    const ticks = document.createElement("div");
    ticks.className = "mode-selector__ticks";
    ticks.setAttribute("aria-hidden", "true");
    for (let tick = MAX_MODE_INDEX; tick >= MIN_MODE_INDEX; tick -= 1) {
      const mark = document.createElement("span");
      mark.className = "mode-selector__tick";
      mark.textContent = String(tick);
      ticks.append(mark);
    }

    const input = document.createElement("input");
    input.id = `${axis}-slider`;
    input.className = "mode-selector__range";
    input.type = "range";
    input.min = String(MIN_MODE_INDEX);
    input.max = String(MAX_MODE_INDEX);
    input.step = "1";
    input.value = String(initialValue);
    input.setAttribute("orient", "vertical");
    input.setAttribute(
      "aria-label",
      axis === "m" ? "Azimuthal mode number m" : "Radial mode number n"
    );
    input.setAttribute("aria-valuetext", String(initialValue));
    sliderFrame.append(ticks, input);
    field.append(heading, sliderFrame);
    return { field, input, value };
  }

  private bindSelector(axis: ModeAxis): void {
    const input = this.selectors[axis].input;
    const onInput = (): void => {
      const value = normalizeModeIndex(Number(input.value));
      this.updateSelector(axis, value);
      this.options.onChange?.(this.makeChange(axis, value));
    };
    const onChange = (): void => {
      const value = normalizeModeIndex(Number(input.value));
      this.updateSelector(axis, value);
      this.options.onCommit?.(this.makeChange(axis, value));
    };
    input.addEventListener("input", onInput);
    input.addEventListener("change", onChange);
    this.cleanup.push(
      () => input.removeEventListener("input", onInput),
      () => input.removeEventListener("change", onChange)
    );
  }

  private makeChange(axis: ModeAxis, value: ModeIndex): ModeSelectorChange {
    return { axis, value, values: this.readValues() };
  }

  private readValues(): ModeSelection {
    return {
      m: normalizeModeIndex(Number(this.selectors.m.input.value)),
      n: normalizeModeIndex(Number(this.selectors.n.input.value))
    };
  }

  private updateSelector(axis: ModeAxis, value: ModeIndex): void {
    const selector = this.selectors[axis];
    selector.input.value = String(value);
    selector.input.setAttribute("aria-valuetext", String(value));
    selector.input.style.setProperty("--mode-progress", `${value * 10}%`);
    renderMath(selector.value, `${axis}=${value}`);
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error("ModeSelectors has been destroyed.");
  }
}

export function isValidModeIndex(value: number): value is ModeIndex {
  return Number.isInteger(value) && value >= MIN_MODE_INDEX && value <= MAX_MODE_INDEX;
}

function normalizeModeIndex(value: number): ModeIndex {
  if (!isValidModeIndex(value)) {
    throw new RangeError(`Mode indices must be integers from 0 through 10; received ${value}.`);
  }
  return value;
}

function renderMath(element: HTMLElement, tex: string): void {
  katex.render(tex, element, {
    displayMode: false,
    throwOnError: false,
    strict: false,
    trust: false,
    output: "htmlAndMathml"
  });
}
