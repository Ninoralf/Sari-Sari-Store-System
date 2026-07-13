(() => {
  class BarcodeScanner {
    constructor(options = {}) {
      this.modalElement = document.getElementById(options.modalId || "barcodeScannerModal");
      if (!this.modalElement || !window.bootstrap?.Modal) {
        this.ready = false;
        return;
      }

      this.titleElement = this.modalElement.querySelector("[data-barcode-scanner-title]");
      this.statusElement = this.modalElement.querySelector("[data-barcode-scanner-status]");
      this.cameraSelect = this.modalElement.querySelector("[data-barcode-camera-select]");
      this.viewfinder = this.modalElement.querySelector("[data-barcode-viewfinder]");
      if (!this.statusElement || !this.cameraSelect || !this.viewfinder) {
        this.ready = false;
        return;
      }

      this.ready = true;
      this.modal = window.bootstrap.Modal.getOrCreateInstance(this.modalElement);
      this.html5Qrcode = null;
      this.cameras = [];
      this.isStarting = false;
      this.isScanning = false;
      this.onScan = null;
      this.notRecognizedTimer = null;
      this.viewfinderId = this.viewfinder.id || `${this.modalElement.id}Viewfinder`;
      this.viewfinder.id = this.viewfinderId;

      this.handleShown = () => this.start();
      this.handleHidden = () => this.stop();
      this.handleCameraChange = () => this.restart();
      this.handlePageExit = () => this.stop();

      this.modalElement.addEventListener("shown.bs.modal", this.handleShown);
      this.modalElement.addEventListener("hidden.bs.modal", this.handleHidden);
      this.cameraSelect.addEventListener("change", this.handleCameraChange);
      window.addEventListener("pagehide", this.handlePageExit);
      window.addEventListener("beforeunload", this.handlePageExit);
    }

    open(options = {}) {
      if (!this.ready) return;
      this.onScan = typeof options.onScan === "function" ? options.onScan : null;
      if (this.titleElement) this.titleElement.textContent = options.title || "Scan Barcode";
      this.clearStatus();
      this.modal.show();
    }

    async start() {
      if (!this.ready || this.isStarting || this.isScanning) return;
      this.isStarting = true;
      this.clearStatus();
      this.setStatus("Point the camera at the barcode.", "info");

      try {
        if (!window.Html5Qrcode || !window.Html5QrcodeSupportedFormats) {
          throw new Error("Barcode scanner library did not load.");
        }
        if (!this.hasSecureCameraContext()) {
          throw new Error("Camera access requires HTTPS or localhost.");
        }

        await this.stop();
        await this.loadCameras();
        if (!this.cameras.length) throw new Error("No camera available");

        const cameraId = this.cameraSelect.value || this.pickDefaultCamera()?.id;
        if (!cameraId) throw new Error("No camera available");

        this.html5Qrcode = new window.Html5Qrcode(this.viewfinderId);
        await this.html5Qrcode.start(
          cameraId,
          {
            fps: 12,
            qrbox: this.calculateScanBox,
            formatsToSupport: this.supportedFormats()
          },
          (decodedText) => this.handleSuccess(decodedText),
          () => this.handleScanMiss()
        );
        this.isScanning = true;
        this.setStatus("Scanning...", "info");
      } catch (error) {
        this.setFriendlyError(error);
      } finally {
        this.isStarting = false;
      }
    }

    async restart() {
      if (!this.ready || !this.modalElement.classList.contains("show")) return;
      await this.stop();
      await this.start();
    }

    async stop() {
      window.clearTimeout(this.notRecognizedTimer);
      this.notRecognizedTimer = null;
      if (!this.html5Qrcode) {
        this.isScanning = false;
        return;
      }

      const scanner = this.html5Qrcode;
      this.html5Qrcode = null;
      this.isScanning = false;

      try {
        const state = scanner.getState?.();
        const scannerState = window.Html5QrcodeScannerState;
        if (!scannerState || state === scannerState.SCANNING || state === scannerState.PAUSED) {
          await scanner.stop();
        }
      } catch (error) {
        console.warn("Unable to stop barcode scanner.", error);
      }

      try {
        await scanner.clear();
      } catch (error) {
        console.warn("Unable to clear barcode scanner.", error);
      }
    }

    async loadCameras() {
      this.cameras = await window.Html5Qrcode.getCameras();
      this.renderCameraOptions();
    }

    renderCameraOptions() {
      this.cameraSelect.innerHTML = "";
      const defaultCamera = this.pickDefaultCamera();

      this.cameras.forEach((camera, index) => {
        const option = document.createElement("option");
        option.value = camera.id;
        option.textContent = camera.label || `Camera ${index + 1}`;
        option.selected = camera.id === defaultCamera?.id;
        this.cameraSelect.appendChild(option);
      });

      this.cameraSelect.disabled = this.cameras.length <= 1;
    }

    pickDefaultCamera() {
      return this.cameras.find((camera) => /back|rear|environment/i.test(camera.label || "")) || this.cameras[0] || null;
    }

    supportedFormats() {
      const formats = window.Html5QrcodeSupportedFormats;
      return [
        formats.EAN_13,
        formats.EAN_8,
        formats.UPC_A,
        formats.UPC_E,
        formats.CODE_128,
        formats.CODE_39,
        formats.CODE_93,
        formats.CODABAR,
        formats.ITF,
        formats.QR_CODE
      ].filter((format) => typeof format !== "undefined");
    }

    calculateScanBox(width, height) {
      return {
        width: Math.floor(Math.min(width * 0.86, 420)),
        height: Math.floor(Math.min(height * 0.42, 180))
      };
    }

    async handleSuccess(decodedText) {
      const barcode = String(decodedText || "").trim();
      if (!barcode) return;

      await this.stop();
      if (this.onScan) this.onScan(barcode);
      this.modal.hide();
    }

    handleScanMiss() {
      if (this.notRecognizedTimer) return;
      this.notRecognizedTimer = window.setTimeout(() => {
        this.setStatus("Barcode not recognized yet. Hold it steady inside the frame.", "warning");
        this.notRecognizedTimer = null;
      }, 3500);
    }

    hasSecureCameraContext() {
      const hostname = window.location.hostname;
      return window.isSecureContext || hostname === "localhost" || hostname === "127.0.0.1";
    }

    setStatus(message, type) {
      this.statusElement.hidden = false;
      this.statusElement.className = `barcode-scanner-status alert alert-${type} py-2 small mb-3`;
      this.statusElement.textContent = message;
    }

    clearStatus() {
      this.statusElement.hidden = true;
      this.statusElement.textContent = "";
    }

    setFriendlyError(error) {
      const text = String(error?.message || error || "");
      if (/notallowed|permission/i.test(text)) {
        this.setStatus("Camera permission denied. Allow camera access and try again.", "warning");
      } else if (/notfound|no camera|requested device not found/i.test(text)) {
        this.setStatus("No camera available on this device.", "danger");
      } else if (/notreadable|trackstarterror|busy/i.test(text)) {
        this.setStatus("Camera is busy. Close other apps or tabs using it, then try again.", "warning");
      } else if (/https|secure|localhost/i.test(text)) {
        this.setStatus("Camera access needs HTTPS or localhost.", "warning");
      } else if (/library/i.test(text)) {
        this.setStatus("Barcode scanner could not load. Check your connection and refresh.", "danger");
      } else {
        this.setStatus("Could not start the camera. Try again or enter the barcode manually.", "danger");
      }
    }
  }

  window.BarcodeScanner = BarcodeScanner;
})();
