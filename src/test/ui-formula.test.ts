import { describe, expect, it } from "vitest";

import { createModeSelection, solveMode } from "../math";
import { pressureTex, regimeLabel } from "../ui/formula";

describe("unified complex-exponential KaTeX source", () => {
  const expected =
    "p=\\operatorname{Re}\\!\\left\\{" +
    "J_m\\!\\left(k_{mn}r\\right)" +
    "\\exp\\!\\left[i\\!\\left(m\\theta+k_x\\,x-\\omega t\\right)\\right]" +
    "\\right\\}";

  it("shows the real part of one circumferential and axial phase", () => {
    const solution = solveMode(createModeSelection(2, 1), 50, 8);
    expect(solution.regime).toBe("propagating");
    expect(pressureTex(solution)).toBe(expected);
    expect(pressureTex(solution)).toContain("m\\theta+k_x\\,x-\\omega t");
    expect(pressureTex(solution)).not.toContain("\\cos");
    expect(regimeLabel(solution.regime)).toBe("PROPAGATING");
  });

  it("keeps the same expression at cutoff", () => {
    const mode = createModeSelection(1, 0);
    const seed = solveMode(mode, 50, 8);
    const solution = solveMode(mode, seed.chi, 8);
    expect(solution.regime).toBe("cutoff");
    expect(pressureTex(solution)).toBe(expected);
    expect(regimeLabel(solution.regime)).toBe("AT CUTOFF");
  });

  it("keeps the same expression when k_x is imaginary", () => {
    const solution = solveMode(createModeSelection(10, 10), 1, 8);
    expect(solution.regime).toBe("evanescent");
    expect(pressureTex(solution)).toBe(expected);
    expect(regimeLabel(solution.regime)).toBe("EVANESCENT");
  });

  it("never substitutes mode values or dimensional scale factors", () => {
    const solution = solveMode(createModeSelection(4, 3), 50, 8);
    expect(pressureTex(solution)).not.toContain("P_0");
    expect(pressureTex(solution)).not.toContain("\\dfrac");
    expect(pressureTex(solution)).not.toContain("6.380162");
    expect(pressureTex(solution)).toContain("J_m");
    expect(pressureTex(solution)).toContain("k_{mn}");
    expect(pressureTex(solution)).toContain("\\operatorname{Re}");
    expect(pressureTex(solution)).toContain("\\exp");
    expect(pressureTex(solution)).not.toContain("\\widehat");
    expect(pressureTex(solution)).not.toContain("\\chi");
    expect(pressureTex(solution)).not.toContain("\\beta");
    expect(pressureTex(solution)).not.toContain("z");
  });
});
