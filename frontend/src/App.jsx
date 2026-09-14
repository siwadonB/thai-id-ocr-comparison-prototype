import React, { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
const PREVIEW_MAX_WIDTH = 900;
const ANALYSIS_MAX_WIDTH = 2000;
const ANALYSIS_IMAGE_TYPE = "image/jpeg";
const ANALYSIS_IMAGE_QUALITY = 0.88;
const MIN_IMAGE_ZOOM = 0.25;
const MAX_IMAGE_ZOOM = 4;
const ZOOM_BUTTON_STEP = 0.1;

const GROUND_TRUTH_FIELDS = [
  ["thai_full_name", "ชื่อภาษาไทย"],
  ["english_full_name", "ชื่อภาษาอังกฤษ"],
  ["id_number", "เลขบัตรประชาชน"],
  ["date_of_birth", "วันเกิด"],
  ["address", "ที่อยู่"]
];

const EMPTY_GROUND_TRUTH = Object.fromEntries(
  GROUND_TRUTH_FIELDS.map(([field]) => [field, ""])
);

export default function App() {
  const imageRef = useRef(null);
  const imageFrameRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const guideOverlayRef = useRef(null);
  const warpCanvasRef = useRef(null);
  const rotationRef = useRef(0);
  const imageZoomRef = useRef(1);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const guideRectRef = useRef(null);
  const dragStateRef = useRef(null);

  const [imageUrl, setImageUrl] = useState("");
  const [rotation, setRotation] = useState(0);
  const [fitZoom, setFitZoom] = useState(1);
  const [imageZoom, setImageZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [warpedBlob, setWarpedBlob] = useState(null);
  const [isWarping, setIsWarping] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [resultTab, setResultTab] = useState("summary");
  const [activePage, setActivePage] = useState("demo");
  const [message, setMessage] = useState("อัปโหลดรูปบัตรเพื่อเริ่มต้น");
  const [groundTruth, setGroundTruth] = useState({ ...EMPTY_GROUND_TRUTH });

  useEffect(() => {
    const frame = imageFrameRef.current;

    if (!frame || !imageUrl) return undefined;

    const wheelListener = (event) => handleWheelZoom(event);
    frame.addEventListener("wheel", wheelListener, { passive: false });

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          updateFitZoom(rotationRef.current);
          constrainAndApplyPan(
            rotationRef.current,
            imageZoomRef.current,
            panXRef.current,
            panYRef.current
          );
        });
    resizeObserver?.observe(frame);

    return () => {
      frame.removeEventListener("wheel", wheelListener);
      resizeObserver?.disconnect();
    };
  }, [imageUrl]);

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);

    setImageUrl(url);
    rotationRef.current = 0;
    setRotation(0);
    resetViewPosition(0, false);
    setWarpedBlob(null);
    setResult(null);
    setMessage("โหลดรูปแล้ว หมุนภาพให้ขอบบัตรขนานกับกรอบ จากนั้นกดรูปตรงแล้ว");
  }

  function handleImageLoad() {
    resetViewPosition(0);
    setMessage("โหลดรูปแล้ว ลากและซูมภาพให้ตัวบัตรตรงกับกรอบ จากนั้นกดรูปตรงแล้ว");
  }

  function drawPreview(
    nextRotation = rotationRef.current,
    nextZoom = imageZoomRef.current,
    nextPanX = panXRef.current,
    nextPanY = panYRef.current
  ) {
    const img = imageRef.current;
    const frame = imageFrameRef.current;
    const canvas = displayCanvasRef.current;

    if (!img?.complete || !img.naturalWidth || !img.naturalHeight || !frame || !canvas) {
      return;
    }

    drawTransformedPreview(canvas, frame, img, {
      rotation: nextRotation,
      zoom: nextZoom,
      panX: nextPanX,
      panY: nextPanY
    });

    const guideRect = getCardGuideRect(frame.clientWidth, frame.clientHeight);
    guideRectRef.current = guideRect;
    positionGuideOverlay(guideOverlayRef.current, guideRect);
  }

  function handleRotationChange(event) {
    if (!imageUrl) return;

    const nextRotation = Number(event.target.value);
    rotationRef.current = nextRotation;
    updateFitZoom(nextRotation);
    setRotation(nextRotation);
    setWarpedBlob(null);
    setResult(null);
    constrainAndApplyPan(
      nextRotation,
      imageZoomRef.current,
      panXRef.current,
      panYRef.current
    );
    setMessage("ปรับมุมแล้ว ถ้าขอบบัตรขนานกับกรอบให้กดรูปตรงแล้ว");
  }

  function nudgeRotation(delta) {
    const nextRotation = clamp(rotation + delta, -180, 180);

    rotationRef.current = nextRotation;
    updateFitZoom(nextRotation);
    setRotation(nextRotation);
    setWarpedBlob(null);
    setResult(null);
    constrainAndApplyPan(
      nextRotation,
      imageZoomRef.current,
      panXRef.current,
      panYRef.current
    );
    setMessage("ปรับมุมแล้ว ถ้าขอบบัตรขนานกับกรอบให้กดรูปตรงแล้ว");
  }

  function resetRotation() {
    rotationRef.current = 0;
    updateFitZoom(0);
    setRotation(0);
    setWarpedBlob(null);
    setResult(null);
    constrainAndApplyPan(0, imageZoomRef.current, panXRef.current, panYRef.current);
    setMessage("รีเซ็ตมุมแล้ว ถ้ารูปตรงอยู่แล้วให้กดรูปตรงแล้ว");
  }

  function changeZoom(delta) {
    if (!imageUrl) return;

    updateZoom((currentZoom) =>
      clamp(
        Number((currentZoom + delta).toFixed(2)),
        MIN_IMAGE_ZOOM,
        MAX_IMAGE_ZOOM
      )
    );
  }

  function updateZoom(getNextZoom, pointerPosition = null) {
    const frame = imageFrameRef.current;
    const currentZoom = imageZoomRef.current;
    const nextZoom = clamp(
      Number(getNextZoom(currentZoom)),
      MIN_IMAGE_ZOOM,
      MAX_IMAGE_ZOOM
    );

    if (!Number.isFinite(nextZoom) || nextZoom === currentZoom) return;

    imageZoomRef.current = nextZoom;
    setImageZoom(nextZoom);
    setWarpedBlob(null);
    setResult(null);

    if (!frame) {
      drawPreview(rotationRef.current, nextZoom);
      return;
    }

    const frameRect = frame.getBoundingClientRect();
    const clientX = clamp(
      pointerPosition?.clientX ?? frameRect.left + frame.clientWidth / 2,
      frameRect.left,
      frameRect.right
    );
    const clientY = clamp(
      pointerPosition?.clientY ?? frameRect.top + frame.clientHeight / 2,
      frameRect.top,
      frameRect.bottom
    );
    const centerX = frameRect.left + frame.clientWidth / 2;
    const centerY = frameRect.top + frame.clientHeight / 2;
    const nextPan = calculateZoomedPan({
      currentZoom,
      nextZoom,
      panX: panXRef.current,
      panY: panYRef.current,
      anchorX: clientX,
      anchorY: clientY,
      centerX,
      centerY
    });

    constrainAndApplyPan(rotationRef.current, nextZoom, nextPan.x, nextPan.y);
    setMessage(`ซูมภาพเป็น ${Math.round(nextZoom * 100)}%`);
  }

  function handleWheelZoom(event) {
    if (!imageUrl) return;

    event.preventDefault();

    const frame = imageFrameRef.current;
    const deltaPixels =
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * (frame?.clientHeight || 1)
          : event.deltaY;
    const sensitivity = event.ctrlKey ? 0.01 : 0.002;

    updateZoom(
      (currentZoom) =>
        Number((currentZoom * Math.exp(-deltaPixels * sensitivity)).toFixed(3)),
      { clientX: event.clientX, clientY: event.clientY }
    );
  }

  function handlePanStart(event) {
    const frame = imageFrameRef.current;

    if (!frame || event.button !== 0) return;

    event.preventDefault();
    frame.setPointerCapture?.(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: panXRef.current,
      panY: panYRef.current
    };
    setIsDragging(true);
  }

  function handlePanMove(event) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    constrainAndApplyPan(
      rotationRef.current,
      imageZoomRef.current,
      dragState.panX + event.clientX - dragState.startX,
      dragState.panY + event.clientY - dragState.startY
    );
  }

  function finishPan(event) {
    const frame = imageFrameRef.current;
    const dragState = dragStateRef.current;

    if (!dragState || (event?.pointerId !== undefined && dragState.pointerId !== event.pointerId)) {
      return;
    }

    dragStateRef.current = null;
    setIsDragging(false);

    if (frame?.hasPointerCapture?.(dragState.pointerId)) {
      frame.releasePointerCapture(dragState.pointerId);
    }
  }

  function constrainAndApplyPan(nextRotation, nextZoom, nextPanX, nextPanY) {
    const img = imageRef.current;
    const frame = imageFrameRef.current;
    const constrained = img?.complete && img.naturalWidth && frame
      ? constrainPan(img, frame, nextRotation, nextZoom, nextPanX, nextPanY)
      : { x: nextPanX, y: nextPanY };

    panXRef.current = constrained.x;
    panYRef.current = constrained.y;
    setPanX(constrained.x);
    setPanY(constrained.y);
    drawPreview(nextRotation, nextZoom, constrained.x, constrained.y);
  }

  function updateFitZoom(nextRotation) {
    const img = imageRef.current;
    const frame = imageFrameRef.current;
    const nextFitZoom = img?.complete && img.naturalWidth && frame
      ? calculateFitZoom(img, frame, nextRotation)
      : 1;

    setFitZoom(nextFitZoom);

    return nextFitZoom;
  }

  function resetViewPosition(nextRotation = rotationRef.current, fitImage = true) {
    const nextZoom = fitImage ? updateFitZoom(nextRotation) : 1;

    if (!fitImage) {
      setFitZoom(1);
    }

    imageZoomRef.current = nextZoom;
    panXRef.current = 0;
    panYRef.current = 0;
    dragStateRef.current = null;
    setImageZoom(nextZoom);
    setPanX(0);
    setPanY(0);
    setIsDragging(false);
    drawPreview(nextRotation, nextZoom, 0, 0);

    return nextZoom;
  }

  function resetView() {
    if (!imageUrl) return;

    const fitZoom = resetViewPosition();
    setWarpedBlob(null);
    setResult(null);
    setMessage(`รีเซ็ตเป็น Fit ${Math.round(fitZoom * 100)}% และคืนตำแหน่งภาพแล้ว`);
  }

  async function handleConfirmStraightImage() {
    const img = imageRef.current;
    const frame = imageFrameRef.current;
    const warpCanvas = warpCanvasRef.current;

    if (!img?.complete || !img.naturalWidth || !frame || !warpCanvas) {
      setMessage("ต้องอัปโหลดและรอให้รูปโหลดเสร็จก่อน");
      return;
    }

    try {
      setIsWarping(true);
      setMessage("กำลังเตรียมภาพสำหรับวิเคราะห์...");

      const guideRect = guideRectRef.current ||
        getCardGuideRect(frame.clientWidth, frame.clientHeight);

      drawAlignedCrop(warpCanvas, img, {
        previewWidth: frame.clientWidth,
        previewHeight: frame.clientHeight,
        guideRect,
        rotation: rotationRef.current,
        zoom: imageZoomRef.current,
        panX: panXRef.current,
        panY: panYRef.current,
        outputMaxWidth: ANALYSIS_MAX_WIDTH
      });

      const blob = await canvasToBlob(
        warpCanvas,
        ANALYSIS_IMAGE_TYPE,
        ANALYSIS_IMAGE_QUALITY
      );

      setWarpedBlob(blob);
      setResult(null);
      setMessage("ใช้ภาพนี้แล้ว กดวิเคราะห์ 4 วิธีได้เลย");
    } catch (error) {
      console.error(error);
      setMessage(`เตรียมภาพไม่สำเร็จ: ${error.message}`);
    } finally {
      setIsWarping(false);
    }
  }

  async function handleAnalyze() {
    if (!warpedBlob) {
      setMessage("ต้องกดรูปตรงแล้วก่อน");
      return;
    }

    try {
      setIsAnalyzing(true);
      setResult(null);
      setMessage("กำลังเตรียมภาพ preprocessed และส่งไป backend...");

      const formData = new FormData();
      const preprocessedBlob = await createPreprocessedBlob(warpCanvasRef.current);

      formData.append("image", warpedBlob, "thai-id-warped.jpg");
      formData.append("preprocessedImage", preprocessedBlob, "thai-id-preprocessed.jpg");
      formData.append("groundTruth", JSON.stringify(groundTruth));

      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: formData
      });

      const data = await readJsonResponse(response);

      if (!response.ok || !data?.ok) {
        throw new Error(data.message || "วิเคราะห์ไม่สำเร็จ");
      }

      setResult(data);
      setResultTab("summary");
      setMessage("วิเคราะห์เสร็จแล้ว");
    } catch (error) {
      console.error(error);
      setMessage(`วิเคราะห์ไม่สำเร็จ: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Thai ID Card OCR Demo</p>
          <h1>Local OCR + Online OCR + Gemini</h1>
          <p>
            Demo สำหรับอ่านบัตรประชาชนไทยด้วย OCR เทียบภาพปกติกับภาพที่ปรับ preprocessing
            แล้วใช้ Google AI Studio / Gemini ช่วยตรวจแก้ตัวอักษรไทยที่ OCR อ่านเพี้ยน
          </p>
        </div>
      </header>

      <nav className="pageTabs" aria-label="main pages">
        <button
          className={activePage === "demo" ? "pageTab active" : "pageTab"}
          type="button"
          onClick={() => setActivePage("demo")}
        >
          หน้า Demo
        </button>
        <button
          className={activePage === "explanation" ? "pageTab active" : "pageTab"}
          type="button"
          onClick={() => setActivePage("explanation")}
        >
          หน้าอธิบาย
        </button>
      </nav>

      {activePage === "demo" ? (
        <>
          <main className="grid">
            <section className="card">
              <h2>1. อัปโหลดรูปและหมุนให้ตรง</h2>

              <div className="uploadWarning">
                <h3>คำแนะนำก่อนอัปโหลดรูป</h3>
                <ul>
                  <li>ถ่ายให้เห็นบัตรเต็มใบ ไม่ตัดขอบ และไม่เอียงมากเกินไป</li>
                  <li>ใช้แสงสว่างพอดี หลีกเลี่ยงแสงสะท้อนบนหน้าบัตร</li>
                  <li>หลีกเลี่ยงเงาทับตัวหนังสือ โดยเฉพาะบริเวณชื่อ เลขบัตร และที่อยู่</li>
                  <li>รูปควรคมชัด ไม่เบลอ และตัวอักษรบนบัตรควรอ่านได้ด้วยตาเปล่า</li>
                  <li>วางบัตรบนพื้นหลังเรียบ เพื่อให้ระบบแยกขอบบัตรและตัวอักษรได้ง่ายขึ้น</li>
                </ul>
              </div>

              <input
                className="fileInput"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
              />

              <div className="hint">
                หมุนภาพให้ขอบบัตรขนานกับกรอบ จากนั้นกด <b>รูปตรงแล้ว</b>
              </div>

              {imageUrl && (
                <>
                  <img
                    ref={imageRef}
                    src={imageUrl}
                    alt="uploaded"
                    className="hiddenImage"
                    onLoad={handleImageLoad}
                  />

                  <div
                    className={[
                      "imageCanvasFrame",
                      "pannable",
                      isDragging ? "dragging" : ""
                    ].filter(Boolean).join(" ")}
                    ref={imageFrameRef}
                    onPointerDown={handlePanStart}
                    onPointerMove={handlePanMove}
                    onPointerUp={finishPan}
                    onPointerCancel={finishPan}
                    onLostPointerCapture={finishPan}
                    onPointerLeave={(event) => {
                      if (event.buttons === 0) finishPan(event);
                    }}
                    aria-label="ตัวอย่างภาพ หมุนล้อเมาส์เพื่อซูม และลากภาพเพื่อจัดตำแหน่งในกรอบ"
                  >
                    <canvas
                      ref={displayCanvasRef}
                      className="imageCanvas"
                      onDragStart={(event) => event.preventDefault()}
                    />
                    <div ref={guideOverlayRef} className="cardGuideOverlay" aria-hidden="true" />
                  </div>

                  <p className="viewerHint">
                    กรอบฟ้าเป็นพื้นที่ภาพที่จะส่ง OCR · ลากรูปได้ทุกระดับ zoom และใช้ล้อเมาส์หรือ trackpad เพื่อซูม
                  </p>

                  <div className="rotationControls">
                    <label htmlFor="rotation">หมุนภาพ: {rotation}°</label>
                    <input
                      id="rotation"
                      type="range"
                      min="-180"
                      max="180"
                      step="1"
                      value={rotation}
                      onChange={handleRotationChange}
                    />
                  </div>

                  <div className="buttonRow">
                    <button
                      onClick={() => changeZoom(-ZOOM_BUTTON_STEP)}
                      disabled={imageZoom <= MIN_IMAGE_ZOOM}
                    >
                      Zoom out
                    </button>
                    <button
                      onClick={() => changeZoom(ZOOM_BUTTON_STEP)}
                      disabled={imageZoom >= MAX_IMAGE_ZOOM}
                    >
                      Zoom in
                    </button>
                    <button
                      onClick={resetView}
                      disabled={
                        Math.abs(imageZoom - fitZoom) < 0.001 && panX === 0 && panY === 0
                      }
                    >
                      Reset view ({Math.round(imageZoom * 100)}%)
                    </button>
                    <button onClick={() => nudgeRotation(-1)}>-1°</button>
                    <button onClick={() => nudgeRotation(1)}>+1°</button>
                    <button onClick={() => nudgeRotation(-90)}>-90°</button>
                    <button onClick={() => nudgeRotation(90)}>+90°</button>
                    <button onClick={resetRotation}>Reset มุม</button>

                    <button
                      className="primary"
                      onClick={handleConfirmStraightImage}
                      disabled={isWarping}
                    >
                      {isWarping ? "กำลังเตรียมภาพ..." : "รูปตรงแล้ว"}
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className="card">
              <h2>2. ภาพที่จะส่งวิเคราะห์</h2>

              <canvas ref={warpCanvasRef} className="warpCanvas" />

              <GroundTruthForm
                groundTruth={groundTruth}
                setGroundTruth={setGroundTruth}
                disabled={isAnalyzing}
              />

              <div className="buttonRow">
                <button
                  className="primary"
                  onClick={handleAnalyze}
                  disabled={!warpedBlob || isAnalyzing}
                >
                  {isAnalyzing ? "กำลังวิเคราะห์..." : "วิเคราะห์ 4 วิธี"}
                </button>
              </div>

              {message && <div className="message">{message}</div>}
            </section>
          </main>

          <section className="card resultCard">
              <h2>3. ผลลัพธ์เทียบ 4 วิธี</h2>

            {!result && <p className="muted">ยังไม่มีผลลัพธ์</p>}

            {result && (
              <>
                <div className="tabRow" role="tablist" aria-label="result views">
                  <button
                    className={resultTab === "summary" ? "tab active" : "tab"}
                    type="button"
                    onClick={() => setResultTab("summary")}
                  >
                    สรุปผล
                  </button>
                  <button
                    className={resultTab === "compare" ? "tab active" : "tab"}
                    type="button"
                    onClick={() => setResultTab("compare")}
                  >
                    เทียบผล
                  </button>
                  <button
                    className={resultTab === "evaluation" ? "tab active" : "tab"}
                    type="button"
                    onClick={() => setResultTab("evaluation")}
                  >
                    Evaluation
                  </button>
                  <button
                    className={resultTab === "code" ? "tab active" : "tab"}
                    type="button"
                    onClick={() => setResultTab("code")}
                  >
                    Code
                  </button>
                </div>

                {resultTab === "summary" && <SummaryResult result={result} />}
                {resultTab === "compare" && <CompareResult result={result} />}
                {resultTab === "evaluation" && <EvaluationResult result={result} />}
                {resultTab === "code" && <CodeResult result={result} />}
              </>
            )}
          </section>
        </>
      ) : (
        <ProjectExplanation />
      )}
    </div>
  );
}

function GroundTruthForm({ groundTruth, setGroundTruth, disabled }) {
  const hasGroundTruth = Object.values(groundTruth).some((value) => String(value).trim());

  function updateField(field, value) {
    setGroundTruth((current) => ({ ...current, [field]: value }));
  }

  function clearGroundTruth() {
    setGroundTruth({ ...EMPTY_GROUND_TRUTH });
  }

  return (
    <div className="groundTruthPanel">
      <div className="groundTruthHeader">
        <div>
          <h3>Ground Truth สำหรับประเมินผล (ไม่บังคับ)</h3>
          <p>
            ถ้ากรอกค่าจริง ระบบจะคำนวณ Field Exact Match และ CER ให้ทั้ง 4 วิธี
            โดยค่าชุดนี้ใช้เพื่อประเมินผลเท่านั้น
          </p>
        </div>
        <button type="button" onClick={clearGroundTruth} disabled={!hasGroundTruth || disabled}>
          ล้างค่า
        </button>
      </div>

      <div className="groundTruthGrid">
        {GROUND_TRUTH_FIELDS.map(([field, label]) => (
          <label
            key={field}
            className={field === "address" ? "groundTruthField wide" : "groundTruthField"}
          >
            <span>{label}</span>
            <input
              type="text"
              value={groundTruth[field]}
              onChange={(event) => updateField(field, event.target.value)}
              placeholder={`ค่าจริง: ${label}`}
              disabled={disabled}
            />
          </label>
        ))}
      </div>

      {!hasGroundTruth && (
        <p className="groundTruthHint">
          เว้นว่างได้ หากต้องการทดสอบ OCR อย่างเดียวโดยยังไม่วัด Exact Match/CER
        </p>
      )}
    </div>
  );
}

function ProjectExplanation() {
  return (
    <section className="card explanationCard">
      <div className="explanationHeader">
        <div>
          <p className="eyebrow">Project Explanation</p>
          <h2>คำอธิบายโปรเจกต์แบบละเอียด</h2>
        </div>
        <span>อธิบายตาม flow ที่ระบบทำงานจริง</span>
      </div>

      <div className="explanationGrid">
        <article className="explanationBlock wide">
          <h3>ภาพรวมและวัตถุประสงค์</h3>
          <p>
            โปรเจกต์นี้เป็น prototype สำหรับทดลองอ่านข้อมูลจากบัตรประชาชนไทยและเปรียบเทียบ
            ผลลัพธ์จาก 4 วิธี ได้แก่ Tesseract Local OCR, Tesseract หลัง Image preprocessing,
            Google Cloud Vision OCR และ Gemini Correction โดยใช้บัตรและพื้นที่ crop เดียวกันเป็นต้นทาง
            เพื่อให้เห็นข้อดี ข้อจำกัด และความแตกต่างของแต่ละวิธีได้ชัดเจน
          </p>
          <p>
            Gemini ไม่ได้ถูกใช้เพื่อยืนยันตัวบุคคลหรือแทนการตรวจสอบของมนุษย์ แต่ใช้ช่วยตรวจแก้ข้อความ
            OCR ที่อาจอ่านผิดและจัดข้อมูลสำคัญให้อยู่ในรูปแบบที่มีโครงสร้าง เช่น ชื่อ เลขบัตร วันเกิด
            และที่อยู่ ผลลัพธ์ที่มีความสำคัญยังควรให้มนุษย์ตรวจซ้ำก่อนนำไปใช้งานจริง
          </p>
        </article>

        <article className="explanationBlock">
          <h3>ปัญหาที่ระบบพยายามแก้</h3>
          <p>
            ภาพบัตรจากกล้องจริงอาจเอียง มีแสงสะท้อน ตัวอักษรเล็ก contrast ต่ำ หรือมีพื้นหลังรบกวน
            ทำให้ OCR อ่านข้อความไทยผิด ตัวอักษรหาย หรือสลับตำแหน่งได้ โดยเฉพาะอักษรไทยที่มีรูปร่าง
            ใกล้เคียงกัน ระบบจึงทดลองทั้งการปรับภาพ เปลี่ยน OCR provider และใช้ AI Vision ช่วยตีความบริบท
          </p>
        </article>

        <article className="explanationBlock">
          <h3>ขอบเขตของ Prototype</h3>
          <p>
            ระบบนี้ออกแบบเพื่อการทดลองและสาธิต ไม่ใช่ระบบพิสูจน์ตัวตน (identity verification),
            ไม่ตรวจฐานข้อมูลภาครัฐ และไม่สามารถยืนยันว่าบัตรหรือเลขที่อ่านได้เป็นของจริงได้
            การขึ้นสถานะ Valid ของ checksum หมายถึงเลข 13 หลักผ่านสูตรตรวจ check digit เท่านั้น
          </p>
        </article>

        <article className="explanationBlock wide methodBlock">
          <div className="methodHeader">
            <span>Input preparation</span>
            <h3>เตรียมภาพ: Rotate / Zoom / Pan / Aligned Crop</h3>
          </div>
          <p>
            หลังอัปโหลดรูป ผู้ใช้สามารถหมุน ซูม และลากภาพให้บัตรตรงกับกรอบไกด์ได้ เมื่อกด
            “รูปตรงแล้ว” frontend จะใช้ Canvas สร้าง aligned crop เฉพาะพื้นที่ภายในกรอบนั้น
            ภาพ crop นี้เป็นต้นทางของการวิเคราะห์ทั้งหมด ไม่ได้ส่งภาพเต็มที่อยู่นอกกรอบไปวิเคราะห์
          </p>
          <div className="methodGrid">
            <div>
              <h4>สิ่งที่ผู้ใช้ควบคุมได้</h4>
              <ul>
                <li>หมุนภาพทีละ 1° หรือ 90°</li>
                <li>ซูมเข้า/ออกและลากตำแหน่งภาพ</li>
                <li>จัดบัตรให้อยู่ภายในกรอบไกด์ก่อนยืนยันภาพ</li>
              </ul>
            </div>
            <div>
              <h4>สิ่งที่ระบบทำต่อ</h4>
              <ul>
                <li>สร้าง aligned crop จากตำแหน่งที่ผู้ใช้จัดไว้</li>
                <li>สร้าง JPEG ปกติสำหรับ Tesseract, Google Vision และ Gemini</li>
                <li>สร้างภาพ preprocessed เพิ่มอีกหนึ่งชุดจาก crop เดียวกัน</li>
              </ul>
            </div>
          </div>
        </article>

        <article className="explanationBlock wide methodBlock">
          <div className="methodHeader">
            <span>Method 1</span>
            <h3>Tesseract Local OCR</h3>
          </div>
          <p>
            Backend ใช้ Tesseract.js อ่าน aligned crop ด้วยภาษาไทยและอังกฤษ ผลลัพธ์เป็นข้อความดิบ
            ที่อ่านได้จากภาพโดยตรง และทำหน้าที่เป็น Local OCR baseline ของงานนี้ ค่า confidence ที่
            Tesseract ส่งกลับมายังเก็บไว้เป็น diagnostic metadata แต่ไม่ถือเป็น Accuracy และไม่ใช้
            เปรียบเทียบข้ามระบบ
          </p>
          <div className="methodGrid">
            <div>
              <h4>ข้อดี</h4>
              <ul>
                <li>ควบคุมการประมวลผลได้เองและตรวจข้อความดิบย้อนกลับได้</li>
                <li>ไม่ต้องส่งภาพไปยัง OCR provider ภายนอก</li>
                <li>เหมาะสำหรับเป็น baseline ของการทดลอง</li>
              </ul>
            </div>
            <div>
              <h4>ข้อจำกัด</h4>
              <ul>
                <li>ไวต่อภาพเบลอ แสงสะท้อน ตัวอักษรเล็ก และภาพที่จัดแนวไม่ดี</li>
                <li>OCR ดิบไม่ได้เข้าใจว่าข้อความส่วนใดคือชื่อ วันเกิด หรือที่อยู่</li>
              </ul>
            </div>
          </div>
        </article>

        <article className="explanationBlock wide methodBlock">
          <div className="methodHeader">
            <span>Method 2</span>
            <h3>Tesseract + Image preprocessing</h3>
          </div>
          <p>
            Frontend สร้างภาพอีกเวอร์ชันจาก aligned crop เดียวกันโดยปรับ grayscale, contrast
            และ threshold บางส่วน แล้วส่งภาพนี้ให้ Tesseract อ่านแยกจากภาพปกติ จุดประสงค์คือทดลองว่า
            การเน้นตัวอักษรก่อน OCR ช่วยหรือทำให้ผลลัพธ์แย่ลงในสภาพภาพแต่ละแบบ
          </p>
          <div className="methodGrid">
            <div>
              <h4>ข้อดี</h4>
              <ul>
                <li>อาจช่วยเมื่อพื้นหลังหรือแสงทำให้ตัวอักษรแยกจากพื้นไม่ชัด</li>
                <li>เปรียบเทียบผลก่อนและหลังปรับภาพได้โดยใช้ crop ต้นทางเดียวกัน</li>
              </ul>
            </div>
            <div>
              <h4>ข้อจำกัด</h4>
              <ul>
                <li>ไม่ได้ดีขึ้นทุกภาพ และ contrast ที่แรงเกินไปอาจทำให้เส้นอักษรไทยหาย</li>
                <li>จึงต้องวัดผลจากข้อมูลจริง ไม่ควรสรุปว่า preprocessing ดีกว่าเสมอ</li>
              </ul>
            </div>
          </div>
        </article>

        <article className="explanationBlock wide methodBlock">
          <div className="methodHeader">
            <span>Method 3</span>
            <h3>Google Cloud Vision OCR</h3>
          </div>
          <p>
            Backend ส่ง aligned crop ปกติไปยัง Google Cloud Vision แบบ synchronous โดยใช้
            <code> DOCUMENT_TEXT_DETECTION</code> และระบุภาษาไทย/อังกฤษเป็น hint ผลข้อความจาก Google
            จะแสดงโดยตรงโดยไม่ให้ Gemini แก้ เพื่อใช้เป็น Online OCR comparison method เทียบกับ
            Tesseract ที่รันในระบบของเรา
          </p>
          <div className="methodGrid">
            <div>
              <h4>ข้อดี</h4>
              <ul>
                <li>ใช้บริการ OCR สำเร็จรูปบน Cloud และรองรับโครงสร้างเอกสาร</li>
                <li>ไม่ต้องดูแล trained data ของ OCR provider เอง</li>
              </ul>
            </div>
            <div>
              <h4>ข้อจำกัด</h4>
              <ul>
                <li>ต้องใช้อินเทอร์เน็ตและ API key</li>
                <li>ภาพถูกส่งไปยังบริการภายนอกและอาจมีค่าใช้จ่ายตามการใช้งาน</li>
                <li>confidence ของ Google ไม่ควรนำไปเทียบตรง ๆ กับ Tesseract</li>
              </ul>
            </div>
          </div>
        </article>

        <article className="explanationBlock wide methodBlock">
          <div className="methodHeader">
            <span>Method 4</span>
            <h3>Gemini Correction + Structured Output</h3>
          </div>
          <p>
            หลัง Tesseract จากภาพปกติเสร็จ Backend ส่ง aligned crop พร้อม raw Tesseract OCR text ไปให้
            Gemini โดยกำหนดใน prompt ให้ใช้ภาพเป็นหลักและใช้ OCR text เป็น hint เท่านั้น Gemini ไม่ได้รับ
            ผลจาก Google Vision หรือผล Tesseract ที่มาจากภาพ preprocessed จึงไม่ได้นำผลของสองวิธีนั้นมา
            ช่วยสร้างคำตอบ
          </p>
          <p>
            Gemini ส่งผลกลับตาม JSON schema ที่กำหนด เช่น <code>thai_full_name</code>,
            <code>english_full_name</code>, <code>id_number</code>, <code>date_of_birth</code> และ
            <code>address</code> พร้อม note, AI-reported confidence และ flag สำหรับ human review
            โดย confidence ของ Gemini เป็น self-assessment ของโมเดล ไม่ใช่ Accuracy
          </p>
        </article>

        <article className="explanationBlock wide">
          <h3>Backend Validation หลัง Gemini</h3>
          <p>
            ผลจาก Gemini ไม่ถูกเชื่อทันทีทั้งหมด หลังได้รับ JSON แล้ว backend จะตรวจ deterministic rules
            เพิ่มเติม เช่น ช่องภาษาไทยต้องเป็นภาษาไทยที่อ่านได้ ไม่ควรมี mojibake และเลขบัตรต้องเป็นตัวเลข
            13 หลัก หากพบความผิดปกติ backend สามารถบังคับ <code>needs_human_review</code> ให้เป็น
            <code> true</code> ได้ แม้ Gemini จะไม่ได้ตั้ง flag นี้ไว้ตั้งแต่แรก
          </p>
          <p>
            ดังนั้นสถานะ human review ที่เห็นบนหน้าเว็บเกิดได้ทั้งจากการประเมินของ Gemini และจาก validation
            ของ backend ไม่ใช่ค่า confidence ของโมเดลเพียงอย่างเดียว
          </p>
        </article>

        <article className="explanationBlock">
          <h3>Thai ID checksum</h3>
          <p>
            หาก Gemini อ่านเลขบัตรประชาชนได้ 13 หลัก backend จะตรวจ check digit ตามสูตร checksum
            ของเลขประจำตัวประชาชนไทย สถานะ <b>Valid</b> หมายถึงตัวเลขผ่านสูตรทางคณิตศาสตร์,
            <b> Invalid</b> หมายถึงไม่ผ่าน และ <b>N/A</b> หมายถึงไม่มีเลขที่พร้อมให้ตรวจ
          </p>
          <p>
            การผ่าน checksum ไม่ได้ยืนยันว่าบัตรเป็นของจริง ไม่ได้ตรวจเจ้าของบัตร และไม่ได้เชื่อมต่อ
            ฐานข้อมูลภาครัฐ
          </p>
        </article>

        <article className="explanationBlock">
          <h3>Confidence ใช้อย่างไร</h3>
          <p>
            Tesseract, Google Vision และ Gemini มี confidence ที่เกิดจากคนละกลไก จึงไม่ควรนำเปอร์เซ็นต์
            มาเทียบกันเหมือนเป็น Accuracy ระบบยังเก็บค่าเหล่านี้ไว้สำหรับ diagnostics และ human review
            แต่หน้า UI ไม่แสดงค่า engine confidence เป็นเปอร์เซ็นต์เพื่อเปรียบเทียบความแม่นยำ และไม่ใช้
            ค่าเหล่านี้เป็นตัวเลขหลักในการสรุปว่าวิธีใดแม่นกว่า
          </p>
        </article>

        <article className="explanationBlock wide">
          <h3>Optional Research Evaluation: Ground Truth, Exact Match และ Mean Field CER</h3>
          <p>
            Ground Truth เป็นส่วนเสริมสำหรับการทดลอง ไม่จำเป็นต่อการใช้งาน OCR ปกติ หากผู้ใช้กรอกค่าจริง
            ก่อนกดวิเคราะห์ ระบบจะประเมินทั้ง 4 วิธีด้วย Field Exact Match และ Mean Field Character Error
            Rate (Mean Field CER) ซึ่งเป็น metric ที่แยกจาก engine confidence โดยสิ้นเชิง
          </p>
          <div className="methodGrid">
            <div>
              <h4>Field Exact Match</h4>
              <p>
                นับสัดส่วน field ที่ตรงกับ Ground Truth หลัง normalize ข้อความ เช่น ตัดช่องว่าง เครื่องหมาย
                และไม่สนตัวพิมพ์ใหญ่/เล็ก ยิ่งสูงยิ่งดี
              </p>
            </div>
            <div>
              <h4>Mean Field CER</h4>
              <p>
                คำนวณ Character Error Rate แยกแต่ละ Ground Truth field แล้วนำมาเฉลี่ยแบบ macro average
                ยิ่งต่ำยิ่งดี จึงเป็นไปได้ที่ Exact Match จะไม่ถึง 100% แต่ CER ยังต่ำมากเมื่อ field ที่ผิด
                ต่างจากคำตอบจริงเพียงเล็กน้อย
              </p>
            </div>
          </div>
          <div className="methodGrid">
            <div>
              <h4>Ground Truth fields มาจากไหน</h4>
              <p>
                จำนวนที่เห็น เช่น <code>5 Ground Truth fields</code> คือจำนวน field ที่ผู้ใช้กรอกและถูกนำมา
                ประเมินจริงในรอบนั้น Ground Truth ต้องยึดเฉพาะข้อความที่ปรากฏในภาพบัตร ไม่ควรเติมข้อมูลจาก
                ความรู้ภายนอก เช่น ถ้าในภาพไม่มีรหัสไปรษณีย์ ก็ไม่ควรเติมรหัสไปรษณีย์ลงใน Ground Truth
              </p>
            </div>
            <div>
              <h4>สูตร Field Exact Match</h4>
              <p>
                ระบบ normalize ข้อความด้วย Unicode NFKC, ไม่สนตัวพิมพ์ใหญ่/เล็ก และตัดช่องว่างกับ
                เครื่องหมายออกก่อนเทียบ จากนั้นคำนวณ <code>Exact Match = จำนวน field ที่ตรง / จำนวน field
                ที่ประเมิน × 100</code> เช่น ตรง 4 จาก 5 field จะได้ <code>80%</code>
              </p>
            </div>
          </div>
          <div className="methodGrid">
            <div>
              <h4>สูตร CER ราย field</h4>
              <p>
                <code>CER = Levenshtein edit distance / จำนวนอักขระของ Ground Truth หลัง normalize</code>
                โดย edit distance นับจำนวนการเพิ่ม ลบ หรือแทนที่อักขระที่ต้องทำเพื่อให้ผลลัพธ์ตรงกับ
                Ground Truth ยิ่งค่า CER ต่ำยิ่งใกล้ข้อความจริง
              </p>
            </div>
            <div>
              <h4>ทำไม Exact Match 80% แต่ Mean Field CER 2% ได้</h4>
              <p>
                Exact Match ตัดสินแบบทั้ง field: ขาดเพียงข้อความเล็กน้อยก็ถือว่า field นั้นไม่ Exact ส่วน CER
                วัดว่าผิดกี่อักขระ สมมติ CER ของ 5 field คือ <code>0%, 0%, 0%, 0%, 10%</code> จะมี
                Exact Match เพียง 4/5 = <code>80%</code> แต่ Mean Field CER =
                <code> (0 + 0 + 0 + 0 + 10) / 5 = 2%</code>
              </p>
            </div>
          </div>
          <p>
            ตัวอย่างเช่น ถ้า Ground Truth ของที่อยู่มีรหัสไปรษณีย์ต่อท้าย แต่ข้อความบนบัตรจริงไม่มี
            รหัสไปรษณีย์ ผลที่อ่านตรงตามภาพก็ยังถูกนับเป็น Mismatch เมื่อเทียบกับ Ground Truth ที่กรอกเกินมา
            ดังนั้นคุณภาพของ Ground Truth มีผลโดยตรงต่อคะแนน Evaluation
          </p>
          <p>
            สำหรับ Tesseract และ Google Vision ซึ่งคืน raw text ก้อนใหญ่ ระบบจะค้นหาช่วงข้อความที่ใกล้
            Ground Truth ที่สุดก่อนคำนวณ edit distance/CER ส่วน Gemini มี structured field อยู่แล้วจึงเทียบ
            corrected value ของแต่ละ field กับ Ground Truth โดยตรง เพราะวิธีดึงค่ามาเทียบต่างกัน ผล Evaluation
            จึงควรตีความเป็นเครื่องมือทดลองของ prototype ไม่ใช่มาตรฐาน benchmark ภายนอก
          </p>
        </article>

        <article className="explanationBlock wide">
          <h3>ลำดับการทำงานจริงของระบบ</h3>
          <ol className="explanationSteps">
            <li>ผู้ใช้อัปโหลดรูปบัตร แล้วหมุน ซูม และลากภาพให้ตรงกับกรอบไกด์</li>
            <li>Frontend สร้าง aligned crop จากพื้นที่ในกรอบ</li>
            <li>Frontend สร้างภาพ preprocessed เพิ่มจาก aligned crop เดียวกัน</li>
            <li>ส่งภาพปกติ ภาพ preprocessed และ Ground Truth (ถ้ามี) ไปที่ <code>/api/analyze</code></li>
            <li>Backend เขียนไฟล์ภาพชั่วคราว แล้วรัน Tesseract จากภาพปกติ</li>
            <li>Backend รัน Tesseract จากภาพ preprocessed เป็นวิธีที่สอง</li>
            <li>เมื่อ Local OCR เสร็จ Google Vision และ Gemini จะถูกเรียกแบบคู่ขนานด้วย <code>Promise.all</code></li>
            <li>Google Vision รับภาพปกติ ส่วน Gemini รับภาพปกติพร้อม raw Tesseract text จาก Method 1</li>
            <li>Backend ตรวจ validation ของผล Gemini และตรวจ Thai ID checksum เมื่อมีเลขบัตร</li>
            <li>หากมี Ground Truth จึงคำนวณ Exact Match/CER สำหรับทั้ง 4 วิธี</li>
            <li>Backend ส่งผลทั้งหมดกลับ frontend และลบไฟล์ภาพชั่วคราว</li>
          </ol>
        </article>

        <article className="explanationBlock">
          <h3>Frontend</h3>
          <p>
            Frontend เขียนด้วย React + Vite ทำหน้าที่รับภาพ จัดแนวภาพด้วย Canvas สร้าง aligned crop,
            สร้างภาพ preprocessed ส่ง request ไป backend และแสดงผลในหลายมุมมอง โดยไม่เก็บ API key
            ของ Google Vision หรือ Gemini ไว้ฝั่ง browser
          </p>
        </article>

        <article className="explanationBlock">
          <h3>Backend</h3>
          <p>
            Backend เขียนด้วย Express รับภาพผ่าน multer แบบ memory upload จากนั้นสร้างไฟล์ชั่วคราวสำหรับ
            OCR/AI processing เรียก Tesseract, Google Vision และ Gemini ตรวจ validation/evaluation แล้วลบไฟล์
            ชั่วคราวใน <code>finally</code> หลัง request จบ
          </p>
        </article>

        <article className="explanationBlock wide">
          <h3>หน้าผลลัพธ์แต่ละแท็บ</h3>
          <div className="methodGrid">
            <div>
              <h4>สรุปผล</h4>
              <p>
                แสดงข้อมูล structured จาก Gemini, สถานะ human review และ Thai ID checksum หากมี Ground Truth
                จะแสดง Exact Match/CER แบบสรุป โดยไม่เอา engine confidence มาแสดงเป็น Accuracy
              </p>
            </div>
            <div>
              <h4>เทียบผล</h4>
              <p>
                วาง Google Vision, Tesseract ปกติ, Tesseract + preprocessing และ Gemini ไว้ในหน้าเดียว
                เพื่อให้ตรวจความแตกต่างของข้อความได้ด้วยตา
              </p>
            </div>
            <div>
              <h4>Evaluation</h4>
              <p>
                เป็นแท็บเสริมสำหรับงานทดลองเมื่อมี Ground Truth แสดง Exact Match และ Mean Field CER
                ของแต่ละวิธีทั้งระดับสรุปและราย field
              </p>
            </div>
            <div>
              <h4>Code</h4>
              <p>
                แสดง raw OCR text และ JSON เต็มจาก backend สำหรับ debug และตรวจสอบย้อนกลับ โดยไม่แสดง
                confidence ของ OCR providers เป็นเปอร์เซ็นต์เปรียบเทียบกัน
              </p>
            </div>
          </div>
        </article>

        <article className="explanationBlock wide">
          <h3>Privacy และข้อจำกัด</h3>
          <ul>
            <li>Tesseract ประมวลผลใน backend/container ของโปรเจกต์ แต่ Google Vision และ Gemini ต้องส่งภาพไปยังบริการ Cloud ภายนอก</li>
            <li>ควรใช้เฉพาะภาพที่เจ้าของข้อมูลอนุญาต และไม่ควรใช้ prototype นี้เป็นระบบยืนยันตัวตนจริงโดยไม่มีมาตรการเพิ่มเติม</li>
            <li>API key ต้องเก็บไว้ใน backend environment เท่านั้น ไม่ควรฝังใน frontend หรือแชร์ไฟล์ <code>.env</code></li>
            <li>ผล OCR และ Generative AI สามารถผิดได้ แม้ checksum ผ่านหรือโมเดลรายงาน confidence สูง</li>
          </ul>
        </article>

        <article className="explanationBlock wide summaryBlock">
          <h3>สรุปสั้น ๆ สำหรับนำเสนอ</h3>
          <p>
            ระบบเริ่มจากการให้ผู้ใช้จัดแนวและ crop บัตร จากนั้นเปรียบเทียบ Local OCR ปกติ,
            Local OCR หลัง preprocessing, Google Cloud Vision และ Gemini ที่ใช้ภาพพร้อม Tesseract text
            เป็น hint ผล Gemini จะผ่าน backend validation และ checksum เพิ่มเติม ส่วน Ground Truth/Evaluation
            เป็นโหมดเสริมสำหรับวัด Exact Match และ Mean Field CER ในการทดลอง ไม่ใช่ confidence ของโมเดล
          </p>
        </article>
      </div>
    </section>
  );
}

function SummaryResult({ result }) {
  const corrected = getCorrectedResult(result);
  const idValidation = result.gemini?.validation?.thaiIdNumber;
  const fields = [
    ["ชื่อภาษาไทย", corrected?.thai_full_name],
    ["ชื่อภาษาอังกฤษ", corrected?.english_full_name],
    ["เลขบัตรประชาชน", corrected?.id_number],
    ["วันเกิด", corrected?.date_of_birth],
    ["ที่อยู่", corrected?.address]
  ];
  const issues = Array.isArray(corrected?.thai_character_issues)
    ? corrected.thai_character_issues
    : [];
  const overall = corrected?.overall;
  const needsReview = !corrected || Boolean(overall?.needs_human_review);

  if (result.gemini?.enabled === false || result.gemini?.ok === false) {
    return <div className="warning">{result.gemini.message}</div>;
  }

  return (
    <div className="summaryView">
      <div className="summaryHero">
        <div>
          <p className="eyebrow">Gemini Summary</p>
          <h3>{overall?.summary || "สรุปข้อมูลจากภาพบัตร"}</h3>
        </div>

        <div className={needsReview ? "reviewBadge warn" : "reviewBadge"}>
          {needsReview ? "ควรตรวจซ้ำ" : "พร้อมใช้งาน"}
        </div>
      </div>

      <div className="fieldGrid">
        {fields.map(([label, field]) => (
          <FieldCard key={label} label={label} field={field} />
        ))}
      </div>

      <div className="qualityStrip">
        <div>
          <span>Gemini model</span>
          <b>{result.gemini?.model || "N/A"}</b>
        </div>
        <div>
          <span>Human review</span>
          <b>{needsReview ? "Yes" : "No"}</b>
        </div>
      </div>

      <div className="validationStrip">
        <span>Thai ID checksum</span>
        <b
          className={
            idValidation?.valid === true
              ? "validText"
              : idValidation?.valid === false
                ? "invalidText"
                : ""
          }
        >
          {idValidation?.valid === true
            ? "Valid ✅"
            : idValidation?.valid === false
              ? "Invalid / ตรวจซ้ำ ⚠️"
              : "N/A"}
        </b>
        <small>{idValidation?.reason || "ยังไม่มีเลขบัตรให้ตรวจ"}</small>
      </div>

      {result.evaluation && (
        <div className="summaryEvaluation">
          <div>
            <span>Evaluation</span>
            <b>{result.evaluation.fieldsEvaluated?.length || 0} Ground Truth fields</b>
          </div>
          <div>
            <span>Gemini Exact Match</span>
            <b>{formatRatePercent(result.evaluation.methods?.gemini?.summary?.fieldExactMatchRate)}</b>
          </div>
          <div>
            <span>Gemini Mean Field CER</span>
            <b>{formatRatePercent(result.evaluation.methods?.gemini?.summary?.meanFieldCer)}</b>
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="issuesSection">
          <h3>จุดที่ Gemini แนะนำให้แก้</h3>

          <div className="issuesList">
            {issues.map((issue, index) => (
              <div className="issueItem" key={`${issue.ocr_text}-${index}`}>
                <div>
                  <span>OCR</span>
                  <b>{issue.ocr_text || "-"}</b>
                </div>
                <div>
                  <span>แนะนำ</span>
                  <b>{issue.suggested_text || "-"}</b>
                </div>
                <p>{issue.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldCard({ label, field }) {
  return (
    <article className="fieldCard">
      <div className="fieldHeader">
        <span>{label}</span>
      </div>

      <p className="fieldValue">{field?.corrected || "ไม่พบข้อมูล"}</p>

      {field?.ocr && (
        <div className="fieldSource">
          <span>OCR context ที่ Gemini ใช้อ้างอิง</span>
          <p>{field.ocr}</p>
        </div>
      )}

      {field?.note && <p className="fieldNote">{field.note}</p>}
    </article>
  );
}

function CompareResult({ result }) {
  const corrected = getCorrectedResult(result);
  const fields = [
    ["ชื่อภาษาไทย", corrected?.thai_full_name],
    ["ชื่อภาษาอังกฤษ", corrected?.english_full_name],
    ["เลขบัตรประชาชน", corrected?.id_number],
    ["วันเกิด", corrected?.date_of_birth],
    ["ที่อยู่", corrected?.address]
  ];

  return (
    <div className="compareView">
      <div className="compareColumns">
        <section className="comparePanel">
          <div className="compareHeader">
            <span>Google Online OCR</span>
          </div>
          {result.onlineOcr?.enabled === false || result.onlineOcr?.ok === false ? (
            <div className="warning">{result.onlineOcr.message}</div>
          ) : (
            <div className="ocrTextBox">
              {result.onlineOcr?.text || "Google Vision ไม่พบข้อความ"}
            </div>
          )}
        </section>

        <section className="comparePanel">
          <div className="compareHeader">
            <span>OCR เพียว</span>
          </div>
          <div className="ocrTextBox">
            {result.ocr?.text || "ไม่มีข้อความ OCR"}
          </div>
        </section>

        <section className="comparePanel">
          <div className="compareHeader">
            <span>OCR + Preprocessing</span>
          </div>
          <div className="ocrTextBox">
            {result.preprocessedOcr?.text || "ไม่มีข้อความ OCR จากภาพ preprocessed"}
          </div>
        </section>

        <section className="comparePanel">
          <div className="compareHeader">
            <span>Gemini Correction</span>
            <b>{result.gemini?.model || "N/A"}</b>
          </div>

          {result.gemini?.enabled === false || result.gemini?.ok === false ? (
            <div className="warning">{result.gemini.message}</div>
          ) : (
            <div className="correctionList">
              {fields.map(([label, field]) => (
                <CompareField key={label} label={label} field={field} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CompareField({ label, field }) {
  return (
    <article className="compareField">
      <div className="compareFieldTitle">
        <h3>{label}</h3>
      </div>

      <div className="comparePair">
        <div>
          <span>OCR context ที่ Gemini ใช้อ้างอิง</span>
          <p>{field?.ocr || "-"}</p>
        </div>
        <div>
          <span>Gemini</span>
          <p>{field?.corrected || "-"}</p>
        </div>
      </div>

      {field?.note && <p className="compareNote">{field.note}</p>}
    </article>
  );
}

function EvaluationResult({ result }) {
  const evaluation = result.evaluation;

  if (!evaluation) {
    return (
      <div className="evaluationEmpty">
        <h3>ยังไม่มี Ground Truth</h3>
        <p>
          กรอกข้อมูลจริงในส่วน Ground Truth ก่อนกดวิเคราะห์ แล้วระบบจะคำนวณ
          Field Exact Match และ Mean Field Character Error Rate (Mean Field CER) ให้แต่ละวิธีอัตโนมัติ
        </p>
      </div>
    );
  }

  const methods = [
    ["tesseract", "Tesseract"],
    ["preprocessed_tesseract", "Tesseract + Preprocessing"],
    ["google_vision", "Google Vision"],
    ["gemini", "Gemini Correction"]
  ];

  return (
    <div className="evaluationView">
      <div className="evaluationIntro">
        <div>
          <p className="eyebrow">Experimental Evaluation</p>
          <h3>สรุปผลเทียบกับ Ground Truth</h3>
          <p>
            Exact Match ยิ่งสูงยิ่งดี ส่วน Mean Field CER ยิ่งต่ำยิ่งดี และไม่ใช่ค่าเดียวกับ
            OCR confidence หรือ AI-reported confidence
          </p>
        </div>
        <span>{evaluation.fieldsEvaluated?.length || 0} fields</span>
      </div>

      <div className="metricCards">
        {methods.map(([key, label]) => {
          const method = evaluation.methods?.[key];

          return (
            <article className="metricCard" key={key}>
              <span>{label}</span>
              {method?.available === false ? (
                <>
                  <b>N/A</b>
                  <p className="muted">{method.message || "ไม่พร้อมใช้งาน"}</p>
                </>
              ) : (
                <>
                  <b>{formatRatePercent(method?.summary?.fieldExactMatchRate)}</b>
                  <small>Field Exact Match</small>
                  <strong>Mean Field CER {formatRatePercent(method?.summary?.meanFieldCer)}</strong>
                </>
              )}
            </article>
          );
        })}
      </div>

      <div className="evaluationTableWrap">
        <table className="evaluationTable">
          <thead>
            <tr>
              <th>Field</th>
              <th>Ground Truth</th>
              {methods.map(([, label]) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evaluation.fieldsEvaluated.map((fieldName) => {
              const fieldLabel =
                GROUND_TRUTH_FIELDS.find(([field]) => field === fieldName)?.[1] || fieldName;

              return (
                <tr key={fieldName}>
                  <th>{fieldLabel}</th>
                  <td>{evaluation.groundTruth?.[fieldName] || "-"}</td>
                  {methods.map(([key]) => {
                    const method = evaluation.methods?.[key];
                    const field = method?.fields?.[fieldName];

                    return (
                      <td key={key}>
                        {method?.available === false || !field ? (
                          <span className="muted">N/A</span>
                        ) : (
                          <div className="fieldMetric">
                            <b>{field.exactMatch ? "Exact ✅" : "Mismatch ❌"}</b>
                            <span>CER {formatRatePercent(field.cer)}</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="evaluationNote">
        หมายเหตุ: สำหรับ OCR ที่คืนข้อความดิบ ระบบค้นหาช่วงข้อความที่ใกล้กับ Ground Truth
        ที่สุดก่อนคำนวณ CER ราย field; สำหรับ Gemini จะเทียบกับค่าที่ถูกจัดลงแต่ละ field โดยตรง
        แล้วนำ CER ของแต่ละ field มาเฉลี่ยแบบ macro average เป็น Mean Field CER
      </p>
    </div>
  );
}

function CodeResult({ result }) {
  return (
    <div className="resultGrid">
      <div>
        <h3>OCR เพียว</h3>
        <pre>{result.ocr?.text || "ไม่มีข้อความ OCR"}</pre>
      </div>

      <div>
        <h3>OCR + Image preprocessing</h3>
        <pre>{result.preprocessedOcr?.text || "ไม่มีข้อความ OCR จากภาพ preprocessed"}</pre>
      </div>

      <div>
        <h3>Google Cloud Vision OCR</h3>
        {result.onlineOcr?.enabled === false || result.onlineOcr?.ok === false ? (
          <div className="warning">{result.onlineOcr.message}</div>
        ) : (
          <pre>{result.onlineOcr?.text || "Google Vision ไม่พบข้อความ"}</pre>
        )}
      </div>

      <div>
        <h3>Gemini Correction</h3>

        {result.gemini?.enabled === false || result.gemini?.ok === false ? (
          <div className="warning">{result.gemini.message}</div>
        ) : (
          <pre>
            {JSON.stringify(
              result.gemini?.corrected || result.gemini,
              null,
              2
            )}
          </pre>
        )}
      </div>
    </div>
  );
}

function getCorrectedResult(result) {
  const corrected = result.gemini?.corrected;

  if (!corrected || corrected.parseError) {
    return null;
  }

  // Validation is performed by the backend so every API consumer gets
  // the same validated result, not only this React frontend.
  return corrected;
}

function formatRatePercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return `${Math.round(Number(value) * 1000) / 10}%`;
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("แปลง canvas เป็น blob ไม่สำเร็จ"));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

async function createPreprocessedBlob(sourceCanvas) {
  if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) {
    throw new Error("ไม่พบภาพสำหรับทำ preprocessing");
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  ctx.drawImage(sourceCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const contrasted = clampPixel((gray - 128) * 1.45 + 142);
    const cleaned =
      contrasted > 214 ? 255 : contrasted < 48 ? 0 : contrasted;

    data[i] = cleaned;
    data[i + 1] = cleaned;
    data[i + 2] = cleaned;
  }

  ctx.putImageData(imageData, 0, 0);

  return canvasToBlob(canvas, ANALYSIS_IMAGE_TYPE, ANALYSIS_IMAGE_QUALITY);
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();

  return {
    ok: false,
    message: text || "backend ส่ง response ที่อ่านไม่ได้"
  };
}

function drawTransformedPreview(canvas, frame, img, transform) {
  const previewWidth = frame.clientWidth;
  const previewHeight = frame.clientHeight;
  if (!previewWidth || !previewHeight) return;

  const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const canvasWidth = Math.round(previewWidth * pixelRatio);
  const canvasHeight = Math.round(previewHeight * pixelRatio);

  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }

  const ctx = canvas.getContext("2d");
  const baseImage = getPreviewBaseImage(img);
  const radians = (transform.rotation * Math.PI) / 180;

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, previewWidth, previewHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(
    previewWidth / 2 + transform.panX,
    previewHeight / 2 + transform.panY
  );
  ctx.rotate(radians);
  ctx.scale(baseImage.scale * transform.zoom, baseImage.scale * transform.zoom);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
}

export function drawAlignedCrop(canvas, img, options) {
  const cardAspectRatio = options.guideRect.width / options.guideRect.height;
  const outputWidth = Math.max(1, Math.round(options.outputMaxWidth));
  const outputHeight = Math.max(1, Math.round(outputWidth / cardAspectRatio));
  const previewToOutputScale = outputWidth / options.guideRect.width;
  const baseImage = getPreviewBaseImage(img);
  const imageScale = baseImage.scale * options.zoom * previewToOutputScale;
  const radians = (options.rotation * Math.PI) / 180;

  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, outputWidth, outputHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(
    (options.previewWidth / 2 + options.panX - options.guideRect.x) *
      previewToOutputScale,
    (options.previewHeight / 2 + options.panY - options.guideRect.y) *
      previewToOutputScale
  );
  ctx.rotate(radians);
  ctx.scale(imageScale, imageScale);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
}

export function calculateFitZoom(img, frame, rotation) {
  const baseImage = getPreviewBaseImage(img);
  const bounds = getRotatedBounds(baseImage.width, baseImage.height, rotation);
  const availableWidth = frame.clientWidth * 0.94;
  const availableHeight = frame.clientHeight * 0.94;
  const zoom = Math.min(
    availableWidth / Math.max(1, bounds.width),
    availableHeight / Math.max(1, bounds.height)
  );

  return Number(clamp(zoom, MIN_IMAGE_ZOOM, MAX_IMAGE_ZOOM).toFixed(3));
}

export function constrainPan(img, frame, rotation, zoom, panX, panY) {
  const baseImage = getPreviewBaseImage(img);
  const bounds = getRotatedBounds(
    baseImage.width * zoom,
    baseImage.height * zoom,
    rotation
  );
  const guideRect = getCardGuideRect(frame.clientWidth, frame.clientHeight);
  const minimumOverlapX = Math.min(48, guideRect.width * 0.2, bounds.width * 0.2);
  const minimumOverlapY = Math.min(48, guideRect.height * 0.2, bounds.height * 0.2);
  const maxPanX = bounds.width >= guideRect.width
    ? (bounds.width - guideRect.width) / 2
    : Math.max(
      0,
      (guideRect.width + bounds.width) / 2 - minimumOverlapX
    );
  const maxPanY = bounds.height >= guideRect.height
    ? (bounds.height - guideRect.height) / 2
    : Math.max(
      0,
      (guideRect.height + bounds.height) / 2 - minimumOverlapY
    );

  return {
    x: Number(clamp(panX, -maxPanX, maxPanX).toFixed(2)),
    y: Number(clamp(panY, -maxPanY, maxPanY).toFixed(2))
  };
}

export function calculateZoomedPan(options) {
  const zoomRatio = options.nextZoom / options.currentZoom;

  return {
    x:
      options.anchorX -
      options.centerX -
      (options.anchorX - options.centerX - options.panX) * zoomRatio,
    y:
      options.anchorY -
      options.centerY -
      (options.anchorY - options.centerY - options.panY) * zoomRatio
  };
}

function getPreviewBaseImage(img) {
  const scale = Math.min(1, PREVIEW_MAX_WIDTH / img.naturalWidth);

  return {
    scale,
    width: img.naturalWidth * scale,
    height: img.naturalHeight * scale
  };
}

function getRotatedBounds(width, height, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos
  };
}

export function getCardGuideRect(canvasWidth, canvasHeight) {
  const cardAspectRatio = 85.6 / 54;
  let guideWidth = Math.min(canvasWidth * 0.82, canvasHeight * 0.82 * cardAspectRatio);
  let guideHeight = guideWidth / cardAspectRatio;

  if (guideHeight > canvasHeight * 0.82) {
    guideHeight = canvasHeight * 0.82;
    guideWidth = guideHeight * cardAspectRatio;
  }

  return {
    x: (canvasWidth - guideWidth) / 2,
    y: (canvasHeight - guideHeight) / 2,
    width: guideWidth,
    height: guideHeight
  };
}

function positionGuideOverlay(element, guideRect) {
  if (!element) return;

  element.style.left = `${guideRect.x}px`;
  element.style.top = `${guideRect.y}px`;
  element.style.width = `${guideRect.width}px`;
  element.style.height = `${guideRect.height}px`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampPixel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}
