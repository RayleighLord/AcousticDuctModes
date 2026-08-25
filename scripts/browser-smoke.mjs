import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const host = "127.0.0.1";
const port = Number(process.env.BROWSER_SMOKE_PORT ?? 30_000 + (process.pid % 20_000));
const repositoryPath = "/AcousticDuctModes/";
const baseUrl = `http://${host}:${port}${repositoryPath}`;
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const artifactDir = new URL("../output/playwright/", import.meta.url);
const docsDir = new URL("../docs/", import.meta.url);
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const requestedChromePath = process.env.CHROME_PATH;
const systemChromePath = "/usr/bin/google-chrome";
const executablePath = requestedChromePath
  ?? (existsSync(systemChromePath) ? systemChromePath : undefined);

await mkdir(artifactDir, { recursive: true });
if (process.env.UPDATE_README_SCREENSHOT === "1") {
  await mkdir(docsDir, { recursive: true });
}

const preview = spawn(
  process.execPath,
  [
    viteBin,
    "preview",
    "--base",
    repositoryPath,
    "--host",
    host,
    "--port",
    `${port}`,
    "--strictPort"
  ],
  { cwd: projectRoot, stdio: ["ignore", "inherit", "inherit"] }
);

let browser;
try {
  await waitForServer(baseUrl, preview);
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference"
  });
  const page = await context.newPage();
  const browserErrors = collectBrowserErrors(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await waitForDuct(page, 4, 1, 30);

  await assertInitialComposition(page);
  await assertAllModes(page);
  await assertFrequencyBranchesAndValidation(page);
  await assertPlaybackAndPhaseScaling(page);
  await captureModeEvidence(page);
  await assertCameraAndCleanView(page);
  await assertPageLifecycle(page);
  await assertContextLossAndRetry(page);
  await assertResponsiveLayouts(page);
  await assertDynamicReducedMotion(page);

  assert.deepEqual(browserErrors, [], `Browser errors:\n${browserErrors.join("\n")}`);
  await context.close();
  await assertInitialReducedMotion(browser, baseUrl);

  console.log("Browser smoke checks passed for all 121 cylindrical-duct modes.");
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
  await waitForExit(preview);
}

