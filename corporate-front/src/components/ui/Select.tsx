import { forwardRef, type SelectHTMLAttributes } from "react";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className = "", children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900
        focus:border-brand-500 focus:outline focus:outline-2
        focus:outline-brand-200 disabled:cursor-not-allowed disabled:bg-slate-100 ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
});