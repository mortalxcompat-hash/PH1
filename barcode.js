let currentScanner = null;
let scannerActive = false;
let stream = null;

let lastCode = null;
let lastTime = 0;

let engine = "zxing";
let zxingTimer = null;
let fallbackActive = false;

/* =========================
   DUPLICATE FILTER (HARD MODE)
========================= */
function isValidScan(code) {
    const now = Date.now();

    if (!code) return false;

    if (lastCode === code && (now - lastTime) < 2500) return false;

    lastCode = code;
    lastTime = now;

    return true;
}

/* =========================
   LOADERS
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
   CAMERA CONTROL
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
   CLEAN RESET (IMPORTANT)
========================= */
function stopScannerAndClose() {
    try {
        if (currentScanner?.stop) currentScanner.stop();
        if (currentScanner?.reset) currentScanner.reset();
    } catch {}

    currentScanner = null;
    scannerActive = false;
    fallbackActive = false;

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

    lastCode = null;
}

/* =========================
   CAMERA STREAM
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

    resultDiv.innerHTML = "GOD MODE scanning...";
}

/* =========================
   ZXING ENGINE (INTELLIGENT)
========================= */
async function startZXing(video, resultDiv, onResult) {
    const ZXingLib = await loadZXing();
    const reader = new ZXingLib.BrowserMultiFormatReader();

    currentScanner = reader;
    scannerActive = true;

    resultDiv.innerHTML = "ZXing active (GOD MODE)";

    // ⛔ intelligent fallback trigger
    zxingTimer = setTimeout(() => {
        if (!fallbackActive) {
            fallbackActive = true;
            switchToQuagga(video, resultDiv, onResult);
        }
    }, 4500);

    try {
        const devices = await ZXingLib.BrowserMultiFormatReader.listVideoInputDevices();
        const deviceId = devices?.[0]?.deviceId;

        reader.decodeFromVideoDevice(deviceId, video, (result) => {
            if (!result) return;

            const code = result.getText();

            if (!isValidScan(code)) return;

            clearTimeout(zxingTimer);

            resultDiv.innerHTML = "ZXing: " + code;

            reader.reset();
            scannerActive = false;

            onResult(code);
        });

    } catch {
        switchToQuagga(video, resultDiv, onResult);
    }
}

/* =========================
   QUAGGA FALLBACK (ROi + STABILITY)
========================= */
async function switchToQuagga(video, resultDiv, onResult) {
    engine = "quagga";

    const Quagga = await loadQuagga();

    resultDiv.innerHTML = "Fallback engine activated";

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
        locator: {
            patchSize: "medium",
            halfSample: true
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

        if (!isValidScan(code)) return;

        resultDiv.innerHTML = "Quagga: " + code;

        Quagga.stop();
        scannerActive = false;

        onResult(code);
    });
}

/* =========================
   MAIN GOD MODE START
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

    // 🔥 ALWAYS START WITH ZXING
    startZXing(video, resultDiv, (code) => {
        const input = document.getElementById(targetInputId);
        if (input) input.value = code;
    });
}

/* =========================
   SEARCH MODE GOD
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