async function assertInitialComposition(page) {
  const stage = page.locator("#duct-stage");
  const canvas = page.locator("#duct-stage canvas");
  assert.equal(await page.title(), "Cylindrical Duct Acoustic Modes");
  assert.equal(
    (await page.locator(".mode-controls__title").textContent())?.trim(),
    "Cylindrical Duct Acoustic Modes"
  );
  assert.equal(await page.locator(".mode-controls__eyebrow").count(), 0);
  assert.equal(await canvas.count(), 1, "Exactly one retained WebGL canvas should exist");
  assert.equal(await stage.getAttribute("aria-busy"), "false");
  assert.equal(await stage.getAttribute("data-mode-m"), "4");
  assert.equal(await stage.getAttribute("data-mode-n"), "1");
  assert.equal(await stage.getAttribute("data-omega-a-over-c"), "30");
  assert.equal(await stage.getAttribute("data-regime"), "propagating");
  assert.equal(await page.locator("#regime-label").textContent(), "PROPAGATING");
  assert.equal(await stage.getAttribute("data-camera"), "7.4000,3.0000,4.6000");
  assert.equal(await stage.getAttribute("data-guide-overlays"), "false");
  assert.equal(await stage.getAttribute("data-open-rim-count"), "2");
  assert.equal(await stage.getAttribute("data-colored-sampling-plane-count"), "2");
  assert.equal(
    await stage.getAttribute("data-pressure-representation"),
    "real-part-of-complex-mode"
  );
  assert.equal(
    await stage.getAttribute("data-modal-phase"),
    "m-theta-plus-kx-x-minus-omega-t"
  );
  assert.equal(await stage.getAttribute("data-shell-coordinate-source"), "baked-object-position");
  assert.equal(await stage.getAttribute("data-azimuth-convention"), "atan-z-y");
  assert.equal(await stage.getAttribute("data-axial-origin"), "near-sampling-plane");
  assert.equal(await stage.getAttribute("data-visual-length"), "4.8");
  assert.equal(await stage.getAttribute("data-visual-radius"), "0.78");

  for (const selector of ["#m-slider", "#n-slider"]) {
    assert.equal(await page.locator(selector).getAttribute("min"), "0");
    assert.equal(await page.locator(selector).getAttribute("max"), "10");
    assert.equal(await page.locator(selector).getAttribute("step"), "1");
  }
  assert.equal(await page.locator("#m-slider").inputValue(), "4");
  assert.equal(await page.locator("#n-slider").inputValue(), "1");
  assert.equal(await page.locator("#frequency-input").inputValue(), "30");
  assert.equal(await page.locator("#frequency-input").getAttribute("min"), "0.1");
  assert.equal(await page.locator("#frequency-input").getAttribute("max"), "100");
  assert.equal(await page.locator("#frequency-input").getAttribute("step"), "any");

  assert.equal(await page.locator("#pressure-math .katex-mathml math").count(), 1);
  assert.equal(await page.locator("#dispersion-math").count(), 0);
  assert.equal(await page.locator("#sampling-note").count(), 0);
  const pressureSource = await annotationText(page, "#pressure-math");
  assert.match(pressureSource, /^p=\\operatorname\{Re\}/);
  assert.match(pressureSource, /J_m/);
  assert.match(pressureSource, /k_\{mn\}r/);
  assert.match(pressureSource, /\\exp/);
  assert.match(pressureSource, /m\\theta\+k_x\\,x-\\omega t/);
  assert.doesNotMatch(
    pressureSource,
    /P_0|\\cos|\\dfrac|\\widehat|\\chi|\\beta|6\.706133/
  );
  assert.equal(await annotationText(page, ".frequency-control__label"), "\\omega");
  assert.equal(await page.locator(".frequency-control__suffix").count(), 0);
  assert.equal(await page.locator(".frequency-control__help").count(), 0);

  const frequencyBottom = await page.locator("#frequency-control").evaluate(
    (element) => element.getBoundingClientRect().bottom
  );
  const selectorsTop = await page.locator("#mode-selectors").evaluate(
    (element) => element.getBoundingClientRect().top
  );
  assert.ok(frequencyBottom <= selectorsTop + 1, "Frequency must sit above the mode sliders");

  const description = await page.locator("#duct-description").textContent();
  assert.match(description, /4 nodal diameters?/);
  assert.match(description, /1 interior radial nodal circle/);
  assert.match(description, /sampling planes.*not end caps/i);
  assert.match(description, /impose no acoustic boundary condition/i);

  const canvasMetrics = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      cssWidth: rect.width,
      cssHeight: rect.height,
      width: element.width,
      height: element.height
    };
  });
  assert.ok(canvasMetrics.width * canvasMetrics.height <= 2_550_000);
  assert.ok(canvasMetrics.width / canvasMetrics.cssWidth <= 2.05);
  assert.ok(canvasMetrics.height / canvasMetrics.cssHeight <= 2.05);

  await assertMinimumTargets(page, [
    "#m-slider",
    "#n-slider",
    "#frequency-input",
    "#front-camera",
    "#reset-camera",
    "#ui-visibility-toggle",
    "#animation-toggle"
  ]);

  const layout = await readLayout(page);
  assert.ok(Math.abs(layout.stageCenterX - layout.viewportWidth / 2) <= 2);
  assert.ok(Math.abs(layout.panelWidth - layout.viewportWidth) <= 2);
  assert.ok(layout.modeControls.left < layout.stageCenterX, "Controls should float over the left side");
  assert.ok(layout.modeControls.right < layout.stage.right, "Controls must not reserve a sidebar");
}

async function assertAllModes(page) {
  await ensurePaused(page);
  await commitFrequency(page, 50);
  const stage = page.locator("#duct-stage");
  for (let m = 0; m <= 10; m += 1) {
    for (let n = 0; n <= 10; n += 1) {
      await setMode(page, m, n);
      assert.equal(await stage.getAttribute("data-regime"), "propagating");
      const chi = Number(await stage.getAttribute("data-chi"));
      const axialNumber = Number(await stage.getAttribute("data-axial-number"));
      assert.ok(Number.isFinite(chi) && chi >= 0 && chi < 50);
      assert.ok(Number.isFinite(axialNumber) && axialNumber > 0);
      assert.ok(Math.abs(axialNumber ** 2 + chi ** 2 - 50 ** 2) < 1e-7);
      const description = await page.locator("#duct-description").textContent();
      assert.match(description, new RegExp(`${n} interior radial nodal circle`));
      if (m === 0) {
        assert.match(description, /axisymmetric/i);
      } else {
        assert.match(description, new RegExp(`${2 * m} alternating azimuthal sectors`));
      }
      assert.ok(Math.abs(Number(await stage.getAttribute("data-phase"))) < 1e-5);
    }
  }
  await setMode(page, 2, 1);
}

