import { type CxOptions, cx } from "class-variance-authority"
import { extendTailwindMerge } from "tailwind-merge"
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["2xs", "3xs", "4xs", "5xs"] } } });
export function cn(...inputs: CxOptions) { return twMerge(cx(inputs)); }
