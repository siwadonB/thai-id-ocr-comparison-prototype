# Thai ID OCR Comparison Prototype

Prototype สำหรับทดลองอ่านข้อมูลจากบัตรประชาชนไทยและเปรียบเทียบผลจาก OCR/AI หลายวิธีใน input เดียวกัน พร้อมการตรวจสอบผลและ optional research evaluation ด้วย Ground Truth, Field Exact Match และ Mean Field CER

> โปรเจกต์นี้จัดทำเพื่อการทดลองและสาธิต ไม่ใช่ระบบยืนยันตัวตนหรือระบบตรวจสอบความถูกต้องของบัตรประชาชนกับฐานข้อมูลภาครัฐ

## ภาพรวม

ระบบให้ผู้ใช้อัปโหลดภาพบัตรประชาชน ปรับตำแหน่งภาพด้วยการหมุน ซูม และลากให้ตรงกับกรอบ จากนั้นสร้าง aligned crop สำหรับนำไปวิเคราะห์ด้วย 4 วิธี

1. **Tesseract OCR** — Local OCR จากภาพ aligned crop
2. **Tesseract + Image Preprocessing** — OCR หลังปรับภาพก่อนอ่าน
3. **Google Cloud Vision OCR** — Online OCR สำหรับใช้เป็นอีกวิธีเปรียบเทียบ
4. **Gemini Correction** — ใช้ภาพร่วมกับ raw Tesseract OCR เพื่อแก้และจัดข้อมูลให้อยู่ในรูป structured fields

Gemini ไม่ได้รับผลจาก Google Vision หรือผล Tesseract + Preprocessing โดยตรง

หลัง Gemini ตอบกลับ backend จะทำ deterministic validation เพิ่ม เช่น ตรวจภาษาไทย/ข้อความผิดรูปแบบ และตรวจเลขบัตรประชาชน 13 หลักด้วย checksum ก่อนส่งผลกลับไปยังหน้าเว็บ

## Flow การทำงาน

```text
Upload image
    ↓
Rotate / Zoom / Pan
    ↓
Aligned Crop
    ├──→ Tesseract OCR
    ├──→ Image Preprocessing → Tesseract OCR
    ├──→ Google Cloud Vision OCR
    └──→ Gemini (image + raw Tesseract OCR)
                         ↓
                 Backend Validation
                         ↓
                  Thai ID Checksum
                         ↓
          Optional Ground Truth Evaluation
                         ↓
                         UI
```

Google Vision และ Gemini จะถูกเรียกแบบคู่ขนานหลังจาก Local OCR เสร็จ ส่วนไฟล์ภาพชั่วคราวที่ backend สร้างขึ้นจะถูกลบหลังจบ request

## ข้อมูลที่ Gemini จัดโครงสร้าง

ระบบเน้นข้อมูลหลัก 5 fields:

- ชื่อภาษาไทย
- ชื่อภาษาอังกฤษ
- เลขบัตรประชาชน
- วันเกิด
- ที่อยู่

ในแต่ละ field สามารถมี OCR context, corrected value และ note สำหรับอธิบายการแก้ไขได้

## Thai ID Checksum

ระบบตรวจเลขบัตรประชาชนที่ Gemini จัดโครงสร้างออกมาว่าเป็นเลข 13 หลักและผ่านสูตร check digit หรือไม่

- **Valid** — ผ่าน checksum
- **Invalid** — มีเลข 13 หลักแต่ checksum ไม่ถูกต้อง
- **N/A** — ไม่พบเลข 13 หลักที่นำมาตรวจได้

`Valid` หมายถึงเลขผ่านสูตร checksum เท่านั้น **ไม่ได้ยืนยันว่าบัตรเป็นของจริง หรือเลขดังกล่าวเป็นของบุคคลนั้นจริง**

## Optional Research Evaluation

ผู้ใช้สามารถกรอก Ground Truth ก่อนวิเคราะห์เพื่อเปรียบเทียบทั้ง 4 วิธีได้ โดยไม่กรอกก็ยังใช้ระบบ Demo ได้ตามปกติ

Ground Truth ควรเป็นข้อมูลที่ **ปรากฏจริงในภาพบัตรเท่านั้น** ไม่ควรเติมข้อมูลจากความรู้ภายนอก เพราะจะทำให้ผล Evaluation ถูกนับว่า mismatch แม้ OCR จะอ่านตรงกับภาพ

### Field Exact Match

สัดส่วนของ fields ที่ตรงกับ Ground Truth หลัง normalize

```text
Field Exact Match = จำนวน field ที่ตรง / จำนวน field ที่ประเมิน × 100
```

