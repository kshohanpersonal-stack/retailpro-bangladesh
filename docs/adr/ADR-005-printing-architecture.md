# ADR-005 — Printing & PDF Architecture
**Status:** Accepted (2026-11-03)
**Decision:** PDF export via pdf-lib + HarfBuzz (harfbuzzjs) shaping with embedded Hind Siliguri (Bengali conjuncts verified visually in sandbox). Thermal receipts via Chromium print pipeline (Electron webContents.print / printToPDF) with 58mm/80mm CSS page sizes — rasterized output is Bengali-safe on Windows GDI printers. Barcode labels via JsBarcode/qrcode SVG through the same print path.
**Alternatives:** ESC/POS text mode (built-in printer codepages cannot render Bengali reliably — rejected as primary); pdfkit alone (complex-script shaping risk); server-side headless Chromium (heavier, unnecessary in Electron).
**Consequences:** Pure-Node PDF engine works identically in tests and production; physical printer verification remains pending until hardware is available (documented).