async function assertFrequencyBranchesAndValidation(page) {
  const stage = page.locator("#duct-stage");
  await setMode(page, 2, 1);

  await inputFrequencyImmediately(page, 20);
  assert.equal(await stage.getAttribute("data-regime"), "propagating");
  assert.equal(await page.locator("#regime-label").textContent(), "PROPAGATING");
  const unifiedPressureSource = await annotationText(page, "#pressure-math");
  assert.match(unifiedPressureSource, /m\\theta\+k_x\\,x-\\omega t/);

  const chi = Number(await stage.getAttribute("data-chi"));
  await commitFrequency(page, chi);
  assert.equal(await stage.getAttribute("data-regime"), "cutoff");
  assert.equal(await page.locator("#regime-label").textContent(), "AT CUTOFF");
  assert.equal(Number(await stage.getAttribute("data-axial-number")), 0);
  assert.equal(await annotationText(page, "#pressure-math"), unifiedPressureSource);

  await inputFrequencyImmediately(page, 2);
  assert.equal(await stage.getAttribute("data-regime"), "evanescent");
  assert.equal(await page.locator("#regime-label").textContent(), "EVANESCENT");
  assert.equal(await annotationText(page, "#pressure-math"), unifiedPressureSource);
  assert.match(await page.locator("#duct-description").textContent(), /decays from the near sampling plane/i);

  const accepted = Number(await stage.getAttribute("data-omega-a-over-c"));
  const frequency = page.locator("#frequency-input");
  await frequency.fill("101");
  assert.equal(await frequency.getAttribute("aria-invalid"), null);
  assert.equal(await page.locator("#frequency-error").isHidden(), true);
  assert.equal(Number(await stage.getAttribute("data-omega-a-over-c")), accepted);
  await frequency.press("Enter");
  assert.equal(await frequency.getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator("#frequency-error").isVisible(), true);
  assert.equal(Number(await stage.getAttribute("data-omega-a-over-c")), accepted);
  await frequency.press("Escape");
  assert.equal(await frequency.getAttribute("aria-invalid"), null);
  assert.equal(Number(await frequency.inputValue()), accepted);

  await frequency.fill("");
  assert.equal(await frequency.getAttribute("aria-invalid"), null);
  assert.equal(await page.locator("#frequency-error").isHidden(), true);
  assert.equal(Number(await stage.getAttribute("data-omega-a-over-c")), accepted);
  await frequency.press("Enter");
  assert.equal(await frequency.getAttribute("aria-invalid"), "true");
  assert.equal(Number(await stage.getAttribute("data-omega-a-over-c")), accepted);
  await frequency.press("Escape");

  await commitFrequency(page, 0.1);
  assert.equal(Number(await stage.getAttribute("data-omega-a-over-c")), 0.1);
  await commitFrequency(page, 100);
  assert.equal(Number(await stage.getAttribute("data-omega-a-over-c")), 100);
  await commitFrequency(page, 50);
}

async function assertPlaybackAndPhaseScaling(page) {
  const stage = page.locator("#duct-stage");
  await setMode(page, 0, 0);
  await commitFrequency(page, 25);
  const slowRate = await measurePhaseRate(page, 650);
  await commitFrequency(page, 50);
  const fastRate = await measurePhaseRate(page, 650);
  const ratio = fastRate / slowRate;
  assert.ok(
    ratio > 1.65 && ratio < 2.35,
    `Expected Omega 50 to advance about twice as fast as Omega 25; measured ${ratio.toFixed(3)}`
  );

  assert.equal(await stage.getAttribute("data-playing"), "false");
  const frozen = Number(await stage.getAttribute("data-phase"));
  await page.waitForTimeout(180);
  assert.ok(Math.abs(Number(await stage.getAttribute("data-phase")) - frozen) < 1e-5);
  await page.locator("#duct-stage").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() =>
    document.querySelector("#duct-stage")?.getAttribute("data-playing") === "true"
  );
  await page.waitForFunction((initialPhase) => {
    const phase = Number(document.querySelector("#duct-stage")?.getAttribute("data-phase"));
    return Number.isFinite(phase)
      && (phase - initialPhase + 2 * Math.PI) % (2 * Math.PI) > 0.05;
  }, frozen);
  await page.keyboard.press("Space");
  assert.equal(await stage.getAttribute("data-playing"), "false");
  await setMode(page, 2, 1);
}

