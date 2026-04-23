/* =========================================================
   PRODUCTION GRADE BARCODE SCANNER ENGINE
   Native API → ZXing → Quagga fallback
   + Frame throttling
   + Decode locking
   + Smart fallback
   + Visibility pause control
   + CLEAN UI MODE (NO ENGINE TEXT)
========================================================= */

let currentEngine = null;
let stream = null;

let scanning = false;
let decodeLock = false;

let lastCode = null;
let lastTime = 0;

let fallbackTimer = null;
let visibilityPaused = false;

/* =========================
   DUPLICATE FILTER (FAST)
========================= */
function isDuplicate(code) {
    const now = Date.now();

    if (lastCode === code && (now - lastTime) < 2000) return true;

    lastCode = code;
    lastTime = now;

    return false;
}

/* =========================
   CAMERA INIT
========================= */
async function startCamera(video) {
    const s = await navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    });

    video.srcObject = s;
    stream = s;

    await video.play();

    /* ensure video is ready */
    await new Promise(resolve => {
        if (video.readyState >= 2) return resolve();
        video.onloadedmetadata = () => resolve();
    });
}

/* =========================
   CLEAN STOP
========================= */
function stopScanner() {
    scanning = false;
    decodeLock = false;

    clearTimeout(fallbackTimer);

    if (currentEngine?.reset) currentEngine.reset();
    if (currentEngine?.stop) currentEngine.stop();

    currentEngine = null;

    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
}

/* =========================
   VISIBILITY CONTROL
========================= */
document.addEventListener("visibilitychange", () => {
    visibilityPaused = document.hidden;

    if (visibilityPaused) {
        if (stream) stream.getTracks().forEach(t => t.enabled = false);
    } else {
        if (stream) stream.getTracks().forEach(t => t.enabled = true);
    }
});

/* =========================================================
   1. NATIVE BARCODE DETECTOR
========================================================= */
async function tryNativeBarcode(video, onResult) {
    if (!("BarcodeDetector" in window)) return false;

    const detector = new BarcodeDetector({
        formats: [
            "ean_13",
            "ean_8",
            "code_128",
            "code_39",
            "upc_a",
            "upc_e"
        ]
    });

    currentEngine = detector;
    scanning = true;

    const loop = async () => {
        if (!scanning) return;

        if (decodeLock) decodeLock = false;
        if (visibilityPaused) return requestAnimationFrame(loop);

        try {
            decodeLock = true;

            const barcodes = await detector.detect(video);

            if (barcodes.length > 0) {
                const code = barcodes[0].rawValue;

                if (!isDuplicate(code)) {
                    stopScanner();
                    onResult(code);
                    return;
                }
            }

        } catch {}

        requestAnimationFrame(loop);
    };

    loop();
    return true;
}

/* =========================================================
   2. ZXING ENGINE
========================================================= */
async function loadZXing() {
    if (window.ZXing) return window.ZXing;

    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/@zxing/library@latest";
        s.onload = () => resolve(window.ZXing);
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function startZXing(video, onResult, resultDiv) {
    const ZXingLib = await loadZXing();
    const reader = new ZXingLib.BrowserMultiFormatReader();

    currentEngine = reader;
    scanning = true;

    /* CLEAN UI ONLY */
    if (resultDiv) resultDiv.innerHTML = "يتم مسح الباركود";

    fallbackTimer = setTimeout(() => {
        if (!scanning) return;
        switchToQuagga(video, onResult, resultDiv);
    }, 3000);

    const devices = await ZXingLib.BrowserMultiFormatReader.listVideoInputDevices();

    const backCamera =
        devices?.find(d => d.label?.toLowerCase().includes("back")) ||
        devices?.find(d => d.label?.toLowerCase().includes("environment"));

    const deviceId = backCamera?.deviceId || devices?.[0]?.deviceId;

    reader.decodeFromVideoDevice(deviceId, video, (result) => {
        if (!result || !scanning) return;

        const code = result.getText();

        if (isDuplicate(code)) return;

        clearTimeout(fallbackTimer);
        stopScanner();

        onResult(code);
    });
}

/* =========================================================
   3. QUAGGA FALLBACK
========================================================= */
async function loadQuagga() {
    if (window.Quagga) return window.Quagga;

    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js";
        s.onload = () => resolve(window.Quagga);
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function switchToQuagga(video, onResult, resultDiv) {
    const Quagga = await loadQuagga();

    currentEngine = Quagga;

    if (resultDiv) resultDiv.innerHTML = "يتم مسح الباركود";

    Quagga.init({
        inputStream: {
            type: "LiveStream",
            target: video,
            constraints: {
                facingMode: "environment"
            }
        },
        decoder: {
            readers: [
                "ean_reader",
                "upc_reader",
                "code_128_reader",
                "code_39_reader",
                "ean_8_reader"
            ]
        },
        locate: true
    }, (err) => {
        if (err) return;

        Quagga.start();
        scanning = true;
    });

    Quagga.offDetected();

    Quagga.onDetected((data) => {
        if (!scanning) return;

        const code = data?.codeResult?.code;

        if (isDuplicate(code)) return;

        stopScanner();
        onResult(code);
    });
}

/* =========================================================
   MAIN START FUNCTION (CLEAN UI)
========================================================= */
async function startBarcodeScanner(videoId, onResult) {
    const video = document.getElementById(videoId);
    const modal = document.getElementById("barcodeScannerModal");
    const resultDiv = document.getElementById("scannerResult");

    if (!video) return;

    stopScanner();

    modal.style.display = "flex";

    await startCamera(video);

    await new Promise(r => setTimeout(r, 800));

    /* CLEAN UI TEXT ONLY */
    if (resultDiv) resultDiv.innerHTML = "يتم مسح الباركود";

    const native = await tryNativeBarcode(video, onResult);
    if (native) return;

    await startZXing(video, onResult, resultDiv);
}

/* =========================================================
   EXPORTS
========================================================= */
window.startBarcodeScanner = startBarcodeScanner;
window.stopScanner = stopScanner;
