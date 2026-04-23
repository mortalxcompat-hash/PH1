/* =========================================================
   PRODUCTION GRADE BARCODE SCANNER ENGINE
   Native API → ZXing → Quagga fallback
   Frame throttling, decode locking, duplicate prevention
   COMPATIBLE WITH EXISTING app.js (same functions)
   - startBarcodeScanner(targetInputId)
   - startScannerForSearch()
   - stopScannerAndClose()
========================================================= */

let currentScannerInstance = null;   // holds detector/reader/quagga
let stream = null;
let scanningActive = false;
let decodeLock = false;

let lastScannedCode = null;
let lastScanTime = 0;

let fallbackTimer = null;
let visibilityPaused = false;

let currentResultCallback = null;    // for search mode
let currentTargetInputId = null;     // for form filling mode

/* =========================
   DUPLICATE FILTER
========================= */
function isDuplicate(code) {
    const now = Date.now();
    if (lastScannedCode === code && (now - lastScanTime) < 2000) return true;
    lastScannedCode = code;
    lastScanTime = now;
    return false;
}

/* =========================
   CAMERA INIT (REUSABLE)
========================= */
async function startCamera(videoElement) {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    const constraints = {
        video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    };
    const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = mediaStream;
    stream = mediaStream;
    await videoElement.play();
    // wait until video is ready
    await new Promise(resolve => {
        if (videoElement.readyState >= 2) return resolve();
        videoElement.onloadedmetadata = () => resolve();
    });
}

/* =========================
   STOP EVERYTHING (CLEAN)
========================= */
function stopScannerAndClose() {
    scanningActive = false;
    decodeLock = false;
    clearTimeout(fallbackTimer);
    if (currentScannerInstance) {
        if (typeof currentScannerInstance.stop === 'function') {
            try { currentScannerInstance.stop(); } catch(e) {}
        }
        if (typeof currentScannerInstance.reset === 'function') {
            try { currentScannerInstance.reset(); } catch(e) {}
        }
        currentScannerInstance = null;
    }
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    const modal = document.getElementById('barcodeScannerModal');
    if (modal) modal.style.display = 'none';
    const video = document.getElementById('scannerVideo');
    if (video && video.srcObject) {
        video.srcObject = null;
    }
    currentResultCallback = null;
    currentTargetInputId = null;
}

/* =========================
   VISIBILITY CONTROL (PAUSE WHEN HIDDEN)
========================= */
document.addEventListener("visibilitychange", () => {
    visibilityPaused = document.hidden;
    if (visibilityPaused && stream) {
        stream.getTracks().forEach(t => t.enabled = false);
    } else if (!visibilityPaused && stream) {
        stream.getTracks().forEach(t => t.enabled = true);
    }
});

/* =========================================================
   1. NATIVE BARCODE DETECTOR (BEST)
========================================================= */
async function tryNativeBarcode(videoElement, onSuccess) {
    if (!("BarcodeDetector" in window)) return false;
    const formats = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"];
    const detector = new BarcodeDetector({ formats });
    currentScannerInstance = detector;
    scanningActive = true;

    const loop = async () => {
        if (!scanningActive) return;
        if (decodeLock) {
            requestAnimationFrame(loop);
            return;
        }
        if (visibilityPaused) {
            requestAnimationFrame(loop);
            return;
        }
        decodeLock = true;
        try {
            const barcodes = await detector.detect(videoElement);
            if (barcodes.length > 0) {
                const code = barcodes[0].rawValue;
                if (!isDuplicate(code)) {
                    stopScannerAndClose();
                    onSuccess(code);
                    return;
                }
            }
        } catch(e) {}
        decodeLock = false;
        requestAnimationFrame(loop);
    };
    loop();
    return true;
}

