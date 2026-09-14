const FIELD_DEFINITIONS = [
  ["thai_full_name", "ชื่อภาษาไทย"],
  ["english_full_name", "ชื่อภาษาอังกฤษ"],
  ["id_number", "เลขบัตรประชาชน"],
  ["date_of_birth", "วันเกิด"],
  ["address", "ที่อยู่"]
];

export function parseGroundTruth(rawValue) {
  if (!rawValue) return null;

  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    const cleaned = {};

    for (const [field] of FIELD_DEFINITIONS) {
      const value = String(parsed?.[field] || "").trim();
      if (value) cleaned[field] = value;
    }

    return Object.keys(cleaned).length > 0 ? cleaned : null;
  } catch {
    return null;
  }
}

export function evaluateAllMethods({ groundTruth, ocr, preprocessedOcr, onlineOcr, gemini }) {
  if (!groundTruth) return null;

  const methods = {
    tesseract: evaluateRawText(ocr?.text || "", groundTruth),
    preprocessed_tesseract: evaluateRawText(preprocessedOcr?.text || "", groundTruth),
    google_vision: onlineOcr?.enabled === false || onlineOcr?.ok === false
      ? unavailableMethod("Google Vision ไม่พร้อมใช้งาน")
      : evaluateRawText(onlineOcr?.text || "", groundTruth),
    gemini: gemini?.enabled === false || gemini?.ok === false ||
      !gemini?.corrected || gemini.corrected.parseError
      ? unavailableMethod("Gemini ไม่พร้อมใช้งาน")
      : evaluateStructured(gemini.corrected, groundTruth)
  };

  return {
    fieldsEvaluated: Object.keys(groundTruth),
    groundTruth,
    methods
  };
}

function evaluateRawText(text, groundTruth) {
  const fields = {};

  for (const [field, label] of FIELD_DEFINITIONS) {
    if (!groundTruth[field]) continue;

    const expected = groundTruth[field];
    const metrics = compareExpectedToRawText(expected, text);
    fields[field] = { label, expected, ...metrics };
  }

  return summarizeMethod(fields);
}

function evaluateStructured(corrected, groundTruth) {
  const fields = {};

  for (const [field, label] of FIELD_DEFINITIONS) {
    if (!groundTruth[field]) continue;

    const expected = groundTruth[field];
    const actual = corrected?.[field]?.corrected || "";
    const expectedNormalized = normalizeForComparison(expected);
    const actualNormalized = normalizeForComparison(actual);
    const distance = levenshtein(expectedNormalized, actualNormalized);

    fields[field] = {
      label,
      expected,
      actual,
      exactMatch: Boolean(expectedNormalized) && expectedNormalized === actualNormalized,
      cer: expectedNormalized ? distance / expectedNormalized.length : null,
      editDistance: distance
    };
  }

  return summarizeMethod(fields);
}

function compareExpectedToRawText(expected, rawText) {
  const expectedNormalized = normalizeForComparison(expected);
  const rawNormalized = normalizeForComparison(rawText);

  if (!expectedNormalized) {
    return { actual: "", exactMatch: false, cer: null, editDistance: null };
  }

  if (!rawNormalized) {
    return {
      actual: "",
      exactMatch: false,
      cer: 1,
      editDistance: expectedNormalized.length
    };
  }

  if (rawNormalized.includes(expectedNormalized)) {
    return {
      actual: expected,
      exactMatch: true,
      cer: 0,
      editDistance: 0
    };
  }

  const best = bestApproximateWindow(expectedNormalized, rawNormalized);

  return {
    actual: best.window,
    exactMatch: false,
    cer: best.distance / expectedNormalized.length,
    editDistance: best.distance
  };
}

function bestApproximateWindow(expected, source) {
  const expectedLength = expected.length;
  const minLength = Math.max(1, expectedLength - Math.min(4, Math.floor(expectedLength * 0.2)));
  const maxLength = Math.min(source.length, expectedLength + Math.min(6, Math.ceil(expectedLength * 0.25)));

  let best = {
    distance: levenshtein(expected, source),
    window: source
  };

  for (let length = minLength; length <= maxLength; length += 1) {
    for (let start = 0; start + length <= source.length; start += 1) {
      const window = source.slice(start, start + length);
      const distance = levenshtein(expected, window);

      if (distance < best.distance) {
        best = { distance, window };
        if (distance === 0) return best;
      }
    }
  }

  return best;
}

function summarizeMethod(fields) {
  const values = Object.values(fields);
  const validCers = values.map((field) => field.cer).filter(Number.isFinite);
  const exactMatches = values.filter((field) => field.exactMatch).length;

  return {
    available: true,
    fields,
    summary: {
      fieldCount: values.length,
      exactMatchCount: exactMatches,
      fieldExactMatchRate: values.length ? exactMatches / values.length : null,
      meanFieldCer: validCers.length
        ? validCers.reduce((sum, value) => sum + value, 0) / validCers.length
        : null
    }
  };
}

function unavailableMethod(message) {
  return {
    available: false,
    message,
    fields: {},
    summary: {
      fieldCount: 0,
      exactMatchCount: 0,
      fieldExactMatchRate: null,
      meanFieldCer: null
    }
  };
}

function normalizeForComparison(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z\u0E00-\u0E7F]/g, "");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];

    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }

    previous = current;
  }

  return previous[b.length];
}
