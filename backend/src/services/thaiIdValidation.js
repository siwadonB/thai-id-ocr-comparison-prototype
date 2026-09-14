export function normalizeThaiIdNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

export function validateThaiIdNumber(value) {
  const normalized = normalizeThaiIdNumber(value);

  if (!normalized) {
    return {
      valid: null,
      status: "not_detected",
      normalized: "",
      reason: "ไม่พบเลขบัตรประชาชนให้ตรวจ"
    };
  }

  if (!/^\d{13}$/.test(normalized)) {
    return {
      valid: false,
      status: "invalid",
      normalized,
      reason: "เลขบัตรประชาชนต้องมีตัวเลข 13 หลัก"
    };
  }

  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(normalized[i]) * (13 - i);
  }

  const expectedCheckDigit = (11 - (sum % 11)) % 10;
  const actualCheckDigit = Number(normalized[12]);
  const valid = expectedCheckDigit === actualCheckDigit;

  return {
    valid,
    status: valid ? "valid" : "invalid",
    normalized,
    expectedCheckDigit,
    actualCheckDigit,
    reason: valid ? "checksum ถูกต้อง" : "checksum ไม่ถูกต้อง"
  };
}

export function validateGeminiResult(geminiResult) {
  if (!geminiResult?.corrected || geminiResult.corrected.parseError) {
    return geminiResult;
  }

  const corrected = cloneCorrectedResult(geminiResult.corrected);
  const reviewReasons = [];

  validateThaiField(corrected, "thai_full_name", "ชื่อภาษาไทย", reviewReasons);
  validateThaiField(corrected, "date_of_birth", "วันเกิด", reviewReasons);
  validateThaiField(corrected, "address", "ที่อยู่", reviewReasons);
  validateNoMojibake(corrected, "english_full_name", "ชื่อภาษาอังกฤษ", reviewReasons);

  const idValue = corrected.id_number?.corrected;
  const idValidation = validateThaiIdNumber(idValue);

  if (idValidation.valid === false) {
    reviewReasons.push(`เลขบัตรประชาชนไม่ผ่าน validation: ${idValidation.reason}`);
    markFieldForReview(
      corrected,
      "id_number",
      `Validation: ${idValidation.reason}`
    );
  } else if (idValidation.valid === null) {
    reviewReasons.push("ไม่พบเลขบัตรประชาชนสำหรับตรวจ checksum");
    markFieldForReview(
      corrected,
      "id_number",
      "ไม่พบเลขบัตรประชาชนสำหรับตรวจ checksum"
    );
  }

  if (reviewReasons.length > 0) {
    corrected.overall.needs_human_review = true;
    corrected.overall.summary = "พบข้อมูลที่ควรตรวจซ้ำก่อนใช้งาน";
  }

  return {
    ...geminiResult,
    corrected,
    validation: {
      ...(geminiResult.validation || {}),
      thaiIdNumber: idValidation,
      issues: reviewReasons
    }
  };
}

// Backward-compatible export for existing imports/tests.
export const attachThaiIdValidation = validateGeminiResult;

function cloneCorrectedResult(corrected) {
  const cloned = {
    ...corrected,
    overall: {
      ...(corrected.overall || {})
    }
  };

  for (const fieldName of [
    "thai_full_name",
    "english_full_name",
    "id_number",
    "date_of_birth",
    "address"
  ]) {
    if (corrected[fieldName]) {
      cloned[fieldName] = { ...corrected[fieldName] };
    }
  }

  if (Array.isArray(corrected.thai_character_issues)) {
    cloned.thai_character_issues = corrected.thai_character_issues.map((issue) => ({ ...issue }));
  }

  return cloned;
}

function validateThaiField(result, fieldName, label, reviewReasons) {
  const value = result[fieldName]?.corrected;

  if (!value) {
    reviewReasons.push(`${label} ไม่พบข้อมูล`);
    markFieldForReview(result, fieldName, `${label} ไม่พบข้อมูล`);
    return;
  }

  if (hasMojibake(value) || !hasThaiText(value)) {
    reviewReasons.push(`${label} ไม่ใช่ภาษาไทยที่อ่านได้ชัดเจน`);
    markFieldForReview(result, fieldName, `${label} ไม่ผ่าน validation ภาษาไทย`);
  }
}

function validateNoMojibake(result, fieldName, label, reviewReasons) {
  const value = result[fieldName]?.corrected;

  if (value && hasMojibake(value)) {
    reviewReasons.push(`${label} มี mojibake/garbled text`);
    markFieldForReview(result, fieldName, `${label} มีข้อความ encoding เพี้ยน`);
  }
}

function markFieldForReview(result, fieldName, note) {
  const field = result[fieldName] || {};
  const currentConfidence = Number(field.confidence);
  const confidence = Number.isFinite(currentConfidence)
    ? Math.min(currentConfidence, 0.4)
    : 0;

  result[fieldName] = {
    ...field,
    confidence,
    note: field.note ? `${field.note} / ${note}` : note
  };
}

function hasMojibake(value) {
  return /Ã|Â|Ê|Ë|à¸|à¹|Á|¤|�/.test(String(value));
}

function hasThaiText(value) {
  return /[\u0E00-\u0E7F]/.test(String(value));
}