/* =========================================================
   2. ZXING ENGINE (FALLBACK 1)
========================================================= */
function loadZXing() {
    return new Promise((resolve, reject) => {
        if (window.ZXing) return resolve(window.ZXing);
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@latest';
        script.onload = () => resolve(window.ZXing);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function startZXing(videoElement, onSuccess, resultDiv) {
    const ZXingLib = await loadZXing();
    const reader = new ZXingLib.BrowserMultiFormatReader();
    currentScannerInstance = reader;
    scanningActive = true;
    if (resultDiv) resultDiv.innerHTML = 'جاري مسح الباركود...';

    // fallback to Quagga after 3 seconds if nothing detected
    fallbackTimer = setTimeout(() => {
        if (!scanningActive) return;
        switchToQuagga(videoElement, onSuccess, resultDiv);
    }, 3000);

    const devices = await ZXingLib.BrowserMultiFormatReader.listVideoInputDevices();
    const backCamera = devices.find(d => d.label.toLowerCase().includes('back')) ||
                       devices.find(d => d.label.toLowerCase().includes('environment'));
    const deviceId = backCamera?.deviceId || devices[0]?.deviceId;

    reader.decodeFromVideoDevice(deviceId, videoElement, (result) => {
        if (!result || !scanningActive) return;
        const code = result.getText();
        if (isDuplicate(code)) return;
        clearTimeout(fallbackTimer);
        stopScannerAndClose();
        onSuccess(code);
    });
}

/* =========================================================
   3. QUAGGA ENGINE (FALLBACK 2)
========================================================= */
function loadQuagga() {
    return new Promise((resolve, reject) => {
        if (window.Quagga) return resolve(window.Quagga);
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js';
        script.onload = () => resolve(window.Quagga);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function switchToQuagga(videoElement, onSuccess, resultDiv) {
    const Quagga = await loadQuagga();
    currentScannerInstance = Quagga;
    if (resultDiv) resultDiv.innerHTML = 'جاري مسح الباركود (بطيء)...';

    Quagga.init({
        inputStream: {
            type: 'LiveStream',
            target: videoElement,
            constraints: { facingMode: 'environment' }
        },
        decoder: {
            readers: ['ean_reader', 'upc_reader', 'code_128_reader', 'code_39_reader', 'ean_8_reader']
        },
        locate: true
    }, (err) => {
        if (err) return;
        Quagga.start();
        scanningActive = true;
    });

    Quagga.offDetected();
    Quagga.onDetected((data) => {
        if (!scanningActive) return;
        const code = data?.codeResult?.code;
        if (isDuplicate(code)) return;
        stopScannerAndClose();
        onSuccess(code);
    });
}

/* =========================================================
   MAIN EXPOSED FUNCTION: fill input field
   Used by: add/edit medicine forms
========================================================= */
async function startBarcodeScanner(targetInputId) {
    currentTargetInputId = targetInputId;
    const modal = document.getElementById('barcodeScannerModal');
    const video = document.getElementById('scannerVideo');
    const resultDiv = document.getElementById('scannerResult');

    if (!modal || !video) return;

    stopScannerAndClose(); // ensure clean state
    modal.style.display = 'flex';
    if (resultDiv) resultDiv.innerHTML = 'جاري تشغيل الكاميرا...';

    try {
        await startCamera(video);
        if (resultDiv) resultDiv.innerHTML = 'الكاميرا جاهزة، انتظر مسح الباركود...';

        const onSuccess = (code) => {
            const input = document.getElementById(targetInputId);
            if (input) input.value = code;
            // close modal already called inside stopScannerAndClose
        };

        const nativeUsed = await tryNativeBarcode(video, onSuccess);
        if (nativeUsed) return;

        await startZXing(video, onSuccess, resultDiv);
    } catch (err) {
        console.error('Barcode scanner error:', err);
        if (resultDiv) resultDiv.innerHTML = '❌ تعذر فتح الكاميرا. استخدم الإدخال اليدوي.';
        alert('لا يمكن الوصول إلى الكاميرا. يرجى السماح بالوصول أو استخدام الإدخال اليدوي.');
        setTimeout(() => stopScannerAndClose(), 3000);
    }
}

/* =========================================================
   MAIN EXPOSED FUNCTION: search mode (find medicine)
   Used by: home page barcode search button
========================================================= */
async function startScannerForSearch() {
    const modal = document.getElementById('barcodeScannerModal');
    const video = document.getElementById('scannerVideo');
    const resultDiv = document.getElementById('scannerResult');

    if (!modal || !video) return;

    stopScannerAndClose();
    modal.style.display = 'flex';
    if (resultDiv) resultDiv.innerHTML = 'جاري تشغيل الكاميرا...';

    try {
        await startCamera(video);
        if (resultDiv) resultDiv.innerHTML = 'الكاميرا جاهزة، انتظر مسح الباركود...';

        const onSuccess = async (code) => {
            // search medicine by barcode
            if (typeof db !== 'undefined') {
                const med = await db.meds.where('barcode').equals(code).first();
                if (med && typeof window.showMedDetails === 'function') {
                    window.showMedDetails(med);
                } else {
                    alert('لم يتم العثور على دواء بهذا الباركود');
                }
            } else {
                alert('قاعدة البيانات غير جاهزة');
            }
        };

        const nativeUsed = await tryNativeBarcode(video, onSuccess);
        if (nativeUsed) return;

        await startZXing(video, onSuccess, resultDiv);
    } catch (err) {
        console.error('Barcode scanner error:', err);
        if (resultDiv) resultDiv.innerHTML = '❌ تعذر فتح الكاميرا.';
        alert('لا يمكن الوصول إلى الكاميرا.');
        setTimeout(() => stopScannerAndClose(), 3000);
    }
}

/* =========================================================
   Additional helper: manual barcode entry (already exists in HTML)
   We need to support the manual button in the modal.
   The existing HTML has #manualBarcodeBtn. We'll attach event.
========================================================= */
document.addEventListener('DOMContentLoaded', () => {
    const manualBtn = document.getElementById('manualBarcodeBtn');
    if (manualBtn) {
        manualBtn.addEventListener('click', () => {
            const barcode = prompt('أدخل الباركود يدويًا:');
            if (barcode && barcode.trim()) {
                // determine which mode we are in: form fill or search
                if (currentTargetInputId) {
                    const input = document.getElementById(currentTargetInputId);
                    if (input) input.value = barcode.trim();
                    stopScannerAndClose();
                } else {
                    // search mode
                    stopScannerAndClose();
                    if (typeof db !== 'undefined') {
                        db.meds.where('barcode').equals(barcode.trim()).first().then(med => {
                            if (med && typeof window.showMedDetails === 'function') {
                                window.showMedDetails(med);
                            } else {
                                alert('لم يتم العثور على دواء بهذا الباركود');
                            }
                        });
                    } else {
                        alert('قاعدة البيانات غير جاهزة');
                    }
                }
            }
        });
    }

    // attach close buttons (they already exist in HTML, but ensure they call stop)
    const closeScannerModal = document.getElementById('closeScannerModal');
    if (closeScannerModal) closeScannerModal.addEventListener('click', stopScannerAndClose);
    const cancelScannerBtn = document.getElementById('cancelScannerBtn');
    if (cancelScannerBtn) cancelScannerBtn.addEventListener('click', stopScannerAndClose);
});

// Export global functions exactly as expected by app.js
window.startBarcodeScanner = startBarcodeScanner;
window.startScannerForSearch = startScannerForSearch;
window.stopScannerAndClose = stopScannerAndClose;
