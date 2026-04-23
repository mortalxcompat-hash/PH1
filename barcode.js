let currentScanner = null;
let scannerActive = false;
let stream = null;
let lastScannedCode = null;
let lastScanTime = 0;
let detectionLock = false; // منع التكرار السريع

function ensureQuaggaLoaded() {
    return new Promise((resolve, reject) => {
        if (typeof window.Quagga !== 'undefined') {
            resolve(window.Quagga);
            return;
        }

        const cdnList = [
            'https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js',
            'https://unpkg.com/quagga@0.12.1/dist/quagga.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js'
        ];

        let current = 0;

        function tryLoad() {
            if (current >= cdnList.length) {
                reject(new Error('فشل تحميل مكتبة Quagga'));
                return;
            }

            const script = document.createElement('script');
            script.src = cdnList[current];
            script.async = true;

            script.onload = () => {
                if (window.Quagga) resolve(window.Quagga);
                else {
                    current++;
                    tryLoad();
                }
            };

            script.onerror = () => {
                current++;
                tryLoad();
            };

            document.head.appendChild(script);
        }

        tryLoad();
    });
}

async function requestCameraPermission() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "environment"
            }
        });

        stream.getTracks().forEach(track => track.stop());
        stream = null;

        return true;
    } catch (err) {
        console.error('Camera permission error:', err);
        return false;
    }
}

function stopScannerAndClose() {
    try {
        if (currentScanner) {
            currentScanner.offDetected();
            currentScanner.stop();
        }
    } catch (e) {}

    currentScanner = null;
    scannerActive = false;
    detectionLock = false;

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    const modal = document.getElementById('barcodeScannerModal');
    if (modal) modal.style.display = 'none';

    const video = document.getElementById('scannerVideo');
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    lastScannedCode = null;
}

async function initCameraPreview(video, resultDiv) {
    try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                focusMode: "continuous"
            }
        });

        video.srcObject = videoStream;
        stream = videoStream;

        resultDiv.innerHTML = 'الكاميرا جاهزة، انتظر مسح الباركود...';

    } catch (err) {
        console.error('Preview error:', err);
        resultDiv.innerHTML = '⚠️ تعذر عرض الكاميرا، لكن المسح يعمل.';
    }
}

function createQuaggaConfig(video) {
    return {
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: video,
            constraints: {
                facingMode: "environment",
                width: { min: 640, ideal: 1280 },
                height: { min: 480, ideal: 720 }
            }
        },
        locator: {
            patchSize: "medium",
            halfSample: true
        },
        decoder: {
            readers: [
                "ean_reader",
                "ean_8_reader",
                "upc_reader",
                "upc_e_reader",
                "code_128_reader",
                "code_39_reader",
                "codabar_reader"
            ],
            multiple: false
        },
        locate: true,
        frequency: 10,
        numOfWorkers: navigator.hardwareConcurrency || 2
    };
}

function handleDetection(QuaggaLib, data, video, modal, resultDiv, callback) {
    if (!scannerActive || detectionLock) return;

    const code = data.codeResult.code;
    const now = Date.now();

    if (lastScannedCode === code && (now - lastScanTime) < 2000) return;

    detectionLock = true;
    lastScannedCode = code;
    lastScanTime = now;

    resultDiv.innerHTML = `✅ تم مسح: ${code}`;

    try {
        QuaggaLib.offDetected();
        QuaggaLib.stop();
    } catch (e) {}

    scannerActive = false;
    currentScanner = null;

    modal.style.display = 'none';

    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    setTimeout(() => {
        detectionLock = false;
    }, 1500);

    callback(code);
}

