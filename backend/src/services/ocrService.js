import { createWorker } from "tesseract.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let workerPromise = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const trainedDataDir = path.resolve(__dirname, "../..");
const ocrLanguage = "tha+eng";

async function getWorker() {
  if (!workerPromise) {
    console.log("[OCR config]", {
      language: ocrLanguage,
      langPath: trainedDataDir,
      thaiTrainedDataExists: fs.existsSync(path.join(trainedDataDir, "tha.traineddata")),
      englishTrainedDataExists: fs.existsSync(path.join(trainedDataDir, "eng.traineddata"))
    });

    workerPromise = createWorker(ocrLanguage, 1, {
      langPath: trainedDataDir,
      logger: (m) => {
        if (m.status === "recognizing text") {
          console.log(`OCR progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });
  }

  return workerPromise;
}

export async function runOcr(imagePath) {
  const worker = await getWorker();
  const result = await worker.recognize(imagePath);

  const rawText = result?.data?.text || "";
  const confidence = result?.data?.confidence ?? null;

  return {
    engine: "tesseract.js",
    language: ocrLanguage,
    text: cleanupText(rawText),
    rawText,
    confidence
  };
}

function cleanupText(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
