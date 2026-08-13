import katex from "katex";

import {
  MAX_NORMALIZED_FREQUENCY,
  MIN_NORMALIZED_FREQUENCY,
  isValidNormalizedFrequency
} from "../math";

export interface FrequencyControlOptions {
  readonly initialValue: number;
  readonly onCommit?: (omegaAOverC: number) => void;
}

/**
 * A controlled numeric field. Valid drafts are accepted as they are typed;
 * incomplete or invalid draft text remains local until it is corrected.
 */
export class FrequencyControl {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;

  private readonly error: HTMLElement;
  private readonly onCommit: ((omegaAOverC: number) => void) | undefined;
  private acceptedValue: number;
  private destroyed = false;

  constructor(host: HTMLElement, options: FrequencyControlOptions) {
    if (!isValidNormalizedFrequency(options.initialValue)) {
      throw new RangeError("The initial angular frequency is invalid.");
    }

    this.root = host;
    this.acceptedValue = options.initialValue;
    this.onCommit = options.onCommit;
    this.root.classList.add("frequency-control");

    const label = document.createElement("label");
    label.className = "frequency-control__label";
    label.htmlFor = "frequency-input";
    katex.render("\\omega", label, katexOptions);

    this.input = document.createElement("input");
    this.input.id = "frequency-input";
    this.input.className = "frequency-control__input";
    this.input.type = "number";
    this.input.min = String(MIN_NORMALIZED_FREQUENCY);
    this.input.max = String(MAX_NORMALIZED_FREQUENCY);
    this.input.step = "any";
    this.input.inputMode = "decimal";
    this.input.setAttribute("aria-label", "Dimensionless angular frequency omega");
    this.input.setAttribute("aria-describedby", "frequency-error");

    const inputFrame = document.createElement("div");
    inputFrame.className = "frequency-control__input-frame";
    inputFrame.append(this.input);

    this.error = document.createElement("p");
    this.error.id = "frequency-error";
    this.error.className = "frequency-control__error";
    this.error.setAttribute("role", "alert");
    this.error.hidden = true;

    this.root.replaceChildren(label, inputFrame, this.error);
    this.input.value = formatInputValue(this.acceptedValue);
    this.input.addEventListener("change", this.handleChange);
    this.input.addEventListener("keydown", this.handleKeydown);
    this.input.addEventListener("input", this.handleInput);
  }

  setValue(value: number): void {
    this.assertActive();
    if (!isValidNormalizedFrequency(value)) {
      throw new RangeError("Angular frequency is outside the accepted range.");
    }

    const acceptedChanged = value !== this.acceptedValue;
    this.acceptedValue = value;
    if (acceptedChanged) {
      const draftValue = parseDraft(this.input.value);
      if (draftValue !== value) this.input.value = formatInputValue(value);
      this.clearError();
    }
  }

  getAcceptedValue(): number {
    this.assertActive();
    return this.acceptedValue;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.input.removeEventListener("change", this.handleChange);
    this.input.removeEventListener("keydown", this.handleKeydown);
    this.input.removeEventListener("input", this.handleInput);
    this.root.replaceChildren();
    this.root.classList.remove("frequency-control");
  }

  private readonly handleInput = (): void => {
    if (!this.error.hidden) this.clearError();
    this.acceptDraft({ normalize: false, reportInvalid: false });
  };

  private readonly handleChange = (): void => {
    this.acceptDraft({ normalize: true, reportInvalid: true });
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      this.acceptDraft({ normalize: true, reportInvalid: true });
      this.input.select();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.input.value = formatInputValue(this.acceptedValue);
      this.clearError();
      this.input.select();
    }
  };

  private acceptDraft(options: {
    readonly normalize: boolean;
    readonly reportInvalid: boolean;
  }): void {
    const value = parseDraft(this.input.value);
    if (!isValidNormalizedFrequency(value)) {
      if (!options.reportInvalid) return;
      this.input.setAttribute("aria-invalid", "true");
      this.error.hidden = false;
      this.error.textContent =
        `Enter a finite value from ${MIN_NORMALIZED_FREQUENCY} through ` +
        `${MAX_NORMALIZED_FREQUENCY}. Press Escape to restore ${formatInputValue(this.acceptedValue)}.`;
      return;
    }

    const acceptedChanged = value !== this.acceptedValue;
    this.acceptedValue = value;
    if (options.normalize) this.input.value = formatInputValue(value);
    this.clearError();
    if (acceptedChanged) this.onCommit?.(value);
  }

  private clearError(): void {
    this.input.removeAttribute("aria-invalid");
    this.error.hidden = true;
    this.error.textContent = "";
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error("FrequencyControl has been destroyed.");
  }
}

const katexOptions = {
  displayMode: false,
  throwOnError: false,
  strict: false,
  trust: false,
  output: "htmlAndMathml" as const
};

function formatInputValue(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}

function parseDraft(draft: string): number {
  return draft.trim() === "" ? Number.NaN : Number(draft);
}
