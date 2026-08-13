import { forwardRef, type TextareaHTMLAttributes } from "react";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = "", ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900
          placeholder:text-zinc-100 focus:border-brand-500 focus:outline focus:outline-2
          focus:outline-brand-200 disabled:cursor-not-allowed disabled:bg-slate-100 resize-y ${className}`}
        {...rest}
      />
    );
  },
);
