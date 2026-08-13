import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const host = "127.0.0.1";
const port = Number(process.env.BROWSER_BENCHMARK_PORT ?? 32_000 + (process.pid % 20_000));
const repositoryPath = "/AcousticDuctModes/";
const baseUrl = `http://${host}:${port}${repositoryPath}`;
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const requestedChromePath = process.env.CHROME_PATH;
const systemChromePath = "/usr/bin/google-chrome";
const executablePath = requestedChromePath
  ?? (existsSync(systemChromePath) ? systemChromePath : undefined);

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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = collectBrowserErrors(page);

  const navigationStart = performance.now();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForReady(page, 4, 1);
  const firstReadyMs = performance.now() - navigationStart;

  if (await page.locator("#duct-stage").getAttribute("data-playing") === "true") {
    await page.locator("#animation-toggle").click();
  }
  const canvas = page.locator("#duct-stage canvas");
  await canvas.evaluate((element) => {
    element.dataset.benchmarkIdentity = "retained-canvas";
  });
  const resourcesBefore = await resourceSnapshot(page);

  const representativeModes = [
    [0, 0],
    [10, 10],
    [0, 10],
    [10, 0],
    [3, 7],
    [7, 3],
    [4, 1]
  ];
  const modeLatencies = [];
  for (let repeat = 0; repeat < 4; repeat += 1) {
    for (const [m, n] of representativeModes) {
      const start = performance.now();
      await updateModeAndWaitForFrame(page, m, n);
      modeLatencies.push(performance.now() - start);
    }
  }

  assert.equal(await page.locator("#duct-stage canvas").count(), 1);
  assert.equal(await canvas.getAttribute("data-benchmark-identity"), "retained-canvas");
  const resourcesAfterModes = await resourceSnapshot(page);
  assertStableResources(resourcesBefore, resourcesAfterModes, "mode updates");

  await page.locator("#animation-toggle").click();
  const animation = await page.evaluate(async () => {
    const stage = document.querySelector("#duct-stage");
    const intervals = [];
    let previousFrame = Number(stage?.getAttribute("data-frame") ?? Number.NaN);
    let previousTime = performance.now();
    const deadline = previousTime + 5_000;
    if (!Number.isFinite(previousFrame)) {
      throw new Error("Renderer does not expose data-frame diagnostics");
    }
    while (intervals.length < 24 && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const frame = Number(stage?.getAttribute("data-frame"));
      if (frame !== previousFrame) {
        const now = performance.now();
        intervals.push(now - previousTime);
        previousTime = now;
        previousFrame = frame;
      }
    }
    return intervals;
  });
  await page.locator("#animation-toggle").click();

  // Exercise retained geometry repeatedly, including the maximum radial and
  // azimuthal orders, then ensure renderer-owned resource counts do not grow.
  for (let cycle = 0; cycle < 6; cycle += 1) {
    for (const [m, n] of [[10, 10], [0, 0], [6, 9], [4, 1]]) {
      await updateModeAndWaitForFrame(page, m, n);
    }
  }
  const resourcesAfterStress = await resourceSnapshot(page);
  assertStableResources(resourcesBefore, resourcesAfterStress, "stress updates");

  modeLatencies.sort((left, right) => left - right);
  animation.sort((left, right) => left - right);
  const meanFrameMs = mean(animation);
  const frameP95 = percentile(animation, 0.95);
  const latencyP95 = percentile(modeLatencies, 0.95);

  assert.ok(modeLatencies.length === representativeModes.length * 4);
  assert.ok(modeLatencies.every(Number.isFinite));
  assert.ok(animation.length >= 20, "Animation produced too few measured renderer frames");
  assert.ok(animation.every((value) => Number.isFinite(value) && value >= 0));
  assert.deepEqual(errors, [], `Browser errors:\n${errors.join("\n")}`);

  console.log(`First ready: ${firstReadyMs.toFixed(1)} ms`);
  console.log(`Mode-to-rendered-frame p95: ${latencyP95.toFixed(2)} ms (${modeLatencies.length} samples)`);
  console.log(`Animation mean / p95 frame interval: ${meanFrameMs.toFixed(2)} / ${frameP95.toFixed(2)} ms`);
  console.log(
    `Stable resources: ${resourcesAfterStress.geometries} geometries, `
      + `${resourcesAfterStress.textures} textures, ${resourcesAfterStress.programs} shader programs, `
      + `${resourcesAfterStress.drawingBufferPixels} drawing-buffer pixels`
  );
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
  await waitForExit(preview);
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
}

async function waitForReady(page, m, n) {
  await page.waitForFunction(([expectedM, expectedN]) => {
    const stage = document.querySelector("#duct-stage");
    return stage?.getAttribute("aria-busy") === "false"
      && stage.getAttribute("data-mode-m") === String(expectedM)
      && stage.getAttribute("data-mode-n") === String(expectedN)
      && document.querySelectorAll("#duct-stage canvas").length === 1
      && Number.isFinite(Number(stage.getAttribute("data-frame")));
  }, [m, n]);
}

async function updateModeAndWaitForFrame(page, m, n) {
  const previous = Number(await page.locator("#duct-stage").getAttribute("data-frame"));
  assert.ok(Number.isFinite(previous), "Renderer does not expose data-frame diagnostics");
  await setMode(page, m, n);
  await page.waitForFunction(
    ([expectedM, expectedN, before]) => {
      const stage = document.querySelector("#duct-stage");
      return stage?.getAttribute("data-mode-m") === String(expectedM)
        && stage.getAttribute("data-mode-n") === String(expectedN)
        && Number(stage.getAttribute("data-frame")) > before;
    },
    [m, n, previous]
  );
}

async function resourceSnapshot(page) {
  return page.locator("#duct-stage").evaluate((stage) => {
    const numberAttribute = (name) => {
      const value = Number(stage.getAttribute(name));
      if (!Number.isFinite(value)) throw new Error(`Missing renderer diagnostic ${name}`);
      return value;
    };
    return {
      geometries: numberAttribute("data-geometry-count"),
      textures: numberAttribute("data-texture-count"),
      programs: numberAttribute("data-program-count"),
      drawingBufferPixels: numberAttribute("data-drawing-buffer-pixels")
    };
  });
}

function assertStableResources(before, after, label) {
  assert.equal(after.geometries, before.geometries, `Geometry count grew during ${label}`);
  assert.equal(after.textures, before.textures, `Texture count grew during ${label}`);
  assert.equal(after.programs, before.programs, `Shader-program count grew during ${label}`);
  assert.ok(after.drawingBufferPixels <= 2_550_000, "Drawing-buffer pixel cap was exceeded");
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function percentile(values, quantile) {
  if (values.length === 0) return Number.NaN;
  return values[Math.min(values.length - 1, Math.floor(quantile * values.length))];
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
