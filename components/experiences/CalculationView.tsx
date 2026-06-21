"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Sparkles, Lightbulb } from "lucide-react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useClunoid } from "@/lib/store/useClunoid";
import type { CalculationExperience, CalcMedia } from "@/lib/brain/scene";
import { cn } from "@/lib/utils";

function Tex({ expr, display = true }: { expr: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(expr, { throwOnError: false, displayMode: display });
    } catch {
      return expr;
    }
  }, [expr, display]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * A verified, worked CALCULATION.
 *  - Top: a colored badge naming the type of calculation.
 *  - LEFT: related media + a facts / context / tips card.
 *  - RIGHT: step cards that reveal one-by-one as Isaac teaches; once a step is
 *    done it collapses into a dropdown the user can re-open. Final answer last.
 */
export function CalculationView({ data }: { data: CalculationExperience }) {
  const idx = useClunoid((s) => s.explainerIndex);
  const steps = data.steps;
  const reached = Math.min(idx, steps.length - 1);
  const done = reached >= steps.length - 1;

  // Which past (collapsed) steps the user has manually re-opened.
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const toggle = (i: number) => setOpen((o) => ({ ...o, [i]: !o[i] }));

  useEffect(() => {
    for (const m of data.media) {
      if (m.imageUrl) new Image().src = m.imageUrl;
      if (m.poster) new Image().src = m.poster;
    }
  }, [data.media]);

  return (
    <div className="flex w-full flex-col gap-5">
      {data.title && <h2 className="text-center font-serif text-xl text-ink sm:text-2xl">{data.title}</h2>}

      <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        {/* LEFT — related media + facts / context / tips */}
        <div className="flex w-full shrink-0 flex-col gap-4 lg:sticky lg:top-2 lg:w-[42%]">
          {data.media.length > 0 && <MediaStack media={data.media} />}
          {data.context && <ContextCard context={data.context} />}
        </div>

        {/* RIGHT — step cards (reveal one at a time; past ones collapse) */}
        <div className="flex w-full flex-1 flex-col gap-3">
          {steps.map((step, i) => {
            if (i > reached) return null; // not reached yet
            const isCurrent = i === reached;
            const isOpen = isCurrent || !!open[i];
            return (
              <motion.div
                key={i}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 24 }}
                className={cn(
                  "overflow-hidden rounded-2xl border bg-surface/90 backdrop-blur",
                  isCurrent ? "border-clay/60 shadow-glow" : "border-border"
                )}
              >
                <button
                  type="button"
                  onClick={() => !isCurrent && toggle(i)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span
                    className={cn(
                      "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                      isCurrent ? "bg-clay text-[#1F1E1C]" : "bg-clay/15 text-clay"
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 font-medium text-ink">{step.title || `Step ${i + 1}`}</span>
                  {!isCurrent && (
                    <ChevronDown
                      size={18}
                      className={cn("shrink-0 text-ink-faint transition-transform", isOpen && "rotate-180")}
                    />
                  )}
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pl-14">
                        <p className="text-[15px] leading-relaxed text-ink-muted">{step.text}</p>
                        {step.latex && (
                          <div className="mt-3 overflow-x-auto rounded-xl bg-base/60 p-3 text-clay-soft">
                            <Tex expr={step.latex} />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {/* Final answer */}
          <AnimatePresence>
            {done && data.finalAnswer && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 22 }}
                className="rounded-2xl border border-spark/50 bg-gradient-to-br from-spark/15 to-clay/10 p-5 text-center"
              >
                <div className="text-[11px] uppercase tracking-wide text-ink-muted">Answer</div>
                <div className="mt-1 font-serif text-xl text-ink">{data.finalAnswer}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ContextCard({ context }: { context: NonNullable<CalculationExperience["context"]> }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/90 p-5 backdrop-blur">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-spark-soft">
        <Sparkles size={15} /> Facts &amp; Context
      </div>
      {context.summary && <p className="text-[15px] leading-relaxed text-ink-muted">{context.summary}</p>}
      {context.formula && (
        <div className="mt-3 overflow-x-auto rounded-xl bg-base/60 p-3 text-clay-soft">
          <Tex expr={context.formula} />
        </div>
      )}
      {context.facts.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {context.facts.map((f, i) => (
            <li key={i} className="flex gap-2 text-sm text-ink-muted">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-clay" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
      {context.tips.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-clay-soft">
            <Lightbulb size={15} /> Tips
          </div>
          <ul className="flex flex-col gap-2">
            {context.tips.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm text-ink-muted">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-spark" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MediaStack({ media }: { media: CalcMedia[] }) {
  const [sel, setSel] = useState(0);
  const [manual, setManual] = useState(false);
  const active = media[sel] ?? media[0];

  // Auto-scroll through the media (full size) until the user picks one.
  useEffect(() => {
    if (manual || media.length < 2) return;
    const t = setInterval(() => setSel((i) => (i + 1) % media.length), 4500);
    return () => clearInterval(t);
  }, [manual, media.length]);

  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence mode="wait">
        <motion.div
          key={sel}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.4 }}
          className="grid place-items-center overflow-hidden rounded-2xl border border-clay/40 bg-surface/60 shadow-glow"
        >
          <MediaEl media={active} className="max-h-[58vh] w-full object-contain" big />
        </motion.div>
      </AnimatePresence>
      {media.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {media.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setSel(i);
                setManual(true);
              }}
              className={cn(
                "overflow-hidden rounded-lg border transition",
                i === sel ? "border-clay ring-1 ring-clay/40" : "border-border opacity-70 hover:opacity-100"
              )}
            >
              <MediaEl media={m} className="h-12 w-16 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MediaEl({ media, className, big }: { media: CalcMedia; className: string; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  const useVideo = big && !!media.videoUrl;
  const imgSrc = useVideo ? undefined : media.videoUrl ? media.poster : media.imageUrl;
  if (failed) return null;
  if (useVideo) {
    return (
      <video
        src={media.videoUrl}
        poster={media.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        onError={() => setFailed(true)}
        className={className}
      />
    );
  }
  if (!imgSrc) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imgSrc} alt="" draggable={false} onError={() => setFailed(true)} className={className} />
  );
}
