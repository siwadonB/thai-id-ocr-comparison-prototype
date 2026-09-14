import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { runOcr } from "./services/ocrService.js";
import { correctWithGemini } from "./services/geminiService.js";
import { runGoogleVisionOcr } from "./services/googleVisionService.js";
import { validateGeminiResult } from "./services/thaiIdValidation.js";
import { evaluateAllMethods, parseGroundTruth } from "./services/evaluationService.js";

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = path.join(__dirname, "..", "tmp");

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "thai-id-gemini-ocr-backend"
  });
});

app.post(
  "/api/analyze",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "preprocessedImage", maxCount: 1 }
  ]),
  async (req, res) => {
    let tempFilePath = null;
    let preprocessedTempFilePath = null;

    try {
      const imageFile = req.files?.image?.[0];
      const preprocessedImageFile = req.files?.preprocessedImage?.[0];

      if (!imageFile) {
        return res.status(400).json({
          ok: false,
          message: "ไม่พบไฟล์ image"
        });
      }

      await fs.mkdir(tempDir, { recursive: true });

      const ext = getExtensionFromMime(imageFile.mimetype);
      const filename = `thai-id-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}.${ext}`;

      tempFilePath = path.join(tempDir, filename);
      await fs.writeFile(tempFilePath, imageFile.buffer);

      if (preprocessedImageFile) {
        const preprocessedExt = getExtensionFromMime(preprocessedImageFile.mimetype);
        const preprocessedFilename = `thai-id-preprocessed-${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}.${preprocessedExt}`;

        preprocessedTempFilePath = path.join(tempDir, preprocessedFilename);
        await fs.writeFile(preprocessedTempFilePath, preprocessedImageFile.buffer);
      }

      const ocr = await runOcr(tempFilePath);
      const preprocessedOcr = preprocessedTempFilePath
        ? await runOcr(preprocessedTempFilePath)
        : null;

      const [onlineOcr, rawGemini] = await Promise.all([
        safelyRunOnlineOcr(tempFilePath),
        safelyRunGemini({
          imagePath: tempFilePath,
          mimeType: imageFile.mimetype,
          ocrText: ocr.text
        })
      ]);

      const gemini = validateGeminiResult(rawGemini);
      const groundTruth = parseGroundTruth(req.body?.groundTruth);
      const evaluation = evaluateAllMethods({
        groundTruth,
        ocr,
        preprocessedOcr,
        onlineOcr,
        gemini
      });

      const jsonResponse = {
        ok: true,
        imageInfo: {
          originalName: imageFile.originalname,
          mimeType: imageFile.mimetype,
          size: imageFile.size
        },
        ocr,
        preprocessedOcr,
        onlineOcr,
        gemini,
        evaluation
      };

      res
        .type("application/json; charset=utf-8")
        .json(jsonResponse);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message: "เกิดข้อผิดพลาดตอนวิเคราะห์รูป",
        error: error.message
      });
    } finally {
      if (tempFilePath) {
        try {
          await fs.unlink(tempFilePath);
        } catch {
          // ignore
        }
      }

      if (preprocessedTempFilePath) {
        try {
          await fs.unlink(preprocessedTempFilePath);
        } catch {
          // ignore
        }
      }
    }
  }
);

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      ok: false,
      message: "ไฟล์ภาพใหญ่เกินไป กรุณาลดขนาดภาพหรืออัปโหลดใหม่"
    });
  }

  next(error);
});

function getExtensionFromMime(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "jpg";
}

async function safelyRunOnlineOcr(imagePath) {
  try {
    return await runGoogleVisionOcr(imagePath);
  } catch (error) {
    console.error("Google Vision OCR failed:", error.message);
    return {
      enabled: true,
      ok: false,
      provider: "google-cloud-vision",
      message: `Google Vision OCR ไม่สำเร็จ: ${error.message}`,
      text: "",
      confidence: null
    };
  }
}

async function safelyRunGemini(input) {
  try {
    return await correctWithGemini(input);
  } catch (error) {
    console.error("Gemini correction failed:", error.message);
    return {
      enabled: true,
      ok: false,
      provider: "google-ai-studio",
      message: `Gemini correction ไม่สำเร็จ: ${error.message}`,
      corrected: null
    };
  }
}

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