async function captureModeEvidence(page) {
  await ensureUiVisible(page);
  await ensurePaused(page);

  const captures = [
    { name: "mode-plane-oblique.png", m: 0, n: 0, omega: 50, view: "reset" },
    { name: "mode-azimuthal-3-0-front.png", m: 3, n: 0, omega: 50, view: "front" },
    { name: "mode-radial-0-3-front.png", m: 0, n: 3, omega: 50, view: "front" },
    { name: "mode-mixed-3-2-front.png", m: 3, n: 2, omega: 50, view: "front" },
    { name: "mode-evanescent-2-1-oblique.png", m: 2, n: 1, omega: 2, view: "reset" }
  ];

  for (const capture of captures) {
    await setMode(page, capture.m, capture.n);
    await commitFrequency(page, capture.omega);
    await page.locator(capture.view === "front" ? "#front-camera" : "#reset-camera").click();
    await waitForCameraPreset(page, capture.view === "front" ? "front" : "oblique");
    await waitForRenderedFrame(page);
    await page.screenshot({ path: new URL(capture.name, artifactDir).pathname });
  }

  await setMode(page, 4, 1);
  await commitFrequency(page, 30);
  await page.locator("#reset-camera").click();
  await waitForCameraPreset(page, "oblique");
  await page.screenshot({
    path: new URL("browser-smoke-desktop.png", artifactDir).pathname,
    fullPage: true
  });
  if (process.env.UPDATE_README_SCREENSHOT === "1") {
    await page.screenshot({
      path: new URL("acoustic-duct-modes-explorer.png", docsDir).pathname,
      fullPage: true
    });
  }
}

async function assertCameraAndCleanView(page) {
  const stage = page.locator("#duct-stage");
  await page.locator("#reset-camera").click();
  await waitForCameraPreset(page, "oblique");
  const initialCamera = await requiredAttribute(stage, "data-camera");
  const initialPlaying = await stage.getAttribute("data-playing");

  await page.locator("#front-camera").click();
  await waitForCameraPreset(page, "front");
  assert.equal(await requiredAttribute(stage, "data-camera"), "5.7000,0.0000,0.0000");
  await page.locator("#reset-camera").click();
  await waitForCameraPreset(page, "oblique");
  assert.equal(await requiredAttribute(stage, "data-camera"), initialCamera);

  await stage.focus();
  await stage.press("ArrowLeft");
  await waitForAttributeChange(stage, "data-camera", initialCamera);
  await stage.press("+");
  const keyboardCamera = await requiredAttribute(stage, "data-camera");
  assert.notEqual(keyboardCamera, initialCamera);

  await stage.press("f");
  await waitForCameraPreset(page, "front");
  assert.equal(await requiredAttribute(stage, "data-camera"), "5.7000,0.0000,0.0000");
  await stage.press("Home");
  await waitForCameraPreset(page, "oblique");
  assert.equal(await requiredAttribute(stage, "data-camera"), initialCamera);
  await stage.press("ArrowRight");
  await waitForAttributeChange(stage, "data-camera", initialCamera);
  await stage.press("0");
  await waitForCameraPreset(page, "oblique");
  assert.equal(await requiredAttribute(stage, "data-camera"), initialCamera);

  const bounds = await stage.boundingBox();
  assert.ok(bounds, "Duct stage has no pointer bounds");
  await page.mouse.move(bounds.x + bounds.width * 0.56, bounds.y + bounds.height * 0.57);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.29, {
    steps: 12
  });
  await page.mouse.up();
  await waitForAttributeChange(stage, "data-camera", initialCamera);
  const draggedCamera = await requiredAttribute(stage, "data-camera");
  await page.mouse.wheel(0, -260);
  await waitForAttributeChange(stage, "data-camera", draggedCamera);

  await page.locator("#reset-camera").click();
  await waitForCameraPreset(page, "oblique");
  assert.equal(await requiredAttribute(stage, "data-camera"), initialCamera);

  await page.locator("#ui-visibility-toggle").click();
  assert.equal(await page.locator("#app-shell").getAttribute("data-ui-hidden"), "true");
  assert.equal(await stage.getAttribute("data-playing"), initialPlaying);
  assert.equal(await page.locator(".ui-chrome:visible").count(), 0);
  assert.equal(await page.locator("#ui-visibility-toggle").isVisible(), true);
  await page.keyboard.press("h");
  assert.equal(await page.locator("#app-shell").getAttribute("data-ui-hidden"), "false");
}

