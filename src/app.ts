import { DuctRenderer } from "./duct";
import { describeMode, solveMode } from "./math";
import type { ControllerState, ModalSolution } from "./types";
import { createInitialControllerState, reduceControllerState } from "./ui/controller";
import { FrequencyControl } from "./ui/frequency-control";
import { pressureTex, regimeLabel, renderMath } from "./ui/formula";
import { ModeSelectors } from "./ui/mode-selectors";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function startApp(): void {
  const appShell = getElement<HTMLElement>("app-shell");
  const stage = getElement<HTMLElement>("duct-stage");
  const pressureMath = getElement<HTMLElement>("pressure-math");
  const regime = getElement<HTMLElement>("regime-label");
  const description = getElement<HTMLElement>("duct-description");
  const loading = getElement<HTMLElement>("duct-loading");
  const fallback = getElement<HTMLElement>("duct-fallback");
  const fallbackMessage = getElement<HTMLElement>("duct-fallback-message");
  const retryButton = getElement<HTMLButtonElement>("retry-renderer");
  const frontButton = getElement<HTMLButtonElement>("front-camera");
  const resetButton = getElement<HTMLButtonElement>("reset-camera");
  const uiToggle = getElement<HTMLButtonElement>("ui-visibility-toggle");
  const uiToggleLabel = uiToggle.querySelector<HTMLElement>("[data-ui-toggle-label]");
  const animationToggle = getElement<HTMLButtonElement>("animation-toggle");
  const animationToggleLabel = animationToggle.querySelector<HTMLElement>(
    "[data-animation-toggle-label]"
  );
  const interactionStatus = getElement<HTMLElement>("interaction-status");
  const reducedMotionMedia = window.matchMedia(REDUCED_MOTION_QUERY);

  let state = createInitialControllerState({ reducedMotion: reducedMotionMedia.matches });
  let solution = solveMode(state.mode, state.omegaAOverC);
  let renderer: DuctRenderer | null = null;
  let destroyed = false;
  let scrollBeforeCleanView = 0;

  const selectors = new ModeSelectors(getElement<HTMLElement>("mode-selectors"), {
    initialValues: state.mode,
    onChange: ({ values }) => dispatch({ type: "set-mode", mode: values }),
    onCommit: ({ values }) => {
      announce(interactionStatus, `Selected mode m ${values.m}, n ${values.n}. ${describeMode(values, state.omegaAOverC)}`);
    }
  });

  const frequencyControl = new FrequencyControl(getElement<HTMLElement>("frequency-control"), {
    initialValue: state.omegaAOverC,
    onCommit: (omegaAOverC) => {
      dispatch({ type: "set-frequency", omegaAOverC });
      announce(
        interactionStatus,
        `Angular frequency ${omegaAOverC}. Mode is ${solution.regime}.`
      );
    }
  });

  function initializeRenderer(): boolean {
    renderer?.destroy();
    renderer = null;
    for (const staleCanvas of stage.querySelectorAll('[data-duct-canvas="true"]')) {
      staleCanvas.remove();
    }
    loading.hidden = false;
    fallback.hidden = true;
    stage.setAttribute("aria-busy", "true");

    try {
      renderer = new DuctRenderer(stage, {
        onContextLost: () => {
          showRendererFailure("The pressure view is paused because its graphics context was lost.");
        },
        onContextRestored: () => {
          fallback.hidden = true;
          loading.hidden = true;
          stage.setAttribute("aria-busy", "false");
          renderer?.setSolution(solution);
          renderer?.setPlaying(state.playing);
          renderer?.setPageVisible(!document.hidden);
          announce(interactionStatus, "The three-dimensional duct view was restored.");
        }
      });
      renderer.setSolution(solution);
      renderer.resetPhase();
      renderer.setPageVisible(!document.hidden);
      renderer.setPlaying(state.playing);
      loading.hidden = true;
      stage.setAttribute("aria-busy", "false");
      return true;
    } catch (error) {
      showRendererFailure(readableError(error, "This browser could not start the pressure view."));
      return false;
    }
  }

  function showRendererFailure(message: string): void {
    loading.hidden = true;
    fallbackMessage.textContent = message;
    fallback.hidden = false;
    stage.setAttribute("aria-busy", "false");
  }

  function dispatch(action: Parameters<typeof reduceControllerState>[1]): void {
    if (destroyed) return;
    const previous = state;
    const next = reduceControllerState(previous, action);
    if (next === previous) return;
    state = next;

    const solutionChanged =
      previous.mode.m !== next.mode.m ||
      previous.mode.n !== next.mode.n ||
      previous.omegaAOverC !== next.omegaAOverC;
    if (solutionChanged) {
      solution = solveMode(next.mode, next.omegaAOverC);
      selectors.setValues(next.mode);
      if (previous.omegaAOverC !== next.omegaAOverC) {
        frequencyControl.setValue(next.omegaAOverC);
      }
      renderer?.setSolution(solution);
      renderer?.resetPhase();
      renderSolution(solution);
    }
    if (previous.playing !== next.playing) renderer?.setPlaying(next.playing);
    if (previous.uiVisible !== next.uiVisible) {
      renderUiVisibility(next.uiVisible, previous.uiVisible);
    }
    renderPlayback(next);
  }

  function renderSolution(next: Readonly<ModalSolution>): void {
    renderMath(pressureMath, pressureTex(next));
    regime.textContent = regimeLabel(next.regime);
    regime.dataset.regime = next.regime;
    stage.dataset.modeM = String(next.mode.m);
    stage.dataset.modeN = String(next.mode.n);
    stage.dataset.omegaAOverC = String(next.omegaAOverC);
    stage.dataset.regime = next.regime;
    stage.dataset.chi = String(next.chi);
    stage.dataset.axialNumber = String(next.axialNumber);
    description.textContent = describeSolution(next);
  }

  function renderPlayback(next: Readonly<ControllerState>): void {
    stage.dataset.playing = String(next.playing);
    animationToggle.setAttribute("aria-pressed", String(next.playing));
    animationToggle.setAttribute(
      "aria-label",
      next.playing ? "Pause pressure animation" : "Play pressure animation"
    );
    animationToggle.title = next.playing
      ? "Pause pressure animation (Space)"
      : "Play pressure animation (Space)";
    if (animationToggleLabel) animationToggleLabel.textContent = next.playing ? "Pause" : "Play";
  }

  function renderUiVisibility(visible: boolean, wasVisible: boolean): void {
    if (!visible) scrollBeforeCleanView = window.scrollY;
    const hidden = !visible;
    appShell.dataset.uiHidden = String(hidden);
    document.documentElement.dataset.uiHidden = String(hidden);
    uiToggle.setAttribute("aria-expanded", String(visible));
    uiToggle.setAttribute("aria-pressed", String(hidden));
    uiToggle.setAttribute("aria-label", hidden ? "Show UI" : "Hide UI");
    uiToggle.title = hidden ? "Show UI (H)" : "Hide UI (H)";
    if (uiToggleLabel) uiToggleLabel.textContent = hidden ? "Show UI" : "Hide UI";

    if (hidden) {
      window.scrollTo(0, 0);
    } else if (!wasVisible) {
      window.requestAnimationFrame(() => window.scrollTo(0, scrollBeforeCleanView));
    }
    window.requestAnimationFrame(() => renderer?.resize());
  }

  const togglePlayback = (): void => {
    dispatch({ type: "toggle-playing" });
    announce(interactionStatus, state.playing ? "Pressure animation playing." : "Pressure animation paused.");
  };
  animationToggle.addEventListener("click", togglePlayback);

  frontButton.addEventListener("click", () => {
    renderer?.frontView();
    stage.focus({ preventScroll: true });
    announce(interactionStatus, "Front sampling-plane view selected.");
  });

  resetButton.addEventListener("click", () => {
    renderer?.resetView();
    stage.focus({ preventScroll: true });
    announce(interactionStatus, "Duct camera reset.");
  });

  const toggleUi = (): void => {
    dispatch({ type: "toggle-ui" });
    announce(
      interactionStatus,
      state.uiVisible ? "Interface shown." : "Interface hidden. Press H to restore it."
    );
  };
  uiToggle.addEventListener("click", toggleUi);

  retryButton.addEventListener("click", () => {
    if (initializeRenderer()) announce(interactionStatus, "Three-dimensional duct view restored.");
  });

  stage.addEventListener("pointerdown", handleStagePointerDown);
  stage.addEventListener("keydown", handleStageKeydown);

  function handleStagePointerDown(): void {
    stage.focus({ preventScroll: true });
  }

  function handleStageKeydown(event: KeyboardEvent): void {
    renderer?.handleKeyboard(event);
  }

  const handleGlobalShortcut = (event: KeyboardEvent): void => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || isEditing(event.target)) {
      return;
    }
    if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      toggleUi();
    } else if (event.code === "Space" && !isInteractive(event.target)) {
      event.preventDefault();
      togglePlayback();
    }
  };
  document.addEventListener("keydown", handleGlobalShortcut);

  const handleReducedMotionChange = (): void => {
    dispatch({
      type: "set-reduced-motion",
      reducedMotion: reducedMotionMedia.matches
    });
    if (reducedMotionMedia.matches) {
      announce(interactionStatus, "Reduced motion enabled. Pressure animation paused.");
    }
  };
  reducedMotionMedia.addEventListener("change", handleReducedMotionChange);

  const handleVisibility = (): void => renderer?.setPageVisible(!document.hidden);
  document.addEventListener("visibilitychange", handleVisibility);

  const cleanup = (): void => {
    if (destroyed) return;
    destroyed = true;
    animationToggle.removeEventListener("click", togglePlayback);
    uiToggle.removeEventListener("click", toggleUi);
    stage.removeEventListener("pointerdown", handleStagePointerDown);
    stage.removeEventListener("keydown", handleStageKeydown);
    document.removeEventListener("keydown", handleGlobalShortcut);
    document.removeEventListener("visibilitychange", handleVisibility);
    reducedMotionMedia.removeEventListener("change", handleReducedMotionChange);
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    selectors.destroy();
    frequencyControl.destroy();
    renderer?.destroy();
    renderer = null;
  };

  const handlePageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      renderer?.setPageVisible(false);
      return;
    }
    cleanup();
  };

  const handlePageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted || destroyed) return;
    renderer?.setPageVisible(!document.hidden);
    renderer?.resize();
  };
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);

  renderSolution(solution);
  renderPlayback(state);
  renderUiVisibility(state.uiVisible, state.uiVisible);
  initializeRenderer();
  announce(interactionStatus, `Mode ready. ${describeMode(state.mode, state.omegaAOverC)}`);
}

