"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useClunoid } from "@/lib/store/useClunoid";
import type { FlagQuizExperience } from "@/lib/brain/scene";
import { cn } from "@/lib/utils";

/**
 * Shows a flag. The user names the country by voice (hands-free) or typing —
 * both go through submitGuess, which autocorrects mis-hears, reveals the result
 * (what you said + right/wrong + the country), then Isaac reacts and continues.
 */
export function FlagQuiz({ data }: { data: FlagQuizExperience }) {
  const submitGuess = useClunoid((s) => s.submitGuess);
  const next = useClunoid((s) => s.next);
  const feedback = useClunoid((s) => s.guessFeedback);
  const [guess, setGuess] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = guess.trim();
    if (!t) return;
    setGuess("");
    submitGuess(t);
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5">
      <div className="flex items-center gap-3 text-sm text-ink-muted">
        <span>Round {data.round}</span>
        <span className="h-1 w-1 rounded-full bg-ink-faint" />
        <span>Score {data.score}</span>
      </div>

      <motion.div
        layout
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.flagUrl}
          alt="Flag to identify"
          className="h-44 w-72 object-cover sm:h-56 sm:w-[22rem]"
          draggable={false}
        />
      </motion.div>

      {feedback ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-1 text-center"
        >
          <span className="text-sm text-ink-muted">You said “{feedback.said}”</span>
          <span
            className={cn(
              "font-medium",
              feedback.correct ? "text-ok" : "text-bad"
            )}
          >
            {feedback.correct ? "Correct!" : "Not quite —"} it&apos;s{" "}
            <span className="font-serif text-ink">{feedback.answer}</span>
          </span>
        </motion.div>
      ) : (
        <>
          <form className="flex w-full gap-2" onSubmit={submit}>
            <input
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder="Say it out loud, or type it…"
              autoFocus
              className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-ink outline-none placeholder:text-ink-faint focus:border-clay"
            />
            <button
              type="submit"
              className="rounded-xl bg-clay px-5 py-3 font-medium text-[#1F1E1C] transition hover:bg-clay-soft"
            >
              Guess
            </button>
          </form>
          <button onClick={() => next()} className="text-xs text-ink-faint hover:text-ink">
            Skip this one →
          </button>
        </>
      )}
    </div>
  );
}
