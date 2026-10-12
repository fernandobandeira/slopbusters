// Shim for T3 Code's apps/web/src/lib/utils.ts. Upstream also exports id helpers
// that depend on @t3tools/contracts and effect; only `cn` is needed here.
import { type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

// The theme's extra font sizes (style.css). Unregistered, tailwind-merge reads
// text-2xs as a colour and drops it next to text-muted-foreground.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["2xs", "3xs", "4xs", "5xs"] } } });

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}
