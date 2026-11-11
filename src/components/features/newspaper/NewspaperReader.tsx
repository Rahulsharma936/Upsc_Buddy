"use client";

/**
 * NewspaperReader — open the day's e-paper PDF, read it page by page,
 * summarise a page into Newspaper Notes, or ask questions about it.
 *
 * The PDF stays in this browser tab: pdf.js renders pages and extracts their
 * text locally. "Summarise" and "Ask" send only that page's text (or, for a
 * scanned page with no text layer, a rendered image of it, read once).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";
import { ROUTES } from "@/lib/constants/routes";
import { assemblePageText, guessEditionDate, localIsoDate, needsOcr, type PdfTextItem } from "@/lib/newspaper/page-text";
import type { PageResult } from "@/lib/newspaper/newspaper.service";
import { NewspaperNotes } from "./NewspaperNotes";
import { ArticleCard } from "./ArticleCard";
import { PageChat, type ChatMessage } from "./PageChat";
import { cn } from "@/lib/utils";

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;
type RenderTask = import("pdfjs-dist").RenderTask;

const DEFAULT_NEWSPAPER = "The Hindu";
const OCR_LONG_SIDE = 2000;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return pdfjs;
}

export function NewspaperReader() {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [fileName, setFileName] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [newspaper, setNewspaper] = useState(DEFAULT_NEWSPAPER);
  const [editionDate, setEditionDate] = useState(() => localIsoDate());
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  /** Saved summary per page key; null = checked, nothing saved; absent = not checked yet. */
  const [results, setResults] = useState<Record<string, PageResult | null>>({});
  const [analysing, setAnalysing] = useState(false);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [notesKey, setNotesKey] = useState(0);
  const [panel, setPanel] = useState<"summary" | "chat">("summary");
  /** Conversation per page key; kept while the tab is open, never saved. */
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  /** Text read from page images (scanned pages), per page of the open PDF. */
  const ocrText = useRef(new Map<number, string>());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(new Set<string>());

  const trimmedName = newspaper.trim();
  const pageKey = `${trimmedName}|${editionDate}|${pageNumber}`;
  const result = results[pageKey] ?? null;
  const checking = !!doc && !(pageKey in results);
  const analyseError = failure?.key === pageKey ? failure.message : null;

  // ── Open a PDF ──────────────────────────────────────────
  const openFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setOpenError(null);
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setOpenError("Choose a PDF file.");
      return;
    }
    setOpening(true);
    try {
      const pdfjs = await loadPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      const loaded = await pdfjs.getDocument({ data }).promise;
      setDoc((prev) => {
        prev?.destroy();
        return loaded;
      });
      ocrText.current.clear();
      setFileName(file.name);
      setPageNumber(1);
      const guessed = guessEditionDate(file.name);
      if (guessed) setEditionDate(guessed);
    } catch {
      setOpenError("Could not open this PDF. It may be damaged or password-protected.");
    } finally {
      setOpening(false);
    }
  }, []);

  // ── Render the current page ─────────────────────────────
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const canvas = canvasRef.current;
      const frame = frameRef.current;
      if (!canvas || !frame) return;
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(320, frame.clientWidth - 2);
      const scale = width / base.width;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTaskRef.current?.cancel();
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [doc, pageNumber]);

  // ── Show the saved summary if this page was done before ──
  useEffect(() => {
    if (!doc || !trimmedName || !editionDate || pageKey in results || inFlight.current.has(pageKey)) return;
    const key = pageKey;
    inFlight.current.add(key);
    const qs = new URLSearchParams({
      newspaper: trimmedName,
      editionDate,
      page: String(pageNumber),
    });
    fetch(`/api/newspaper/notes?${qs}`)
      .then((r) => r.json())
      .then((json) =>
        setResults((prev) => ({
          ...prev,
          [key]: json?.success && json.data ? json.data : null,
        })),
      )
      .catch(() => setResults((prev) => ({ ...prev, [key]: null })))
      .finally(() => inFlight.current.delete(key));
  }, [doc, pageKey, results, trimmedName, editionDate, pageNumber]);

  // ── Summarise ───────────────────────────────────────────
  const pageImage = useCallback(async (): Promise<string> => {
    if (!doc) throw new Error("No PDF open.");
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: OCR_LONG_SIDE / Math.max(base.width, base.height),
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not render this page.");
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  }, [doc, pageNumber]);

  /** The current page's text, or its image when it has no text layer and has not been read yet. */
  const readPage = useCallback(async (): Promise<{
    text: string;
    image?: string;
  }> => {
    if (!doc) throw new Error("No PDF open.");
    const cached = ocrText.current.get(pageNumber);
    if (cached) return { text: cached };
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = assemblePageText(content.items as PdfTextItem[]);
    return needsOcr(text) ? { text, image: await pageImage() } : { text };
  }, [doc, pageNumber, pageImage]);

  const summarise = useCallback(async () => {
    if (!doc || analysing) return;
    const key = pageKey;
    setAnalysing(true);
    setFailure(null);
    try {
      const { text, image } = await readPage();
      const res = await fetch("/api/newspaper/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newspaper: trimmedName,
          editionDate,
          readDate: localIsoDate(),
          pageNumber,
          text,
          image,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setFailure({
          key,
          message: json?.error?.message ?? "Could not summarise this page.",
        });
        return;
      }
      setResults((prev) => ({ ...prev, [key]: json.data }));
      setNotesKey((k) => k + 1);
    } catch (err) {
      setFailure({
        key,
        message: err instanceof Error ? err.message : "Could not summarise this page.",
      });
    } finally {
      setAnalysing(false);
    }
  }, [doc, analysing, pageKey, pageNumber, readPage, trimmedName, editionDate]);

  const setPageChat = useCallback(
    (update: (prev: ChatMessage[]) => ChatMessage[]) => {
      const key = pageKey;
      setChats((prev) => ({ ...prev, [key]: update(prev[key] ?? []) }));
    },
    [pageKey],
  );
  const rememberPageText = useCallback(
    (text: string) => {
      ocrText.current.set(pageNumber, text);
    },
    [pageNumber],
  );

  const numPages = doc?.numPages ?? 0;

  return (
    <div className="space-y-8">
      {/* Edition controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1">
          <label htmlFor="np-name" className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Newspaper
          </label>
          <input
            id="np-name"
            value={newspaper}
            onChange={(e) => setNewspaper(e.target.value)}
            disabled={analysing}
            className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="np-date" className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Edition date
          </label>
          <input
            id="np-date"
            type="date"
            value={editionDate}
            onChange={(e) => setEditionDate(e.target.value)}
            disabled={analysing}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            id="np-file"
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              openFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            id="np-open"
            onClick={() => fileRef.current?.click()}
            disabled={opening || analysing}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {doc ? "Open another PDF" : "Open e-paper PDF"}
          </button>
          {fileName && (
            <span className="max-w-[16rem] truncate text-xs text-muted-foreground" title={fileName}>
              {fileName}
            </span>
          )}
        </div>
        <p className="w-full text-[11px] text-muted-foreground">
          The PDF is read in this browser and is not uploaded. Only the text of a page you summarise or ask about is sent for analysis.
        </p>
        {openError && <p className="w-full text-xs text-red-700 dark:text-red-300">{openError}</p>}
      </div>

      {doc && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Page viewer */}
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                id="np-prev"
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                disabled={pageNumber <= 1 || analysing}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              <span className="text-xs text-muted-foreground" id="np-page-label">
                Page {pageNumber} of {numPages}
              </span>
              <button
                type="button"
                id="np-next"
                onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                disabled={pageNumber >= numPages || analysing}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div ref={frameRef} className="max-h-[78vh] overflow-auto rounded-md border border-border bg-white">
              <canvas ref={canvasRef} className="block" aria-label={`Page ${pageNumber}`} />
            </div>
          </div>

          {/* Summary / chat panel */}
          <div className="min-w-0 space-y-4">
            <div className="flex gap-1 border-b border-border" role="tablist">
              {(["summary", "chat"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  id={`np-tab-${p}`}
                  aria-selected={panel === p}
                  onClick={() => setPanel(p)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-xs font-medium",
                    panel === p ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p === "summary" ? `Page ${pageNumber}: UPSC summary` : "Ask about this page"}
                </button>
              ))}
            </div>

            {panel === "chat" && (
              <PageChat
                key={pageKey}
                pageNumber={pageNumber}
                messages={chats[pageKey] ?? []}
                onMessages={setPageChat}
                readPage={readPage}
                onPageText={rememberPageText}
                request={{ newspaper: trimmedName, editionDate, pageNumber }}
              />
            )}

            {panel === "summary" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
                  <p className="text-[11px] text-muted-foreground">
                    Only articles with exam value are kept. Each becomes a note with Prelims and Mains questions, scheduled for revision.
                  </p>
                  {!result && (
                    <button
                      type="button"
                      id="np-summarise"
                      onClick={summarise}
                      disabled={analysing || checking}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                    >
                      {analysing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading page…
                        </>
                      ) : (
                        "Summarise this page"
                      )}
                    </button>
                  )}
                </div>

                {analysing && (
                  <p className="text-xs text-muted-foreground">
                    Filtering articles, writing notes and checking every answer key. A full page usually takes one to two minutes.
                  </p>
                )}
                {analyseError && (
                  <p className="text-xs text-red-700 dark:text-red-300" id="np-error">
                    {analyseError}
                  </p>
                )}

                {result && <PageSummary result={result} />}
              </>
            )}
          </div>
        </div>
      )}

      <NewspaperNotes refreshKey={notesKey} />
    </div>
  );
}

