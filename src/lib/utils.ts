// shadcn-style utility entry. Re-exports the project's `cn` helper so
// that components can import via `@/lib/utils` (the shadcn convention).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
