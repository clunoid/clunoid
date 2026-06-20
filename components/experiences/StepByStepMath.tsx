"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { MathStepsExperience } from "@/lib/brain/scene";

function Tex({ expr }: { expr: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(expr, {
        throwOnError: false,
        displayMode: true,
      });
    } catch {
      return expr;
    }
  }, [expr]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Renders a worked solution. Steps fill the available width (many side-by-side
 * on large screens, stacked on phones) and reveal in sequence. */
export function StepByStepMath({ data }: { data: MathStepsExperience }) {
  // Single-step answers shouldn't pretend to be a multi-step grid.
  const single = data.steps.length === 1;
  return (
    <div className="flex w-full max-w-6xl flex-col gap-4">
      {data.title && (
        <h2 className="text-center font-serif text-2xl text-ink">{data.title}</h2>
      )}

      <ol
        className="grid gap-3"
        style={{
          gridTemplateColumns: single
            ? "minmax(0, 32rem)"
            : "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))",
          justifyContent: "center",
        }}
      >
        {data.steps.map((step, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.4, duration: 0.4 }}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-clay">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-clay/15">
                {i + 1}
              </span>
              Step {i + 1}
            </div>
            <p className="text-ink">{step.text}</p>
            {step.latex && (
              <div className="mt-2 overflow-x-auto text-clay-soft">
                <Tex expr={step.latex} />
              </div>
            )}
          </motion.li>
        ))}
      </ol>

      {data.finalAnswer && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: data.steps.length * 0.45 + 0.2 }}
          className="rounded-xl border border-clay/40 bg-clay/10 p-4 text-center"
        >
          <div className="text-xs uppercase tracking-wide text-ink-muted">Answer</div>
          <div className="mt-1 font-serif text-lg text-ink">{data.finalAnswer}</div>
        </motion.div>
      )}
    </div>
  );
}
