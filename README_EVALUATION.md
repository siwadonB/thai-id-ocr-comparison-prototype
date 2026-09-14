# Thai ID OCR Demo - Evaluation Update

เวอร์ชันนี้เพิ่มส่วนประเมินผล OCR โดยไม่เปลี่ยน flow เดิมของการ Demo

## สิ่งที่เพิ่ม

1. **Thai ID checksum validation**
   - ตรวจว่าเลขบัตรมี 13 หลัก
   - ตรวจ check digit หลักที่ 13 ตาม checksum
   - ถ้า Gemini อ่านเลขที่ checksum ไม่ผ่าน ระบบจะบังคับ `needs_human_review = true`

2. **Ground Truth (optional)**
   - กรอกค่าจริงของชื่อไทย ชื่ออังกฤษ เลขบัตร วันเกิด และที่อยู่ได้ก่อนวิเคราะห์
   - ไม่กรอกก็ยังใช้ OCR Demo ได้เหมือนเดิม

3. **Evaluation metrics**
   - Field Exact Match: สัดส่วน field ที่ตรงกับ Ground Truth แบบ exact หลัง normalize
   - CER (Character Error Rate): edit distance / จำนวนตัวอักษรใน Ground Truth
   - สำหรับ OCR แบบ raw text ระบบค้นหาช่วงข้อความที่ใกล้ Ground Truth ที่สุดก่อนคำนวณ CER
   - สำหรับ Gemini ระบบเทียบกับค่า structured field โดยตรง

4. **Confidence handling**
   - เก็บ OCR/Gemini confidence ไว้เป็น metadata สำหรับ diagnostics และ human review
   - ไม่แสดง OCR engine confidence เป็นเปอร์เซ็นต์ในหน้าผลลัพธ์ เพราะแต่ละ engine คำนวณไม่เหมือนกันและไม่ใช่ Accuracy ที่เทียบข้ามระบบได้
   - ใช้ Field Exact Match และ Mean Field CER เป็น metrics หลักสำหรับเปรียบเทียบกับ Ground Truth

5. **Evaluation tab**
   - สรุป Exact Match และ CER ของ Tesseract, Tesseract + Preprocessing, Google Vision และ Gemini
   - แสดงผลราย field
   - วิธีที่ไม่ได้เปิดใช้หรือประมวลผลไม่สำเร็จจะแสดง N/A

## วิธีใช้งาน

1. สร้าง `backend/.env` จาก `backend/.env.example`
2. ใส่ API key ที่ต้องการใช้
3. รันด้วย Docker Compose หรือ npm ตามเดิม
4. อัปโหลดรูปและกด `รูปตรงแล้ว`
5. ถ้าต้องการประเมินผล ให้กรอก Ground Truth ก่อนกด `วิเคราะห์ 4 วิธี`
6. เปิดแท็บ `Evaluation` เพื่อดูผล

## หมายเหตุความปลอดภัย

ไฟล์ patch ไม่รวม `backend/.env` เพื่อป้องกัน API key หลุด หาก ZIP เก่าเคยถูกแชร์ออกไป
ควร rotate key ที่เคยอยู่ในไฟล์นั้น
