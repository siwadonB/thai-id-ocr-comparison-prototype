import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../src/App.jsx", import.meta.url);
const source = await readFile(appUrl, "utf8");

function sectionBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);

  return source.slice(start, end);
}

test("Code tab does not present OCR engine confidence as comparable percentages", () => {
  const codeResult = sectionBetween(
    "function CodeResult({ result })",
    "function getCorrectedResult(result)"
  );

  assert.doesNotMatch(codeResult, /OCR confidence:/i);
  assert.doesNotMatch(codeResult, /Preprocessed OCR confidence:/i);
  assert.doesNotMatch(codeResult, /Online OCR confidence:/i);
  assert.doesNotMatch(codeResult, /formatPercent\s*\(/);
});

test("research comparison metrics remain visible", () => {
  assert.match(source, /Field Exact Match/);
  assert.match(source, /Mean Field CER/);
  assert.match(source, /ไม่แสดงค่า[\s\S]*confidence[\s\S]*เป็นเปอร์เซ็นต์/);
});
