import fs from "fs/promises";

const endpoint = "https://vision.googleapis.com/v1/images:annotate";

export async function runGoogleVisionOcr(imagePath) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;

  if (!apiKey) {
    return {
      enabled: false,
      provider: "google-cloud-vision",
      message: "ยังไม่ได้ตั้งค่า GOOGLE_VISION_API_KEY จึงข้าม Online OCR",
      text: "",
      confidence: null
    };
  }

  const image = await fs.readFile(imagePath, { encoding: "base64" });
  const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: image },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["th", "en"] }
        }
      ]
    })
  });

  const payload = await response.json();
  const annotation = payload.responses?.[0];
  const apiError = annotation?.error || (!response.ok ? payload.error : null);

  if (apiError) {
    throw new Error(apiError.message || `Google Vision ตอบกลับ HTTP ${response.status}`);
  }

  return {
    enabled: true,
    provider: "google-cloud-vision",
    feature: "DOCUMENT_TEXT_DETECTION",
    languageHints: ["th", "en"],
    text: cleanupText(annotation?.fullTextAnnotation?.text || ""),
    confidence: averageWordConfidence(annotation?.fullTextAnnotation)
  };
}

function averageWordConfidence(fullTextAnnotation) {
  const confidences = [];

  for (const page of fullTextAnnotation?.pages || []) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          if (Number.isFinite(word.confidence)) confidences.push(word.confidence);
        }
      }
    }
  }

  if (confidences.length === 0) return null;
  return confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
}

function cleanupText(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
