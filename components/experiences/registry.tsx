"use client";

import type { Experience } from "@/lib/brain/scene";
import { FlagQuiz } from "./FlagQuiz";
import { StepByStepMath } from "./StepByStepMath";
import { RichCard } from "./RichCard";
import { Explainer } from "./Explainer";

/**
 * Maps a validated Experience to its React component. Adding a new experience
 * to Clunoid means: add it to the Scene schema + register it here. Nothing
 * else in the pipeline changes.
 */
export function renderExperience(exp: Experience) {
  switch (exp.type) {
    case "flag_quiz":
      return <FlagQuiz data={exp} />;
    case "math_steps":
      return <StepByStepMath data={exp} />;
    case "rich_card":
      return <RichCard data={exp} />;
    case "explainer":
      return <Explainer data={exp} />;
    default:
      return null;
  }
}
