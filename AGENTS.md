# AGENTS.md

## Project purpose

This is a static, framework-free Vite application for exploring analytic
acoustic pressure modes in a hard-walled circular duct. It must remain usable
without a backend and deploy safely at a GitHub Pages repository subpath.

## Mathematical invariants

- The fluid is linear, lossless, uniform, and stationary. The cylindrical side
  wall is rigid, so `J_m'(k_mn) = 0`. The visible axial ends impose no
  boundary condition and never create reflections or standing waves.
- Both indices are integers from 0 through 10. `k_00 = 0`; for `m = 0` and
  `n > 0`, use the nth positive derivative root; for `m > 0`, use positive
  derivative root `n + 1`. Therefore `n` is the number of interior radial
  nodal circles.
- Use the spinning circumferential member `exp(i m theta)`, not a standing
  `cos(m theta)` factor. Its real field has `m` rotating nodal diameters and
  `2m` alternating sectors for `m > 0`.
- All displayed coordinates and wavenumbers are dimensionless. The UI exposes
  angular frequency as `omega`, accepted on `[0.1, 100]`.
  Use a cutoff tolerance of `1e-6`; never force an evanescent mode to travel.
- Express every regime as
  `p = Re{J_m(k_mn r) exp(i(m theta + k_x x - omega t))}`. Propagating modes
  have real positive `k_x = sqrt(omega^2 - k_mn^2)`; cutoff has `k_x = 0`;
  evanescent modes take `k_x = i sqrt(k_mn^2 - omega^2)`, producing decay
  without changing the displayed solution form.
- The two sampling disks are cross-sections at `x = 0` and the far end of the
  displayed analytic window, not end caps. The shell displays the pressure at
  the interior rigid wall on its exterior-facing surface. Neither geometry
  deforms, and neither disk imposes an end boundary condition.
- Shell and disk share one normalized signed-pressure scale. Keep the two open
  rims subtle and do not add topology or grid lines over the pressure field;
  textual descriptions provide the non-color explanation.
- Browser time is deliberately slowed. `omega = 50` has a four-second visual
  cycle, and other frequency values preserve proportional rates.

## Architecture

- Keep semantic HTML, lifecycle, and integration in `index.html` and
  `src/app.ts`.
- Keep accepted immutable state and validation in `src/ui/`.
- Keep pure Bessel, root, dispersion, and pressure functions in `src/math/`.
- Keep Three.js resources, phase, camera state, and frame scheduling in
  `src/duct/`; the renderer must not own accepted application state.
- Preserve Vite's relative `base: "./"` and the single test/build/deploy
  workflow.

## UX and verification

- The duct is a full-viewport layer centered on desktop. Controls are overlays
  and must not reserve a layout column or move the physical visualization.
- Keep native mode/frequency inputs, explicit values, KaTeX HTML+MathML,
  44-pixel targets, keyboard camera controls, reduced motion, clean view, and
  WebGL fallback/retry behavior.
- Run unit tests, typecheck, production build, browser smoke tests, and desktop
  and mobile visual inspection for interaction or layout changes. Run the
  browser benchmark for rendering-performance changes.
