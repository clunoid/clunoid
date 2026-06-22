"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Send } from "lucide-react";

// Minimal browser SpeechRecognition typing (no `any`).
interface RecLike {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
}

/**
 * The "Ask Isaac" bar on public pages (explore, articles). Typing + sending
 * carries the request to the app (/?q=…), where the user answers it as a normal
 * user — signing in first if needed, with the request preserved (never lost).
 */
export function AskBar() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef<RecLike | null>(null);

  function go() {
    const t = text.trim();
    if (!t) return;
    router.push(`/?q=${encodeURIComponent(t.slice(0, 500))}`);
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => RecLike;
      webkitSpeechRecognition?: new () => RecLike;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return; // voice not supported here — typing still works
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.onresult = (e) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setText(s);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-base/80 backdrop-blur">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="mx-auto flex w-full max-w-5xl items-end gap-2 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 sm:gap-4 sm:px-6"
      >
        <button
          type="button"
          onClick={toggleMic}
          aria-label="Voice input"
          title="Tap to speak"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface text-ink transition hover:bg-surface-2 sm:h-14 sm:w-14"
        >
          {listening ? <Mic size={22} className="text-clay" /> : <MicOff size={22} />}
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              go();
            }
          }}
          rows={1}
          placeholder="Ask Isaac anything"
          className="max-h-[30vh] min-h-[3rem] w-full flex-1 resize-none rounded-3xl border border-border bg-surface/80 px-5 py-[0.8rem] text-ink outline-none backdrop-blur placeholder:text-ink-faint focus:border-clay sm:min-h-[3.5rem] sm:py-[0.95rem]"
        />
        <button
          type="submit"
          aria-label="Send"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface text-ink transition hover:bg-surface-2 sm:h-14 sm:w-14"
        >
          <Send size={20} />
        </button>
      </form>
    </div>
  );
}