async function assertPageLifecycle(page) {
  const stage = page.locator("#duct-stage");
  await ensurePaused(page);
  const canvas = page.locator("#duct-stage canvas");
  await canvas.evaluate((element) => {
    element.dataset.lifecycleMarker = "original-canvas";
  });

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  });
  await page.waitForFunction(() =>
    document.querySelector("#duct-stage")?.getAttribute("data-page-visible") === "false"
  );
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await page.waitForFunction(() =>
    document.querySelector("#duct-stage")?.getAttribute("data-page-visible") === "true"
  );
  assert.equal(await page.locator("#duct-stage canvas").count(), 1);
  assert.equal(await canvas.getAttribute("data-lifecycle-marker"), "original-canvas");

  // Chromium's frozen lifecycle drives the same hidden-page scheduling path
  // as a background tab. It should stop and resume without replacing state.
  const session = await page.context().newCDPSession(page);
  await session.send("Page.setWebLifecycleState", { state: "frozen" });
  await page.waitForTimeout(60);
  await session.send("Page.setWebLifecycleState", { state: "active" });
  await page.waitForFunction(() => document.visibilityState === "visible");
  await waitForDuct(page, 4, 1, 30);
  assert.equal(await canvas.getAttribute("data-lifecycle-marker"), "original-canvas");
  await session.detach();
}

async function assertContextLossAndRetry(page) {
  const stage = page.locator("#duct-stage");
  const canvas = page.locator("#duct-stage canvas");
  const canLoseContext = await canvas.evaluate((element) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    const extension = context?.getExtension("WEBGL_lose_context");
    window.__ductTestContextLoss = extension;
    extension?.loseContext();
    return Boolean(extension);
  });
  assert.equal(canLoseContext, true, "WEBGL_lose_context is unavailable");
  await page.locator("#duct-fallback").waitFor({ state: "visible" });
  assert.match(await page.locator("#duct-fallback-message").textContent(), /context was lost/i);
  assert.equal(await stage.getAttribute("data-mode-m"), "4");
  assert.equal(await stage.getAttribute("data-mode-n"), "1");

  await page.evaluate(() => window.__ductTestContextLoss?.restoreContext());
  await waitForDuct(page, 4, 1, 30);
  assert.equal(await page.locator("#duct-fallback").isHidden(), true);
  assert.equal(await page.locator("#duct-stage canvas").count(), 1);

  await page.locator("#duct-stage canvas").evaluate((element) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    const extension = context?.getExtension("WEBGL_lose_context");
    window.__ductTestContextLoss = extension;
    extension?.loseContext();
  });
  await page.locator("#duct-fallback").waitFor({ state: "visible" });
  await page.locator("#retry-renderer").click();
  await waitForDuct(page, 4, 1, 30);
  await page.evaluate(() => delete window.__ductTestContextLoss);
  assert.equal(await page.locator("#duct-stage canvas").count(), 1);
  assert.equal(await page.locator("#duct-fallback").isHidden(), true);
  assert.equal(await stage.getAttribute("data-regime"), "propagating");
}