ตัวอย่าง: ตรง 4 จาก 5 fields = `80%`

### CER (Character Error Rate)

ใช้ Levenshtein edit distance เพื่อวัดความคลาดเคลื่อนระดับตัวอักษร

```text
CER = Edit Distance / จำนวนตัวอักษรใน Ground Truth
```

สำหรับ OCR ที่คืน raw text ระบบจะหาช่วงข้อความที่ใกล้ Ground Truth ที่สุดก่อนคำนวณ CER ส่วน Gemini จะเทียบ corrected structured field กับ Ground Truth โดยตรง

### Mean Field CER

คำนวณ CER แยกแต่ละ field แล้วนำมาเฉลี่ยแบบ macro average

ตัวอย่าง:

```text
Field CER = 0%, 0%, 0%, 0%, 10%
Mean Field CER = 2%
```

ดังนั้น `Exact Match 80%` และ `Mean Field CER 2%` สามารถเกิดพร้อมกันได้ เพราะ Exact Match วัดแบบทั้ง field ขณะที่ CER วัดความแตกต่างระดับตัวอักษร

> OCR/Gemini confidence ถูกเก็บไว้เพื่อ diagnostics และ human review แต่ไม่ได้ใช้เป็น Accuracy สำหรับเปรียบเทียบข้าม engine เพราะแต่ละระบบคำนวณ confidence ไม่เหมือนกัน

รายละเอียดเพิ่มเติมดูได้ที่ [`README_EVALUATION.md`](README_EVALUATION.md)

## Tech Stack

### Frontend

- React 19
- Vite 7

### Backend

- Node.js / Express
- Tesseract.js
- Google Cloud Vision API
- Google Gemini API (`@google/genai`)

### Other

- Docker / Docker Compose
- Thai and English Tesseract trained data included in `backend/`

## Environment Variables

สร้างไฟล์ `backend/.env` จากตัวอย่าง:

```bash
cp backend/.env.example backend/.env
```

จากนั้นกำหนดค่าที่ต้องใช้:

```env
PORT=8080
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.5-flash
GOOGLE_VISION_API_KEY=your_google_cloud_vision_api_key
```

> ห้าม commit `backend/.env` หรือ API keys จริงขึ้น Git repository

## วิธีรันด้วย Docker Compose

จาก project root:

```bash
docker compose up --build
```

จากนั้นเปิด:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8080`
- Health check: `http://localhost:8080/api/health`

หยุดระบบด้วย:

```bash
docker compose down
```

## วิธีรันด้วย npm

ต้องติดตั้ง Node.js และ npm ในเครื่องก่อน

### Backend

```bash
cd backend
npm install
npm run dev
```

Backend จะทำงานที่ `http://localhost:8080` โดยค่าเริ่มต้น

### Frontend

เปิด terminal อีกหน้าต่าง:

```bash
cd frontend
npm install
npm run dev
```

Frontend ใช้ `http://localhost:8080` เป็น API base URL โดยค่าเริ่มต้น หากต้องการเปลี่ยนสามารถกำหนด `VITE_API_BASE_URL` ได้

## Tests

### Backend

```bash
cd backend
npm test
```

### Frontend

```bash
cd frontend
npm test
```

### Production Build

```bash
cd frontend
npm run build
```

## Project Structure

```text
.
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   └── services/
│   ├── test/
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   ├── test/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── README_EVALUATION.md
└── README.md
```

## Privacy & Security

บัตรประชาชนมีข้อมูลส่วนบุคคลที่มีความอ่อนไหวในบริบทการใช้งานจริง โปรเจกต์นี้จึงควรใช้งานด้วยความระมัดระวัง

- อย่า commit ภาพบัตรประชาชนจริงลง Git
- อย่า commit `.env` หรือ API keys
- ใช้ภาพทดสอบที่ได้รับอนุญาต หรือภาพ synthetic/redacted เมื่อต้องแชร์หรือเปิด repository
- การใช้ Google Cloud Vision และ Gemini หมายถึงข้อมูลที่ส่งวิเคราะห์จะออกจากเครื่องไปยังบริการ cloud ตาม flow ของระบบ
- ตรวจสอบนโยบายข้อมูลและข้อกำหนดของผู้ให้บริการก่อนใช้กับข้อมูลจริง

## Status

**Prototype / Research Demo**

ระบบปัจจุบันรองรับการเปรียบเทียบ OCR 4 วิธี, Gemini correction, backend validation, Thai ID checksum และ optional Ground Truth evaluation สำหรับการทดลอง