async function startBarcodeScanner(targetInputId, retryCount = 0) {
    const modal = document.getElementById('barcodeScannerModal');
    const video = document.getElementById('scannerVideo');
    const resultDiv = document.getElementById('scannerResult');

    if (!modal || !video) return;

    let QuaggaLib;

    try {
        QuaggaLib = await ensureQuaggaLoaded();
    } catch {
        resultDiv.innerHTML = '❌ فشل تحميل المكتبة';
        modal.style.display = 'flex';
        return;
    }

    const hasPermission = await requestCameraPermission();

    if (!hasPermission) {
        resultDiv.innerHTML = '❌ لا يوجد إذن للكاميرا';
        modal.style.display = 'flex';
        return;
    }

    stopScannerAndClose();

    modal.setAttribute('data-target', targetInputId);
    modal.style.display = 'flex';

    await initCameraPreview(video, resultDiv);

    QuaggaLib.init(createQuaggaConfig(video), (err) => {
        if (err) {
            resultDiv.innerHTML = '❌ خطأ في تشغيل الكاميرا';
            return;
        }

        QuaggaLib.start();
        currentScanner = QuaggaLib;
        scannerActive = true;
    });

    QuaggaLib.offDetected();
    QuaggaLib.onDetected((data) => {
        handleDetection(
            QuaggaLib,
            data,
            video,
            modal,
            resultDiv,
            (code) => {
                const targetInput = document.getElementById(targetInputId);
                if (targetInput) targetInput.value = code;
            }
        );
    });
}

async function startScannerForSearch() {
    const modal = document.getElementById('barcodeScannerModal');
    const video = document.getElementById('scannerVideo');
    const resultDiv = document.getElementById('scannerResult');

    if (!modal || !video) return;

    let QuaggaLib;

    try {
        QuaggaLib = await ensureQuaggaLoaded();
    } catch {
        resultDiv.innerHTML = '❌ فشل تحميل المكتبة';
        modal.style.display = 'flex';
        return;
    }

    const hasPermission = await requestCameraPermission();

    if (!hasPermission) {
        resultDiv.innerHTML = '❌ لا يوجد إذن للكاميرا';
        modal.style.display = 'flex';
        return;
    }

    stopScannerAndClose();

    modal.style.display = 'flex';

    await initCameraPreview(video, resultDiv);

    QuaggaLib.init(createQuaggaConfig(video), (err) => {
        if (err) {
            resultDiv.innerHTML = '❌ خطأ في الكاميرا';
            return;
        }

        QuaggaLib.start();
        currentScanner = QuaggaLib;
        scannerActive = true;
    });

    QuaggaLib.offDetected();
    QuaggaLib.onDetected((data) => {
        handleDetection(
            QuaggaLib,
            data,
            video,
            modal,
            resultDiv,
            async (code) => {
                if (typeof window.findMedicineByBarcode === 'function') {
                    window.findMedicineByBarcode(code);
                } else {
                    const med = await db.meds.where('barcode').equals(code).first();
                    if (med) window.showMedDetails(med);
                    else alert('لم يتم العثور على دواء');
                }
            }
        );
    });
}

document.addEventListener('DOMContentLoaded', () => {

    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    };

    bind('scanBarcodeBtn', () => startBarcodeScanner('medBarcode'));
    bind('scanBarcodeGenBtn', () => startBarcodeScanner('genBarcode'));
    bind('homeBarcodeBtn', startScannerForSearch);
    bind('barcodeSearchBtn', startScannerForSearch);
    bind('closeScannerModal', stopScannerAndClose);
    bind('cancelScannerBtn', stopScannerAndClose);

    const manualBarcodeBtn = document.getElementById('manualBarcodeBtn');

    if (manualBarcodeBtn) {
        manualBarcodeBtn.onclick = () => {
            const barcode = prompt('أدخل الباركود:');

            if (!barcode || !barcode.trim()) return;

            const modal = document.getElementById('barcodeScannerModal');
            const targetId = modal.getAttribute('data-target');
            const targetInput = document.getElementById(targetId);

            if (targetInput) targetInput.value = barcode.trim();

            stopScannerAndClose();
        };
    }
});

window.startBarcodeScanner = startBarcodeScanner;
window.startScannerForSearch = startScannerForSearch;
window.stopScannerAndClose = stopScannerAndClose;
