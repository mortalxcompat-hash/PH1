let currentScanner = null;
let scannerActive = false;

async function requestCameraPermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
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
    const modal = document.getElementById('barcodeScannerModal');
    if (modal) modal.style.display = 'none';
    const video = document.getElementById('scannerVideo');
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
}

async function startBarcodeScanner(targetInputId, retryCount = 0) {
    const modal = document.getElementById('barcodeScannerModal');
    const video = document.getElementById('scannerVideo');
    const resultDiv = document.getElementById('scannerResult');
    if (!modal || !video) return;
    
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
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const QuaggaLib = window.Quagga;
    if (!QuaggaLib) {
        resultDiv.innerHTML = '❌ مكتبة الباركود غير متوفرة.';
        alert('مكتبة الباركود غير متوفرة. تأكد من تحميل Quagga.');
        return;
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
            readers: ["ean_reader", "ean_8_reader", "code_128_reader", "code_39_reader", "upc_reader", "codabar_reader"]
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
        resultDiv.innerHTML = 'انتظر مسح الباركود...';
        const manualBtn = document.getElementById('manualBarcodeBtn');
        if (manualBtn) manualBtn.style.display = 'inline-block';
    });
    
    QuaggaLib.offDetected();
    QuaggaLib.onDetected((data) => {
        if (!scannerActive) return;
        const code = data.codeResult.code;
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
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const QuaggaLib = window.Quagga;
    if (!QuaggaLib) {
        resultDiv.innerHTML = '❌ مكتبة الباركود غير متوفرة.';
        alert('مكتبة الباركود غير متوفرة.');
        return;
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
            readers: ["ean_reader", "ean_8_reader", "code_128_reader", "code_39_reader", "upc_reader", "codabar_reader"]
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
        resultDiv.innerHTML = 'انتظر مسح الباركود...';
        const manualBtn = document.getElementById('manualBarcodeBtn');
        if (manualBtn) manualBtn.style.display = 'inline-block';
    });
    
    QuaggaLib.offDetected();
    QuaggaLib.onDetected(async (data) => {
        if (!scannerActive) return;
        const code = data.codeResult.code;
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
