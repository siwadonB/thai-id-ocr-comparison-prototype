import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../src/App.jsx", import.meta.url);
const source = await readFile(appUrl, "utf8");

function projectExplanationSource() {
  const start = source.indexOf("function ProjectExplanation() {");
  const end = source.indexOf("function SummaryResult({ result })", start);

  assert.notEqual(start, -1, "ProjectExplanation function is missing");
  assert.notEqual(end, -1, "SummaryResult marker is missing");

  return source.slice(start, end);
}

test("Project Explanation describes the four branches as methods, not sequential steps", () => {
  const explanation = projectExplanationSource();

  for (const marker of ["Method 1", "Method 2", "Method 3", "Method 4"]) {
    assert.match(explanation, new RegExp(marker));
  }

  assert.doesNotMatch(explanation, />Step [1-4]</);
  assert.match(explanation, /Promise\.all/);
  assert.match(explanation, /แบบคู่ขนาน/);
});

test("Project Explanation documents crop, backend validation, and checksum limitations", () => {
  const explanation = projectExplanationSource();

  assert.match(explanation, /Rotate \/ Zoom \/ Pan \/ Aligned Crop/);
  assert.match(explanation, /Backend Validation หลัง Gemini/);
  assert.match(explanation, /Thai ID checksum/);
  assert.match(explanation, /ไม่ได้ยืนยันว่าบัตรเป็นของจริง/);
  assert.match(explanation, /ไม่ได้เชื่อมต่อ[\s\S]*ฐานข้อมูลภาครัฐ/);
});

test("Project Explanation keeps Evaluation explicitly optional and separates it from confidence", () => {
  const explanation = projectExplanationSource();

  assert.match(explanation, /Optional Research Evaluation/);
  assert.match(explanation, /Ground Truth เป็นส่วนเสริม/);
  assert.match(explanation, /Mean Field CER/);
  assert.match(explanation, /แยกจาก engine confidence/);
  assert.doesNotMatch(explanation, /เป็น benchmark ของบริการ OCR ออนไลน์/);
});

test("Project Explanation states what Gemini does and does not receive", () => {
  const explanation = projectExplanationSource();

  assert.match(explanation, /ใช้ภาพเป็นหลักและใช้ OCR text เป็น hint เท่านั้น/);
  assert.match(explanation, /Gemini ไม่ได้รับ[\s\S]*Google Vision/);
  assert.match(explanation, /preprocessed/);
});


test("Project Explanation explains Evaluation formulas and Ground Truth quality", () => {
  const explanation = projectExplanationSource();

  assert.match(explanation, /Ground Truth fields มาจากไหน/);
  assert.match(explanation, /ยึดเฉพาะข้อความที่ปรากฏในภาพบัตร/);
  assert.match(explanation, /Exact Match = จำนวน field ที่ตรง \/ จำนวน field/);
  assert.match(explanation, /Levenshtein edit distance/);
  assert.match(explanation, /Exact Match 80% แต่ Mean Field CER 2%/);
  assert.match(explanation, /0%, 0%, 0%, 0%, 10%/);
  assert.match(explanation, /คุณภาพของ Ground Truth มีผลโดยตรงต่อคะแนน Evaluation/);
});
