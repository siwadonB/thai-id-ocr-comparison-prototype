import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

let appModule;
let viteServer;

before(async () => {
  viteServer = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true }
  });
  appModule = await viteServer.ssrLoadModule("/src/App.jsx");
});

after(async () => {
  await viteServer?.close();
});

test("fit zoom is calculated from the preview and rotated image bounds", () => {
  const img = { naturalWidth: 1200, naturalHeight: 800 };
  const frame = { clientWidth: 600, clientHeight: 400 };

  assert.equal(appModule.calculateFitZoom(img, frame, 0), 0.627);
  assert.ok(appModule.calculateFitZoom(img, frame, 90) < 0.627);
});

test("pan remains available at fit, 100%, and above 100% zoom", () => {
  const img = { naturalWidth: 1200, naturalHeight: 800 };
  const frame = { clientWidth: 600, clientHeight: 400 };

  for (const zoom of [0.67, 1, 1.5]) {
    assert.deepEqual(
      appModule.constrainPan(img, frame, 0, zoom, 40, -30),
      { x: 40, y: -30 }
    );
  }

  assert.deepEqual(
    appModule.constrainPan(img, frame, 35, 1, 40, -30),
    { x: 40, y: -30 }
  );
});

test("cursor-centered zoom preserves the image point under the pointer", () => {
  const options = {
    currentZoom: 0.67,
    nextZoom: 1.25,
    panX: 35,
    panY: -18,
    anchorX: 170,
    anchorY: 260,
    centerX: 300,
    centerY: 200
  };
  const nextPan = appModule.calculateZoomedPan(options);
  const beforeX = (options.anchorX - options.centerX - options.panX) / options.currentZoom;
  const beforeY = (options.anchorY - options.centerY - options.panY) / options.currentZoom;
  const afterX = (options.anchorX - options.centerX - nextPan.x) / options.nextZoom;
  const afterY = (options.anchorY - options.centerY - nextPan.y) / options.nextZoom;

  assert.ok(Math.abs(beforeX - afterX) < 1e-9);
  assert.ok(Math.abs(beforeY - afterY) < 1e-9);
});

test("fixed guide coordinates do not depend on image rotation, zoom, or pan", () => {
  const first = appModule.getCardGuideRect(600, 400);
  const second = appModule.getCardGuideRect(600, 400);

  assert.deepEqual(first, second);
  assert.equal(first.x + first.width / 2, 300);
  assert.equal(first.y + first.height / 2, 200);
});

test("aligned crop applies preview pan, zoom, and rotation to the output canvas", () => {
  const calls = [];
  const context = {
    fillRect: (...args) => calls.push(["fillRect", ...args]),
    save: () => calls.push(["save"]),
    translate: (...args) => calls.push(["translate", ...args]),
    rotate: (...args) => calls.push(["rotate", ...args]),
    scale: (...args) => calls.push(["scale", ...args]),
    drawImage: (...args) => calls.push(["drawImage", ...args]),
    restore: () => calls.push(["restore"])
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const img = { naturalWidth: 1200, naturalHeight: 800 };
  const guideRect = appModule.getCardGuideRect(600, 400);

  appModule.drawAlignedCrop(canvas, img, {
    previewWidth: 600,
    previewHeight: 400,
    guideRect,
    rotation: 30,
    zoom: 0.67,
    panX: 40,
    panY: -25,
    outputMaxWidth: 2000
  });

  const outputScale = 2000 / guideRect.width;
  const translateCall = calls.find(([name]) => name === "translate");
  const rotateCall = calls.find(([name]) => name === "rotate");
  const scaleCall = calls.find(([name]) => name === "scale");

  assert.equal(canvas.width, 2000);
  assert.equal(canvas.height, Math.round(2000 / (guideRect.width / guideRect.height)));
  assert.ok(Math.abs(translateCall[1] - (300 + 40 - guideRect.x) * outputScale) < 1e-9);
  assert.ok(Math.abs(translateCall[2] - (200 - 25 - guideRect.y) * outputScale) < 1e-9);
  assert.ok(Math.abs(rotateCall[1] - Math.PI / 6) < 1e-9);
  assert.ok(Math.abs(scaleCall[1] - 0.75 * 0.67 * outputScale) < 1e-9);
  assert.equal(calls.some(([name]) => name === "drawImage"), true);
});
