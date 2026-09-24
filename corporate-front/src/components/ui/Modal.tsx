import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IoCloseOutline } from "react-icons/io5";

// Dialogo modal accesible (Service Desk, plan 009): foco atrapado dentro,
// Esc cierra, el foco vuelve al elemento que lo abrio y el fondo no se
// desplaza. Pantalla completa en movil.
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);

    (focusables()[1] ?? focusables()[0] ?? dialogRef.current)?.focus();

    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={`flex w-full flex-col bg-white shadow-xl sm:max-h-[90vh] sm:rounded-lg ${size === "lg" ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-slate-800">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <IoCloseOutline className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
