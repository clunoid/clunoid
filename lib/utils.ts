import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Save a media URL to the user's device. Tries a real download via blob; if the
 * host blocks cross-origin fetch (CORS), falls back to opening it in a new tab
 * so the user can still save it manually.
 */
export async function downloadMedia(url: string): Promise<void> {
  const name = (url.split("/").pop()?.split("?")[0] || "clunoid-media").replace(/[^\w.\-]/g, "_");
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 5000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
