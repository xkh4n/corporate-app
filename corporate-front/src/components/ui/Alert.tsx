import type { ReactNode } from "react";

type Tone = "error" | "info" | "warning";

const TONE_CLASSES: Record<Tone, string> = {
  error: "bg-red-50 text-red-700 border-red-200",
  info: "bg-brand-50 text-brand-800 border-brand-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
};

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role="alert" className={`rounded-md border px-3 py-2 text-sm ${TONE_CLASSES[tone]}`}>
      {children}
    </div>
  );
}
