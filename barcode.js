let currentScanner = null;
let scannerActive = false;
let stream = null;
let lastScannedCode = null;
let lastScanTime = 0;

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
            script.onload = () => {
                if (typeof window.Quagga !== 'undefined') {
                    resolve(window.Quagga);
                } else {
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
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        return true;
    } catch (err) {
        console.error('Camera permission error:', err);
        return false;
    }
}

function stopScannerAndClose() {
    if (currentScanner) {
        try { currentScanner.stop(); } catch(e) {}
        currentScanner = null;
    }
    scannerActive = false;
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

async function startBarcodeScanner(targetInputId, retryCount = 0) {
    const modal = document.getElementById('barcodeScannerModal');
    const video = document.getElementById('scannerVideo');
    const resultDiv = document.getElementById('scannerResult');
    if (!modal || !video) return;

    let QuaggaLib;
    try {
        QuaggaLib = await ensureQuaggaLoaded();
    } catch (err) {
        resultDiv.innerHTML = '❌ تعذر تحميل مكتبة الباركود. تأكد من اتصال الإنترنت.';
        modal.style.display = 'flex';
        alert('تعذر تحميل مكتبة الباركود. يرجى التحقق من اتصال الإنترنت وإعادة المحاولة.');
        return;
    }

    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
        resultDiv.innerHTML = '❌ لا يمكن الوصول إلى الكاميرا. يرجى السماح بالوصول.';
        modal.style.display = 'flex';
        if (retryCount < 2) {
            setTimeout(() => startBarcodeScanner(targetInputId, retryCount + 1), 1000);
        } else {
            alert('لا يمكن الوصول إلى الكاميرا. الرجاء السماح بالوصول في إعدادات المتصفح.');
        }
        return;
    }

    stopScannerAndClose();
    modal.setAttribute('data-target', targetInputId);
    modal.style.display = 'flex';
    resultDiv.innerHTML = 'جاري تشغيل الكاميرا...';

    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = videoStream;
        stream = videoStream;
        resultDiv.innerHTML = 'الكاميرا جاهزة، انتظر مسح الباركود...';
    } catch (err) {
        console.error('Error accessing camera for preview:', err);
        resultDiv.innerHTML = '⚠️ تعذر عرض معاينة الكاميرا، لكن المسح يعمل في الخلفية.';
    }

    QuaggaLib.init({
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: video,
            constraints: {
                facingMode: "environment",
                width: { min: 640, ideal: 1280, max: 1920 },
                height: { min: 480, ideal: 720, max: 1080 }
            }
        },
        decoder: {
            readers: [
                "ean_reader",        // مهم لقراءة EAN-13 (13 رقم) - هذا هو الأهم للأكواد في الصورة
                "ean_8_reader",      // لقراءة EAN-8 (8 أرقام)
                "code_128_reader",   // لقراءة Code 128
                "code_39_reader",    // لقراءة Code 39
                "upc_reader",        // لقراءة UPC-A (12 رقم)
                "upc_e_reader",      // لقراءة UPC-E
                "codabar_reader"     // لقراءة Codabar
            ],
            multiple: false
        },
        locate: true,
        numOfWorkers: navigator.hardwareConcurrency || 2
    }, (err) => {
        if (err) {
            console.error('Quagga init error:', err);
            resultDiv.innerHTML = '❌ تعذر فتح الكاميرا. استخدم الإدخال اليدوي.';
            const manualBtn = document.getElementById('manualBarcodeBtn');
            if (manualBtn) manualBtn.style.display = 'inline-block';
            if (retryCount < 2) {
                setTimeout(() => startBarcodeScanner(targetInputId, retryCount + 1), 1500);
            }
            return;
        }
        QuaggaLib.start();
        currentScanner = QuaggaLib;
        scannerActive = true;
        const manualBtn = document.getElementById('manualBarcodeBtn');
        if (manualBtn) manualBtn.style.display = 'inline-block';
    });

    QuaggaLib.offDetected();
    QuaggaLib.onDetected((data) => {
        if (!scannerActive) return;
        
        const code = data.codeResult.code;
        const now = Date.now();
        
        // منع القراءة المتكررة لنفس الكود خلال ثانيتين
        if (lastScannedCode === code && (now - lastScanTime) < 2000) {
            return;
        }
        
        lastScannedCode = code;
        lastScanTime = now;
        
        resultDiv.innerHTML = `✅ تم مسح: ${code}`;
        QuaggaLib.stop();
        scannerActive = false;
        currentScanner = null;
        modal.style.display = 'none';
        const targetInput = document.getElementById(targetInputId);
        if (targetInput) targetInput.value = code;
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
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
    } catch (err) {
        resultDiv.innerHTML = '❌ تعذر تحميل مكتبة الباركود.';
        modal.style.display = 'flex';
        alert('تعذر تحميل مكتبة الباركود. يرجى التحقق من اتصال الإنترنت.');
        return;
    }

    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
        resultDiv.innerHTML = '❌ لا يمكن الوصول إلى الكاميرا.';
        modal.style.display = 'flex';
        alert('لا يمكن الوصول إلى الكاميرا.');
        return;
    }

    stopScannerAndClose();
    modal.style.display = 'flex';
    resultDiv.innerHTML = 'جاري تشغيل الكاميرا...';

    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = videoStream;
        stream = videoStream;
        resultDiv.innerHTML = 'الكاميرا جاهزة، انتظر مسح الباركود...';
    } catch (err) {
        console.error('Error accessing camera for preview:', err);
        resultDiv.innerHTML = '⚠️ تعذر عرض معاينة الكاميرا، لكن المسح يعمل في الخلفية.';
    }

    QuaggaLib.init({
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: video,
            constraints: {
                facingMode: "environment",
                width: { min: 640, ideal: 1280, max: 1920 },
                height: { min: 480, ideal: 720, max: 1080 }
            }
        },
        decoder: {
            readers: [
                "ean_reader",
                "ean_8_reader",
                "code_128_reader",
                "code_39_reader",
                "upc_reader",
                "upc_e_reader",
                "codabar_reader"
            ],
            multiple: false
        },
        locate: true,
        numOfWorkers: navigator.hardwareConcurrency || 2
    }, (err) => {
        if (err) {
            resultDiv.innerHTML = '❌ تعذر فتح الكاميرا. استخدم الإدخال اليدوي.';
            const manualBtn = document.getElementById('manualBarcodeBtn');
            if (manualBtn) manualBtn.style.display = 'inline-block';
            alert('تعذر الوصول إلى الكاميرا.');
            return;
        }
        QuaggaLib.start();
        currentScanner = QuaggaLib;
        scannerActive = true;
        const manualBtn = document.getElementById('manualBarcodeBtn');
        if (manualBtn) manualBtn.style.display = 'inline-block';
    });

    QuaggaLib.offDetected();
    QuaggaLib.onDetected(async (data) => {
        if (!scannerActive) return;
        
        const code = data.codeResult.code;
        const now = Date.now();
        
        if (lastScannedCode === code && (now - lastScanTime) < 2000) {
            return;
        }
        
        lastScannedCode = code;
        lastScanTime = now;
        
        resultDiv.innerHTML = `✅ تم مسح: ${code}`;
        QuaggaLib.stop();
        scannerActive = false;
        currentScanner = null;
        modal.style.display = 'none';
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        if (typeof window.findMedicineByBarcode === 'function') {
            window.findMedicineByBarcode(code);
        } else {
            const med = await db.meds.where('barcode').equals(code).first();
            if (med) window.showMedDetails(med);
            else alert('لم يتم العثور على دواء بهذا الباركود');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const scanBarcodeBtn = document.getElementById('scanBarcodeBtn');
    if (scanBarcodeBtn) scanBarcodeBtn.onclick = () => startBarcodeScanner('medBarcode');
    const scanBarcodeGenBtn = document.getElementById('scanBarcodeGenBtn');
    if (scanBarcodeGenBtn) scanBarcodeGenBtn.onclick = () => startBarcodeScanner('genBarcode');
    const homeBarcodeBtn = document.getElementById('homeBarcodeBtn');
    if (homeBarcodeBtn) homeBarcodeBtn.onclick = () => startScannerForSearch();
    const barcodeSearchBtn = document.getElementById('barcodeSearchBtn');
    if (barcodeSearchBtn) barcodeSearchBtn.onclick = () => startScannerForSearch();
    const closeScannerModal = document.getElementById('closeScannerModal');
    if (closeScannerModal) closeScannerModal.onclick = stopScannerAndClose;
    const cancelScannerBtn = document.getElementById('cancelScannerBtn');
    if (cancelScannerBtn) cancelScannerBtn.onclick = stopScannerAndClose;
    const manualBarcodeBtn = document.getElementById('manualBarcodeBtn');
    if (manualBarcodeBtn) {
        manualBarcodeBtn.addEventListener('click', () => {
            const barcode = prompt('أدخل الباركود يدويًا:');
            if (barcode && barcode.trim()) {
                const targetId = document.querySelector('#barcodeScannerModal').getAttribute('data-target');
                const targetInput = document.getElementById(targetId);
                if (targetInput) targetInput.value = barcode.trim();
                stopScannerAndClose();
            }
        });
    }
});

window.startBarcodeScanner = startBarcodeScanner;
window.startScannerForSearch = startScannerForSearch;
window.stopScannerAndClose = stopScannerAndClose;