async function assertResponsiveLayouts(page) {
  const viewports = [
    { name: "tablet", width: 1024, height: 768 },
    { name: "intermediate", width: 600, height: 800 },
    { name: "mobile", width: 390, height: 844 },
    { name: "narrow", width: 320, height: 700 },
    { name: "short-landscape", width: 844, height: 390 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(120);
    const layout = await readLayout(page);
    assert.ok(
      layout.documentWidth <= viewport.width,
      `${viewport.name} layout overflows horizontally (${layout.documentWidth}px)`
    );
    assert.ok(layout.formula.left >= -1 && layout.formula.right <= viewport.width + 1);
    assert.ok(layout.viewControls.left >= -1 && layout.viewControls.right <= viewport.width + 1);
    assert.ok(layout.modeControls.left >= -1 && layout.modeControls.right <= viewport.width + 1);

    if (viewport.width <= 600 && viewport.height > 500) {
      const expectedStageHeight = viewport.height * 0.65;
      assert.ok(Math.abs(layout.panelHeight - expectedStageHeight) <= viewport.height * 0.04);
      assert.ok(
        layout.modeControls.top >= layout.panel.bottom - 2,
        `${viewport.name} controls should follow the visualization in document flow`
      );
    }

    await assertMinimumTargets(page, [
      "#m-slider",
      "#n-slider",
      "#frequency-input",
      "#front-camera",
      "#reset-camera",
      "#ui-visibility-toggle",
      "#animation-toggle"
    ]);

    if (viewport.name === "mobile") {
      await page.screenshot({
        path: new URL("browser-smoke-mobile.png", artifactDir).pathname,
        fullPage: true
      });
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(100);
}

async function assertDynamicReducedMotion(page) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (await page.locator("#duct-stage").getAttribute("data-playing") === "false") {
    await page.locator("#animation-toggle").click();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() =>
    document.querySelector("#duct-stage")?.getAttribute("data-playing") === "false"
  );
  assert.equal(await page.locator("#animation-toggle").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#animation-toggle").getAttribute("aria-label"), "Play pressure animation");
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

async function assertInitialReducedMotion(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    reducedMotion: "reduce"
  });
  try {
    const page = await context.newPage();
    const errors = collectBrowserErrors(page);
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForDuct(page, 4, 1, 30);
    assert.equal(await page.locator("#duct-stage").getAttribute("data-playing"), "false");
    assert.equal(await page.locator("#animation-toggle").getAttribute("aria-pressed"), "false");
    await page.waitForTimeout(180);
    const phase = Number(await page.locator("#duct-stage").getAttribute("data-phase"));
    await page.waitForTimeout(180);
    assert.ok(Math.abs(Number(await page.locator("#duct-stage").getAttribute("data-phase")) - phase) < 1e-5);
    assert.deepEqual(errors, [], `Reduced-motion browser errors:\n${errors.join("\n")}`);
  } finally {
    await context.close();
  }
}

async function setMode(page, m, n) {
  await page.evaluate(({ m, n }) => {
    for (const [id, value] of [["m-slider", m], ["n-slider", n]]) {
      const input = document.getElementById(id);
      if (!(input instanceof HTMLInputElement)) throw new Error(`Missing #${id}`);
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, { m, n });
  const omega = Number(await page.locator("#duct-stage").getAttribute("data-omega-a-over-c"));
  await waitForDuct(page, m, n, omega);
  await waitForRenderedFrame(page);
}

async function commitFrequency(page, value) {
  const input = page.locator("#frequency-input");
  await input.fill(String(value));
  await input.press("Enter");
  await page.waitForFunction((expected) => {
    const actual = Number(document.querySelector("#duct-stage")?.getAttribute("data-omega-a-over-c"));
    return Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-10;
  }, value);
  await waitForRenderedFrame(page);
}

async function inputFrequencyImmediately(page, value) {
  const stage = page.locator("#duct-stage");
  const previousFrame = Number(await requiredAttribute(stage, "data-frame"));
  await page.locator("#frequency-input").fill(String(value));
  await page.waitForFunction(([expected, frameBeforeInput]) => {
    const stage = document.querySelector("#duct-stage");
    const acceptedOmega = Number(stage?.getAttribute("data-omega-a-over-c"));
    const renderedFrame = Number(stage?.getAttribute("data-frame"));
    return Number.isFinite(acceptedOmega)
      && Math.abs(acceptedOmega - expected) <= 1e-10
      && renderedFrame > frameBeforeInput;
  }, [value, previousFrame]);
}

async function ensurePaused(page) {
  const stage = page.locator("#duct-stage");
  if (await stage.getAttribute("data-playing") === "true") {
    await page.locator("#animation-toggle").click();
  }
  assert.equal(await stage.getAttribute("data-playing"), "false");
}

async function ensureUiVisible(page) {
  if (await page.locator("#app-shell").getAttribute("data-ui-hidden") === "true") {
    await page.keyboard.press("h");
  }
}

async function measurePhaseRate(page, durationMs) {
  const stage = page.locator("#duct-stage");
  await ensurePaused(page);
  const initial = Number(await requiredAttribute(stage, "data-phase"));
  await page.locator("#animation-toggle").click();
  const startedAt = Date.now();
  await page.waitForTimeout(durationMs);
  const frameAtDuration = Number(await requiredAttribute(stage, "data-frame"));
  await page.waitForFunction((previousFrame) =>
    Number(document.querySelector("#duct-stage")?.getAttribute("data-frame")) > previousFrame,
  frameAtDuration);
  const measuredSeconds = (Date.now() - startedAt) / 1000;
  await page.locator("#animation-toggle").click();
  const final = Number(await requiredAttribute(stage, "data-phase"));
  return phaseDistance(final, initial) / measuredSeconds;
}

function phaseDistance(final, initial) {
  return (final - initial + 2 * Math.PI) % (2 * Math.PI);
}

async function waitForDuct(page, m, n, omega) {
  await page.locator("#duct-stage").waitFor({ state: "visible" });
  await page.waitForFunction(([expectedM, expectedN, expectedOmega]) => {
    const stage = document.querySelector("#duct-stage");
    const actualOmega = Number(stage?.getAttribute("data-omega-a-over-c"));
    return stage?.getAttribute("aria-busy") === "false"
      && stage.getAttribute("data-mode-m") === String(expectedM)
      && stage.getAttribute("data-mode-n") === String(expectedN)
      && Math.abs(actualOmega - expectedOmega) <= 1e-10
      && document.querySelectorAll("#duct-stage canvas").length === 1;
  }, [m, n, omega]);
}

async function waitForRenderedFrame(page) {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  ));
}

async function waitForCameraPreset(page, preset) {
  await page.waitForFunction((expected) =>
    document.querySelector("#duct-stage")?.getAttribute("data-camera-preset") === expected,
  preset);
  await page.waitForTimeout(80);
}

async function waitForAttributeChange(locator, name, previous) {
  await locator.page().waitForFunction(
    ([selector, attribute, before]) =>
      document.querySelector(selector)?.getAttribute(attribute) !== before,
    ["#duct-stage", name, previous]
  );
}

async function requiredAttribute(locator, name) {
  const value = await locator.getAttribute(name);
  assert.notEqual(value, null, `Expected ${name} diagnostic attribute`);
  return value;
}

async function annotationText(page, selector) {
  return (await page.locator(`${selector} annotation`).textContent()) ?? "";
}

async function assertMinimumTargets(page, selectors) {
  const targets = await page.locator(selectors.join(", ")).evaluateAll((elements) =>
    elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    }).map((element) => {
      const rect = element.getBoundingClientRect();
      return { id: element.id, width: rect.width, height: rect.height };
    })
  );
  assert.equal(targets.length, selectors.length, "An expected interactive target is hidden");
  for (const target of targets) {
    assert.ok(target.width >= 44, `${target.id} is narrower than 44px`);
    assert.ok(target.height >= 44, `${target.id} is shorter than 44px`);
  }
}

async function readLayout(page) {
  return page.evaluate(() => {
    const bounds = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      if (!rect) throw new Error(`Missing ${selector}`);
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height
      };
    };
    const stage = bounds("#duct-stage");
    const panel = bounds(".duct-panel");
    return {
      stage,
      stageCenterX: stage.left + stage.width / 2,
      panel,
      panelWidth: panel.width,
      panelHeight: panel.height,
      modeControls: bounds("#mode-controls"),
      formula: bounds("#formula-card"),
      viewControls: bounds(".view-controls"),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight
    };
  });
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText})`);
  });
  return errors;
}

async function waitForServer(url, process) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Preview exited with code ${process.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForExit(process) {
  if (process.exitCode !== null) return;
  await new Promise((resolve) => {
    process.once("exit", resolve);
    setTimeout(resolve, 2_000);
  });
}
