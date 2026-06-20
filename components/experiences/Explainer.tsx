"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useClunoid } from "@/lib/store/useClunoid";
import type { ExplainerExperience, ExplainerEntity } from "@/lib/brain/scene";

/**
 * Synced visual narration, full-screen two-column on wide screens:
 *  - LEFT: the current beat's media — a VIDEO clip or full-size image
 *    (uncropped), with earlier ones shrunk into a timeline (hover to enlarge).
 *  - RIGHT: the info card with the full explanation, current beat highlighted.
 * Media-only on the left (no labels/initials). All media is preloaded so there's
 * no delay once Isaac starts.
 */
export function Explainer({ data }: { data: ExplainerExperience }) {
  const idx = useClunoid((s) => s.explainerIndex);
  const beats = data.beats;

  // Preload every beat's media up front → smooth, delay-free playback.
  useEffect(() => {
    for (const b of beats) {
      const e = b.entity;
      if (!e) continue;
      if (e.imageUrl) new Image().src = e.imageUrl;
      if (e.poster) new Image().src = e.poster;
    }
  }, [beats]);

  const shown: ExplainerEntity[] = [];
  for (let i = 0; i <= idx && i < beats.length; i++) {
    if (beats[i].entity) shown.push(beats[i].entity as ExplainerEntity);
  }
  const current = shown[shown.length - 1];
  const past = shown.slice(0, -1);

  return (
    <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
      {/* LEFT — synced media */}
      <div className="flex w-full shrink-0 flex-col items-center gap-4 lg:sticky lg:top-2 lg:w-[44%]">
        <AnimatePresence mode="popLayout">
          {current && (
            <motion.div
              key={(current.videoUrl || current.imageUrl || current.name) + idx}
              initial={{ opacity: 0, scale: 0.92, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -10 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
              className="overflow-hidden rounded-2xl border border-clay/40 bg-surface/60 shadow-glow"
            >
              <Media entity={current} className="max-h-[52vh] w-auto max-w-full object-contain" big />
            </motion.div>
          )}
        </AnimatePresence>

        {past.length > 0 && (
          <LayoutGroup>
            <div className="flex flex-wrap justify-center gap-2">
              {past.map((e, i) => (
                <Thumb key={`${e.name}-${i}`} entity={e} />
              ))}
            </div>
          </LayoutGroup>
        )}
      </div>

      {/* RIGHT — the info card with the full explanation */}
      <motion.div layout className="w-full flex-1 rounded-2xl border border-border bg-surface/90 p-6 backdrop-blur sm:p-7">
        {data.title && <h2 className="mb-4 font-serif text-2xl text-ink sm:text-3xl">{data.title}</h2>}
        <div className="flex flex-col gap-3 text-[15px] leading-relaxed sm:text-base">
          {beats.map((b, i) => (
            <p
              key={i}
              className="transition-colors duration-300"
              style={{ color: i === idx ? "var(--ink,#F4F2EC)" : i < idx ? "rgba(244,242,236,0.65)" : "rgba(244,242,236,0.4)" }}
            >
              {b.say}
            </p>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function Thumb({ entity }: { entity: ExplainerEntity }) {
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="group relative">
      <div className="overflow-hidden rounded-xl border border-border bg-surface/60">
        <Media entity={entity} className="h-14 w-20 object-contain" />
      </div>
      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft group-hover:block">
        <Media entity={entity} className="max-h-48 w-full object-contain" />
      </div>
    </motion.div>
  );
}

/**
 * Renders the entity's video (preferred) or image, full size and uncropped.
 * If a media URL fails to load, it's hidden — never replaced with initials.
 */
function Media({ entity, className, big }: { entity: ExplainerEntity; className: string; big?: boolean }) {
  const [failed, setFailed] = useState(false);

  // In the timeline (small) we show the poster/image, not an autoplaying video.
  const useVideo = big && !!entity.videoUrl;
  const imgSrc = useVideo ? undefined : entity.videoUrl ? entity.poster : entity.imageUrl;

  if (failed) return null;

  if (useVideo) {
    return (
      <video
        src={entity.videoUrl}
        poster={entity.poster}
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