function describeSolution(solution: Readonly<ModalSolution>): string {
  const orientation =
    solution.mode.m === 0
      ? "The cross-section is axisymmetric."
      : `It has ${solution.mode.m} ${plural(solution.mode.m, "nodal diameter")} and ` +
        `${solution.azimuthalSectorCount} alternating azimuthal sectors, all rotating with the combined phase.`;
  const radial = `${solution.radialNodeCount} ${plural(solution.radialNodeCount, "interior radial nodal circle")}.`;
  const axial =
    solution.regime === "propagating"
      ? "The axial wavenumber k sub x is real, and the combined azimuthal-axial phase travels toward positive x without reflections."
      : solution.regime === "evanescent"
        ? "The axial wavenumber k sub x is imaginary, so the complex exponential decays from the near sampling plane toward positive x."
        : "The axial wavenumber k sub x is zero at cutoff, so there is no axial phase variation.";
  return (
    `Acoustic pressure mode m ${solution.mode.m}, n ${solution.mode.n}, at dimensionless angular frequency ` +
    `${solution.omegaAOverC}. ${orientation} It has ${radial} ${axial} ` +
    "Berlin blue is negative pressure, the dark neutral is zero, and coral is positive pressure. " +
    "The colored disks are sampling planes slightly inside both openings, not end caps. " +
    "Both visible duct ends are open visualization boundaries and impose no acoustic boundary condition."
  );
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isInteractive(target: EventTarget | null): boolean {
  return (
    isEditing(target) ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement ||
    (target instanceof HTMLElement && target.matches('[role="button"], [role="link"], [role="slider"]'))
  );
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function announce(element: HTMLElement, message: string): void {
  element.textContent = "";
  window.setTimeout(() => {
    element.textContent = message;
  }, 0);
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}.`);
  return element as T;
}
