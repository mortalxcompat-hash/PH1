/* =========================================================
   ULTIMATE ADAPTIVE BARCODE SCANNER SYSTEM (OPTIMIZED)
   ZXing → Quagga fallback
   + Scan History Buffer
   + Stable Detection + Duplicate Filter
========================================================= */

let currentScanner = null;
let scannerActive = false;
let stream = null;

let lastCode = null;
let lastTime = 0;

let engineMode = "pro";
let zxingTimer = null;
let fallbackTriggered = false;

/* =========================
   SCAN HISTORY BUFFER
========================= */
let scanHistory = [];
const MAX_HISTORY = 6;

function pushScan(code) {
    scanHistory.push({
        code,
        time: Date.now()
    });

    if (scanHistory.length > MAX_HISTORY) {
        scanHistory.shift();
    }
}

function isStableScan(code) {
    const recent = scanHistory.filter(x => x.code === code);
    return recent.length >= 2;
}

/* =========================
   DUPLICATE FILTER
========================= */
function isDuplicate(code) {
    const now = Date.now();

    if (lastCode === code && (now - lastTime) < 2500) return true;

    lastCode = code;
    lastTime = now;

    return false;
}

/* =========================
   LOAD ZXING
========================= */
function loadZXing() {
    return new Promise((resolve, reject) => {
        if (window.ZXing) return resolve(window.ZXing);

        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/@zxing/library@latest";
        s.onload = () => resolve(window.ZXing);
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

/* =========================
   LOAD QUAGGA
========================= */
function loadQuagga() {
    return new Promise((resolve, reject) => {
        if (window.Quagga) return resolve(window.Quagga);

        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js";
        s.onload = () => resolve(window.Quagga);
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

/* =========================
   CAMERA PERMISSION
========================= */
async function requestCamera() {
    try {
        const temp = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        temp.getTracks().forEach(t => t.stop());
        return true;
    } catch {
        return false;
    }
}

/* =========================
   CLEAN RESET
========================= */
function stopScannerAndClose() {
    try {
        if (currentScanner?.stop) currentScanner.stop();
        if (currentScanner?.reset) currentScanner.reset();
    } catch {}

    currentScanner = null;
    scannerActive = false;

    fallbackTriggered = false;
    engineMode = "pro";

    clearTimeout(zxingTimer);

    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }

    const modal = document.getElementById("barcodeScannerModal");
    if (modal) modal.style.display = "none";

    const video = document.getElementById("scannerVideo");
    if (video?.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }

    scanHistory = [];
}

/* =========================
   CAMERA START
========================= */
async function startCamera(video, resultDiv) {
    const s = await navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    });

    video.srcObject = s;
    stream = s;

    resultDiv.innerHTML = "Scanning...";
}

/* =========================
   ZXING ENGINE (PRIMARY)
========================= */
async function startZXing(video, resultDiv, onResult) {
    const ZXingLib = await loadZXing();
    const reader = new ZXingLib.BrowserMultiFormatReader();

    currentScanner = reader;
    scannerActive = true;

    resultDiv.innerHTML = "ZXing scanning...";

    /* fallback timer (optimized) */
    zxingTimer = setTimeout(() => {
        if (!fallbackTriggered) {
            fallbackTriggered = true;
            switchToQuagga(video, resultDiv, onResult);
        }
    }, 2500); // أسرع من السابق

    const devices = await ZXingLib.BrowserMultiFormatReader.listVideoInputDevices();
    const deviceId = devices?.[0]?.deviceId;

    reader.decodeFromVideoDevice(deviceId, video, (result) => {
        if (!result) return;

        const code = result.getText();

        pushScan(code);
        if (!isStableScan(code)) return;
        if (isDuplicate(code)) return;

        clearTimeout(zxingTimer);

        resultDiv.innerHTML = "ZXing: " + code;

        reader.reset();
        scannerActive = false;

        onResult(code);
    });
}

/* =========================
   QUAGGA FALLBACK
========================= */
async function switchToQuagga(video, resultDiv, onResult) {
    engineMode = "quagga";

    const Quagga = await loadQuagga();

    resultDiv.innerHTML = "Fallback active...";

    Quagga.init({
        inputStream: {
            type: "LiveStream",
            target: video,
            constraints: {
                facingMode: "environment"
            },
            area: {
                top: "15%",
                bottom: "15%",
                left: "10%",
                right: "10%"
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
        locate: true,
        frequency: 8
    }, (err) => {
        if (err) {
            resultDiv.innerHTML = "Scanner error";
            return;
        }

        Quagga.start();
        currentScanner = Quagga;
        scannerActive = true;
    });

    Quagga.offDetected();

    Quagga.onDetected((data) => {
        const code = data?.codeResult?.code;

        pushScan(code);
        if (!isStableScan(code)) return;
        if (isDuplicate(code)) return;

        resultDiv.innerHTML = "Quagga: " + code;

        Quagga.stop();
        scannerActive = false;

        onResult(code);
    });
}

/* =========================
   MAIN START FUNCTION
========================= */
async function startBarcodeScanner(targetInputId) {
    const modal = document.getElementById("barcodeScannerModal");
    const video = document.getElementById("scannerVideo");
    const resultDiv = document.getElementById("scannerResult");

    if (!modal || !video) return;

    const ok = await requestCamera();
    if (!ok) {
        resultDiv.innerHTML = "No camera permission";
        modal.style.display = "flex";
        return;
    }

    stopScannerAndClose();

    modal.setAttribute("data-target", targetInputId);
    modal.style.display = "flex";

    await startCamera(video, resultDiv);

    /* START ENGINE */
    startZXing(video, resultDiv, (code) => {
        const input = document.getElementById(targetInputId);
        if (input) input.value = code;
    });
}

/* =========================
   SEARCH MODE
========================= */
async function startScannerForSearch() {
    const modal = document.getElementById("barcodeScannerModal");
    const video = document.getElementById("scannerVideo");
    const resultDiv = document.getElementById("scannerResult");

    if (!modal || !video) return;

    const ok = await requestCamera();
    if (!ok) {
        resultDiv.innerHTML = "No camera permission";
        modal.style.display = "flex";
        return;
    }

    stopScannerAndClose();

    modal.style.display = "flex";

    await startCamera(video, resultDiv);

    startZXing(video, resultDiv, async (code) => {

        if (typeof window.findMedicineByBarcode === "function") {
            window.findMedicineByBarcode(code);
        } else {
            const med = await db?.meds?.where("barcode").equals(code).first();
            if (med) window.showMedDetails(med);
            else alert("Not found");
        }
    });
}

/* =========================
   EXPORTS
========================= */
window.startBarcodeScanner = startBarcodeScanner;
window.startScannerForSearch = startScannerForSearch;
window.stopScannerAndClose = stopScannerAndClose;
