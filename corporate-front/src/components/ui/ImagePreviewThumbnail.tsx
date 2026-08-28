import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Breakpoint shared with the rest of the app (see CreateProducts.tsx,
 * createBusinessPartner.tsx, CrearPersona.tsx): >=800px is "desktop".
 * Desktop gets a hover preview; below that (no reliable hover) we fall
 * back to a tap-to-fullscreen modal instead.
 */
const DESKTOP_QUERY = "(min-width: 800px)";

// Bounding box for the floating hover preview, per design spec (~150x400).
const PREVIEW_WIDTH = 200;
const PREVIEW_HEIGHT = 200;
const PREVIEW_GAP = 12; // space kept between the thumbnail and the preview
const VIEWPORT_MARGIN = 8; // never render flush against the viewport edge

interface ImagePreviewThumbnailProps {
  src: string;
  alt: string;
  /** Classes applied to the small inline thumbnail (size, border, etc). */
  className?: string;
}

/**
 * A small product thumbnail that reveals a larger preview of the same
 * image on interaction:
 *  - Desktop (>=800px): hover/focus opens a floating preview near the
 *    thumbnail, capped to ~150x400px, escaping any scrollable ancestor
 *    via a portal to <body> so it can't be clipped by the table's
 *    `overflow-x-auto` wrapper.
 *  - Mobile (<800px, no hover): tapping opens a fullscreen modal instead,
 *    closable via backdrop tap, close button, or Escape.
 */
export function ImagePreviewThumbnail({ src, alt, className = "" }: ImagePreviewThumbnailProps) {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );
  const [hoverOpen, setHoverOpen] = useState(false);
  const [hoverPosition, setHoverPosition] = useState<{ top: number; left: number } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Close the hover preview if the page scrolls or resizes under it, so it
  // never drifts away from the thumbnail it belongs to.
  useEffect(() => {
    if (!hoverOpen) return;
    const close = () => setHoverOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [hoverOpen]);

  // Modal: lock body scroll, close on Escape, move focus to the close button.
  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen]);

  const openHoverPreview = () => {
    if (!isDesktop || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();

    const opensRight = rect.right + PREVIEW_GAP + PREVIEW_WIDTH + VIEWPORT_MARGIN <= window.innerWidth;
    const left = opensRight ? rect.right + PREVIEW_GAP : rect.left - PREVIEW_GAP - PREVIEW_WIDTH;

    let top = rect.top + rect.height / 2 - PREVIEW_HEIGHT / 2;
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - PREVIEW_HEIGHT - VIEWPORT_MARGIN));

    setHoverPosition({
      top,
      left: Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - PREVIEW_WIDTH - VIEWPORT_MARGIN)),
    });
    setHoverOpen(true);
  };

  const closeHoverPreview = () => setHoverOpen(false);

  const handleClick = () => {
    if (!isDesktop) setModalOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={openHoverPreview}
        onMouseLeave={closeHoverPreview}
        onFocus={openHoverPreview}
        onBlur={closeHoverPreview}
        onClick={handleClick}
        aria-label={`Ver imagen ampliada de ${alt}`}
        className={`block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
          isDesktop ? "cursor-zoom-in" : "cursor-pointer"
        }`}
      >
        <img src={src} alt={alt} className={className} />
      </button>

      {isDesktop && hoverOpen && hoverPosition
        ? createPortal(
            <div
              role="presentation"
              className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl animate-[ui-preview-in_150ms_ease-out]"
              style={{ top: hoverPosition.top, left: hoverPosition.left, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
            >
              <img src={src} alt="" className="h-full w-full object-contain" />
            </div>,
            document.body,
          )
        : null}

      {!isDesktop && modalOpen
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onClick={() => setModalOpen(false)}
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 animate-[ui-fade-in_150ms_ease-out]"
            >
              <h2 id={titleId} className="sr-only">
                {`Imagen ampliada de ${alt}`}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Cerrar"
                className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
              <img
                src={src}
                alt={alt}
                onClick={(event) => event.stopPropagation()}
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl animate-[ui-preview-in_150ms_ease-out]"
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
