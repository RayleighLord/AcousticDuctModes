import { describe, expect, it, vi } from "vitest";

import { FrequencyControl } from "../ui/frequency-control";
import { ModeSelectors } from "../ui/mode-selectors";

describe("native mode selectors", () => {
  it("uses the application mode default when no initial values are supplied", () => {
    const host = document.createElement("div");
    const selectors = new ModeSelectors(host);

    expect(selectors.getValues()).toEqual({ m: 4, n: 1 });
    selectors.destroy();
  });

  it("renders m and n from zero through ten with explicit KaTeX values", () => {
    const host = document.createElement("div");
    const selectors = new ModeSelectors(host, { initialValues: { m: 2, n: 1 } });

    const m = host.querySelector<HTMLInputElement>("#m-slider");
    const n = host.querySelector<HTMLInputElement>("#n-slider");
    expect(m?.type).toBe("range");
    expect(m?.min).toBe("0");
    expect(m?.max).toBe("10");
    expect(n?.value).toBe("1");
    expect(host.querySelectorAll(".mode-selector__tick")).toHaveLength(22);
    expect(host.querySelector("#m-value-math annotation")?.textContent).toBe("m=2");
    expect(host.querySelector("#n-value-math annotation")?.textContent).toBe("n=1");

    selectors.destroy();
  });

  it("emits controlled input and commit values", () => {
    const host = document.createElement("div");
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const selectors = new ModeSelectors(host, {
      initialValues: { m: 2, n: 1 },
      onChange,
      onCommit
    });
    const m = host.querySelector<HTMLInputElement>("#m-slider");
    if (!m) throw new Error("Missing m slider");
    m.value = "10";
    m.dispatchEvent(new Event("input", { bubbles: true }));
    m.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith({ axis: "m", value: 10, values: { m: 10, n: 1 } });
    expect(onCommit).toHaveBeenCalledWith({ axis: "m", value: 10, values: { m: 10, n: 1 } });
    expect(m.getAttribute("aria-valuetext")).toBe("10");
    selectors.destroy();
  });
});

describe("dimensionless angular-frequency field", () => {
  it("accepts every valid input immediately without duplicate change or Enter commits", () => {
    const host = document.createElement("div");
    const onCommit = vi.fn();
    const control = new FrequencyControl(host, { initialValue: 50, onCommit });

    expect(control.input.min).toBe("0.1");
    expect(control.input.max).toBe("100");
    expect(control.input.step).toBe("any");
    expect(host.querySelector("label annotation")?.textContent).toBe("\\omega");
    expect(host.querySelector(".frequency-control__suffix")).toBeNull();
    expect(host.querySelector(".frequency-control__help")).toBeNull();
    expect(control.input.getAttribute("aria-describedby")).toBe("frequency-error");
    control.input.value = "12.5";
    control.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onCommit).toHaveBeenLastCalledWith(12.5);
    expect(control.getAcceptedValue()).toBe(12.5);

    control.input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onCommit).toHaveBeenCalledTimes(1);

    control.input.value = "8";
    control.input.dispatchEvent(new Event("input", { bubbles: true }));
    control.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onCommit).toHaveBeenLastCalledWith(8);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(control.getAcceptedValue()).toBe(8);
    control.destroy();
  });

  it("does not rewrite a valid live draft when accepted state synchronizes back", () => {
    const host = document.createElement("div");
    let control: FrequencyControl;
    const onCommit = vi.fn((value: number) => control.setValue(value));
    control = new FrequencyControl(host, { initialValue: 50, onCommit });

    control.input.value = "12.50";
    control.input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onCommit).toHaveBeenCalledOnce();
    expect(control.input.value).toBe("12.50");
    expect(control.getAcceptedValue()).toBe(12.5);
    control.destroy();
  });

  it("keeps accepted state for invalid drafts and Escape restores it", () => {
    const host = document.createElement("div");
    const onCommit = vi.fn();
    const control = new FrequencyControl(host, { initialValue: 50, onCommit });

    control.input.value = "101";
    control.input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(control.getAcceptedValue()).toBe(50);
    expect(control.input.hasAttribute("aria-invalid")).toBe(false);
    expect(host.querySelector<HTMLElement>("#frequency-error")?.hidden).toBe(true);

    control.input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(control.getAcceptedValue()).toBe(50);
    expect(control.input.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector<HTMLElement>("#frequency-error")?.hidden).toBe(false);

    control.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(control.input.value).toBe("50");
    expect(control.input.hasAttribute("aria-invalid")).toBe(false);
    expect(host.querySelector<HTMLElement>("#frequency-error")?.hidden).toBe(true);
    control.destroy();
  });
});
