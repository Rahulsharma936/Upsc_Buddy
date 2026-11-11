"use client";

/**
 * PageChat — ask questions about the open newspaper page.
 *
 * Answers are grounded in the page, the student's notes, the syllabus and the
 * verified PYQ bank. Background that is not on the page is shown separately,
 * and an unverified "UPSC asked this in <year>" is flagged. The conversation
 * stays in this tab; nothing is saved.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ChatReply } from "@/lib/newspaper/page-chat.service";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reply?: ChatReply;
}

const SUGGESTIONS = [
  "Which items on this page matter for Prelims, and why?",
  "How could UPSC frame a Mains question from this page?",
  "How does this page connect to what I have already studied?",
];

const MAX_QUESTION = 1000;

export function PageChat(props: {
  pageNumber: number;
  messages: ChatMessage[];
  onMessages: (update: (prev: ChatMessage[]) => ChatMessage[]) => void;
  /** Page text (or a page image when it has no text layer) for the request. */
  readPage: () => Promise<{ text: string; image?: string }>;
  /** Called with text read from a page image, so later questions reuse it. */
  onPageText: (text: string) => void;
  request: { newspaper: string; editionDate: string; pageNumber: number };
}) {
  const { messages, onMessages, readPage, onPageText, request } = props;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length, pending]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setPending(true);
    setError(null);
    const history = messages.map((m) => ({
      role: m.role,
      content: m.role === "assistant" && m.reply?.beyond ? `${m.content}\n(Background: ${m.reply.beyond})` : m.content,
    }));
    onMessages((prev) => [...prev, { role: "user", content: q }]);
    setDraft("");
    try {
      const page = await readPage();
      const res = await fetch("/api/newspaper/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, text: page.text, image: page.image, question: q, history }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error?.message ?? "Could not answer that.");
      const reply = json.data as ChatReply;
      if (reply.pageText) onPageText(reply.pageText);
      onMessages((prev) => [...prev, { role: "assistant", content: reply.answer, reply }]);
    } catch (err) {
      // Take the unanswered question back out so it can be asked again.
      onMessages((prev) => (prev.length && prev[prev.length - 1].role === "user" ? prev.slice(0, -1) : prev));
      setDraft(q);
      setError(err instanceof Error ? err.message : "Could not answer that.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3" id="np-chat">
      <p className="text-[11px] text-muted-foreground">
        Answers come from page {props.pageNumber} and your notes. Background from outside the page is shown separately. This conversation is not saved.
      </p>

      <div ref={logRef} className="max-h-[60vh] space-y-4 overflow-y-auto pr-1" id="np-chat-log">
        {messages.length === 0 && !pending && (
          <div className="space-y-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="block w-full rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} data-role="user" className="ml-8 rounded-md bg-muted px-3 py-2 text-sm">
              {m.content}
            </div>
          ) : (
            <AssistantMessage key={i} message={m} />
          ),
        )}
        {pending && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the page…
          </p>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-700 dark:text-red-300" id="np-chat-error">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <textarea
          id="np-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_QUESTION))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
          rows={2}
          disabled={pending}
          placeholder="Ask about this page"
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Enter to send, Shift+Enter for a new line</span>
          <button
            type="button"
            id="np-chat-send"
            onClick={() => ask(draft)}
            disabled={pending || !draft.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const r = message.reply;
  return (
    <div data-role="assistant" className="space-y-2">
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
      {r && r.beyond && (
        <div className="rounded-md border border-dashed border-border px-3 py-2" data-part="beyond">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Background, not from this page</p>
          <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{r.beyond}</div>
        </div>
      )}
      {r && r.unverifiedYears.length > 0 && (
        <p className="text-[11px] text-amber-800 dark:text-amber-300" data-part="unverified">
          This answer mentions a past paper from {r.unverifiedYears.join(", ")} that the app could not verify. Treat that reference as unverified.
        </p>
      )}
      {r && (r.notes.length > 0 || r.syllabus.length > 0 || r.pastQuestions.length > 0 || r.partialPage) && (
        <div className="space-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
          {r.notes.length > 0 && (
            <p data-part="notes">
              From your notes: <span className="text-foreground">{r.notes.map((n) => n.name).join(", ")}</span>
            </p>
          )}
          {r.syllabus.length > 0 && (
            <p data-part="syllabus">
              Syllabus:{" "}
              <span className="text-foreground">{r.syllabus.map((s) => `${s.paper}, ${s.domain}: ${s.topic}`).join("; ")}</span>
            </p>
          )}
          {r.pastQuestions.map((q, i) => (
            <p key={i} data-part="pyq">
              Past question, {q.year} {q.stage === "mains" ? "Mains" : "Prelims"} {q.paper}: <span className="text-foreground">{q.question}</span>
            </p>
          ))}
          {r.partialPage && <p className="italic">Answered from the parts of the page most relevant to the question.</p>}
        </div>
      )}
    </div>
  );
}
