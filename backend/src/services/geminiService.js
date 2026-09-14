import fs from "fs";
import { GoogleGenAI } from "@google/genai";

const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);

const ai = hasGeminiKey
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    })
  : null;

const geminiSchema = {
  type: "object",
  properties: {
    thai_full_name: fieldSchema("ชื่อ-นามสกุลภาษาไทย"),
    english_full_name: fieldSchema("ชื่อ-นามสกุลภาษาอังกฤษ"),
    id_number: fieldSchema("เลขบัตรประชาชน"),
    date_of_birth: fieldSchema("วันเกิด"),
    address: fieldSchema("ที่อยู่"),
    thai_character_issues: {
      type: "array",
      description: "รายการตัวอักษรไทยที่ OCR อาจอ่านผิด",
      items: {
        type: "object",
        properties: {
          ocr_text: {
            type: ["string", "null"],
            description: "ข้อความที่ OCR อ่านได้"
          },
          suggested_text: {
            type: ["string", "null"],
            description: "ข้อความที่ Gemini แนะนำ"
          },
          reason: {
            type: "string",
            description: "เหตุผลสั้น ๆ"
          },
          confidence: {
            type: "number",
            description: "ความมั่นใจ 0.00 ถึง 1.00"
          }
        },
        required: ["ocr_text", "suggested_text", "reason", "confidence"]
      }
    },
    overall: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "สรุปผลแบบสั้น"
        },
        needs_human_review: {
          type: "boolean",
          description: "ควรให้คนตรวจซ้ำหรือไม่"
        }
      },
      required: ["summary", "needs_human_review"]
    }
  },
  required: [
    "thai_full_name",
    "english_full_name",
    "id_number",
    "date_of_birth",
    "address",
    "thai_character_issues",
    "overall"
  ]
};

function fieldSchema(description) {
  return {
    type: "object",
    description,
    properties: {
      ocr: {
        type: ["string", "null"],
        description: "ข้อความ OCR ที่เกี่ยวข้อง"
      },
      corrected: {
        type: ["string", "null"],
        description: "ข้อความที่ Gemini แก้แล้ว หรือ null ถ้าไม่ชัด"
      },
      confidence: {
        type: "number",
        description: "ความมั่นใจ 0.00 ถึง 1.00"
      },
      note: {
        type: "string",
        description: "หมายเหตุสั้น ๆ"
      }
    },
    required: ["ocr", "corrected", "confidence", "note"]
  };
}

export async function correctWithGemini({ imagePath, mimeType, ocrText }) {
  if (!ai) {
    return {
      enabled: false,
      provider: "google-ai-studio",
      message: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY จึงข้าม Gemini correction",
      corrected: null
    };
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  const base64Image = fs.readFileSync(imagePath, {
    encoding: "base64"
  });

  const prompt = `
คุณคือระบบช่วยตรวจแก้ OCR สำหรับบัตรประชาชนไทย
งานนี้เป็น demo ส่วนตัวของเจ้าของบัตร เพื่อทดสอบว่า AI Vision ช่วยแก้ OCR ภาษาไทยได้ดีขึ้นหรือไม่

ข้อมูล OCR ดิบ:
"""
${ocrText}
"""

เป้าหมาย:
- ใช้รูปภาพเป็นหลัก
- ใช้ OCR text เป็น hint เท่านั้น
- OCR text อาจมี mojibake/garbled text จาก encoding หรือ OCR ภาษาไทยผิด เช่น à¸, à¹, Ã, Â, Ê, Ë, Á, ¤, �
- ถ้าเจอ mojibake/garbled text ห้าม copy ข้อความนั้นไปใส่ใน corrected เด็ดขาด
- field ภาษาไทย เช่น thai_full_name, date_of_birth และ address ต้องเป็นภาษาไทยจริง หรือเป็น null เท่านั้น
- ถ้าอ่านภาษาไทยจากภาพไม่ชัด ให้ใส่ corrected เป็น null, ลด confidence และตั้ง overall.needs_human_review เป็น true
- ช่วยแก้คำที่ OCR อ่านผิด โดยเฉพาะตัวอักษรไทยที่สับสนง่าย เช่น ฐ ณ ญ ฒ ธ ถ ภ ษ ศ
- ถ้าข้อความไม่ชัด ให้ใส่ null
- ห้ามเดาข้อมูลที่มองไม่เห็น
- ห้ามแต่งเลขบัตร ชื่อ วันเกิด หรือที่อยู่ขึ้นมาเอง
- เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลักเท่านั้น ถ้าไม่มั่นใจให้ใส่ null
- ถ้าไม่แน่ใจ ให้ลด confidence และใส่ needs_human_review เป็น true

ให้ตอบตาม JSON schema เท่านั้น
`;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: prompt
          },
          {
            inlineData: {
              data: base64Image,
              mimeType: normalizeMimeType(mimeType)
            }
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: geminiSchema
    }
  });

  const outputText = response.text || "";

  return {
    enabled: true,
    provider: "google-ai-studio",
    model,
    raw: outputText,
    corrected: safeParseJson(outputText)
  };
}

function normalizeMimeType(mimeType) {
  if (!mimeType) return "image/png";

  if (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp" ||
    mimeType === "image/heic" ||
    mimeType === "image/heif"
  ) {
    return mimeType;
  }

  return "image/png";
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      return {
        parseError: true,
        text
      };
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return {
        parseError: true,
        text
      };
    }
  }
}
