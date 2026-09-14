import test from "node:test";
import assert from "node:assert/strict";

import {
  attachThaiIdValidation,
  validateThaiIdNumber
} from "../src/services/thaiIdValidation.js";
import {
  evaluateAllMethods,
  parseGroundTruth
} from "../src/services/evaluationService.js";

function buildValidThaiId(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(first12[i]) * (13 - i);
  }

  return `${first12}${(11 - (sum % 11)) % 10}`;
}

test("Thai ID checksum accepts valid check digit and rejects invalid one", () => {
  const validId = buildValidThaiId("110170020345");
  assert.equal(validateThaiIdNumber(validId).valid, true);

  const invalidLastDigit = (Number(validId[12]) + 1) % 10;
  const invalidId = `${validId.slice(0, 12)}${invalidLastDigit}`;
  assert.equal(validateThaiIdNumber(invalidId).valid, false);
  assert.equal(validateThaiIdNumber("123456789012").valid, false);
});

test("invalid Gemini Thai ID checksum forces human review", () => {
  const validId = buildValidThaiId("110170020345");
  const invalidLastDigit = (Number(validId[12]) + 1) % 10;
  const invalidId = `${validId.slice(0, 12)}${invalidLastDigit}`;
  const result = attachThaiIdValidation({
    enabled: true,
    corrected: {
      id_number: { corrected: invalidId, note: "" },
      overall: { needs_human_review: false }
    }
  });

  assert.equal(result.validation.thaiIdNumber.valid, false);
  assert.equal(result.corrected.overall.needs_human_review, true);
  assert.match(result.corrected.id_number.note, /checksum/);
});


test("missing Gemini Thai ID is N/A instead of invalid", () => {
  const result = attachThaiIdValidation({
    enabled: true,
    corrected: {
      thai_full_name: { corrected: "นายสมชาย ใจดี", confidence: 0.95, note: "" },
      english_full_name: { corrected: "Somchai Jaidee", confidence: 0.95, note: "" },
      id_number: { corrected: null, confidence: 0.2, note: "" },
      date_of_birth: { corrected: "1 มกราคม 2543", confidence: 0.95, note: "" },
      address: { corrected: "99 ถนนสุขุมวิท", confidence: 0.95, note: "" },
      overall: { needs_human_review: false, summary: "ok" }
    }
  });

  assert.equal(result.validation.thaiIdNumber.valid, null);
  assert.equal(result.validation.thaiIdNumber.status, "not_detected");
  assert.equal(result.corrected.overall.needs_human_review, true);
});

test("backend validation flags mojibake/invalid Thai text", () => {
  const validId = buildValidThaiId("110170020345");
  const result = attachThaiIdValidation({
    enabled: true,
    corrected: {
      thai_full_name: { corrected: "Somchai", confidence: 0.9, note: "" },
      english_full_name: { corrected: "Somchai Jaidee", confidence: 0.9, note: "" },
      id_number: { corrected: validId, confidence: 0.9, note: "" },
      date_of_birth: { corrected: "1 มกราคม 2543", confidence: 0.9, note: "" },
      address: { corrected: "à¸—à¸µà¹ˆà¸­à¸¢à¸¹à¹ˆ", confidence: 0.9, note: "" },
      overall: { needs_human_review: false, summary: "ok" }
    }
  });

  assert.equal(result.corrected.overall.needs_human_review, true);
  assert.ok(result.validation.issues.length >= 2);
  assert.ok(result.corrected.thai_full_name.confidence <= 0.4);
  assert.ok(result.corrected.address.confidence <= 0.4);
});

test("Ground Truth is optional and empty input keeps evaluation disabled", () => {
  assert.equal(parseGroundTruth(undefined), null);
  assert.equal(parseGroundTruth("{}"), null);
  assert.equal(parseGroundTruth("not-json"), null);
  assert.equal(evaluateAllMethods({ groundTruth: null }), null);
});

test("Ground Truth keeps supported fields, trims values, and ignores unknown fields", () => {
  assert.deepEqual(
    parseGroundTruth(JSON.stringify({
      id_number: " 1234567890123 ",
      thai_full_name: " นายสมชาย ใจดี ",
      date_of_birth: " 1 มกราคม 2543 ",
      address: " 99 ถนนสุขุมวิท ",
      unknown: "ignored"
    })),
    {
      thai_full_name: "นายสมชาย ใจดี",
      id_number: "1234567890123",
      date_of_birth: "1 มกราคม 2543",
      address: "99 ถนนสุขุมวิท"
    }
  );
});

test("evaluation reports Field Exact Match, CER, and unavailable methods", () => {
  const validId = buildValidThaiId("110170020345");
  const groundTruth = {
    thai_full_name: "นายสมชาย ใจดี",
    id_number: validId,
    date_of_birth: "1 มกราคม 2543",
    address: "99 ถนนสุขุมวิท"
  };

  const result = evaluateAllMethods({
    groundTruth,
    ocr: { text: `ชื่อ นายสมชาย ใจดี เลข ${validId} เกิด 1 มกราคม 2543 ที่อยู่ 99 ถนนสุขุมวิท` },
    preprocessedOcr: { text: `ชื่อ นายสมชาย ใจด เลข ${validId}` },
    onlineOcr: { enabled: false },
    gemini: {
      enabled: true,
      corrected: {
        thai_full_name: { corrected: "นายสมชาย ใจดี" },
        id_number: { corrected: validId },
        date_of_birth: { corrected: "1 มกราคม 2543" },
        address: { corrected: "99 ถนนสุขุมวิท" }
      }
    }
  });

  assert.equal(result.methods.tesseract.summary.fieldExactMatchRate, 1);
  assert.equal(result.methods.tesseract.summary.meanFieldCer, 0);
  assert.equal(result.methods.gemini.summary.fieldExactMatchRate, 1);
  assert.equal(result.methods.preprocessed_tesseract.fields.thai_full_name.exactMatch, false);
  assert.ok(result.methods.preprocessed_tesseract.fields.thai_full_name.cer > 0);
  assert.equal(result.methods.google_vision.available, false);
  assert.equal(result.methods.google_vision.summary.fieldExactMatchRate, null);
});

test("failed Gemini result is N/A instead of throwing", () => {
  const result = evaluateAllMethods({
    groundTruth: { id_number: "1234567890123" },
    ocr: { text: "" },
    preprocessedOcr: { text: "" },
    onlineOcr: { ok: false },
    gemini: { enabled: true, ok: false, corrected: null }
  });

  assert.equal(result.methods.google_vision.available, false);
  assert.equal(result.methods.gemini.available, false);
  assert.equal(result.methods.gemini.summary.meanFieldCer, null);
});
