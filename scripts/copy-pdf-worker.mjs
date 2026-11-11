// Copies the pdf.js worker into /public so the newspaper reader can load it
// from the app's own origin (runs on postinstall).
import { copyFileSync, mkdirSync, existsSync } from "node:fs";

const src = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
if (existsSync(src)) {
  mkdirSync("public/pdfjs", { recursive: true });
  copyFileSync(src, "public/pdfjs/pdf.worker.min.mjs");
}
