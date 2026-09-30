import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 sm:text-sm
          placeholder:text-zinc-400 focus:border-brand-500 focus:outline focus:outline-2
          focus:outline-brand-200 disabled:cursor-not-allowed disabled:bg-slate-100 ${className}`}
        {...rest}
      />
    );
  },
);