function PageSummary({ result }: { result: PageResult }) {
  const questions = result.articles.reduce((n, a) => n + a.prelimsCount + (a.mainsQuestion ? 1 : 0), 0);
  const count = result.articles.length;
  return (
    <div className="space-y-4" id="np-result">
      <p className="text-xs text-muted-foreground">
        {count === 0
          ? "Nothing on this page has UPSC value."
          : `${count} article${count === 1 ? "" : "s"} saved to Newspaper Notes with ${questions} question${questions === 1 ? "" : "s"}.`}
        {result.cached && " Summarised earlier."}
        {count > 0 && (
          <>
            {" "}
            <Link href={`${ROUTES.PRACTICE}?scope=current`} className="font-medium text-foreground underline-offset-2 hover:underline">
              Practise current affairs
            </Link>
          </>
        )}
      </p>
      {result.articles.map((a) => (
        <ArticleCard key={a.conceptId} article={a} />
      ))}
      {result.skipped.length > 0 && (
        <details className="rounded-md border border-border p-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Skipped as not relevant ({result.skipped.length})</summary>
          <ul className="mt-2 space-y-1">
            {result.skipped.map((s, i) => (
              <li key={i} className="text-muted-foreground">
                <span className="text-foreground">{s.headline}</span>
                {s.reason && <>: {s.reason}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
