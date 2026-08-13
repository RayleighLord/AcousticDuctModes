import katex from "katex";

import type { AxialRegime, ModalSolution } from "../types";

export function renderMath(element: HTMLElement, tex: string): void {
  katex.render(tex, element, {
    displayMode: false,
    throwOnError: false,
    strict: false,
    trust: false,
    output: "htmlAndMathml"
  });
}

export function pressureTex(_solution: Readonly<ModalSolution>): string {
  return (
    "p=\\operatorname{Re}\\!\\left\\{" +
    "J_m\\!\\left(k_{mn}r\\right)" +
    "\\exp\\!\\left[i\\!\\left(m\\theta+k_x\\,x-\\omega t\\right)\\right]" +
    "\\right\\}"
  );
}

export function regimeLabel(regime: AxialRegime): string {
  switch (regime) {
    case "propagating":
      return "PROPAGATING";
    case "cutoff":
      return "AT CUTOFF";
    case "evanescent":
      return "EVANESCENT";
  }
}
