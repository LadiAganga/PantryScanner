// scanner.js — thin wrapper around the html5-qrcode library for camera scanning.

let scannerInstance = null;
let hasFired = false;

function startScanner(elementId, onScanSuccess, onFatalError) {
  hasFired = false;
  scannerInstance = new Html5Qrcode(elementId, {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODABAR,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.QR_CODE,
    ],
    verbose: false,
  });

  const config = {
    fps: 12,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const size = Math.min(viewfinderWidth, viewfinderHeight);
      return { width: Math.floor(size * 0.75), height: Math.floor(size * 0.45) };
    },
  };

  return scannerInstance
    .start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        if (hasFired) return;
        hasFired = true;
        if (navigator.vibrate) navigator.vibrate(80);
        onScanSuccess(decodedText);
      },
      () => {
        // Fires continuously while no code is detected — expected, ignore.
      }
    )
    .catch(onFatalError);
}

async function stopScanner() {
  if (!scannerInstance) return;
  try {
    await scannerInstance.stop();
    await scannerInstance.clear();
  } catch (err) {
    // Already stopped — fine.
  }
  scannerInstance = null;
}
