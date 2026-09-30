import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { IoChevronDownOutline, IoSearchOutline } from "react-icons/io5";

/*
 * Drop-in replacement for <select>: same props and <option> children, but renders
 * a searchable, alphabetically sorted combobox. A visually hidden native <select>
 * stays underneath so `e.target.value` in onChange, `required` validation, forms
 * and refs keep working exactly as before.
 */

type ParsedOption = { value: string; label: string; disabled: boolean };

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function parseOptions(children: ReactNode): ParsedOption[] {
  const result: ParsedOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: unknown; children?: ReactNode; disabled?: boolean }>(child)) return;
    if (child.type === "option") {
      const label = textOf(child.props.children);
      result.push({
        value: child.props.value === undefined ? label : String(child.props.value),
        label,
        disabled: Boolean(child.props.disabled),
      });
    } else {
      // Fragments / wrappers: walk into their children.
      result.push(...parseOptions(child.props.children));
    }
  });
  return result;
}

const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = "", children, id, disabled, value, defaultValue, "aria-label": ariaLabel, ...rest },
  ref,
) {
  const nativeRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  useImperativeHandle(ref, () => nativeRef.current as HTMLSelectElement);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number; above: boolean }>();
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    defaultValue === undefined ? undefined : String(defaultValue),
  );

  const options = useMemo(() => parseOptions(children), [children]);

  // Placeholders (value "") keep their place on top; the rest go alphabetical.
  const sortedOptions = useMemo(() => {
    const placeholders = options.filter((option) => option.value === "");
    const regular = options
      .filter((option) => option.value !== "")
      .sort((a, b) => collator.compare(a.label, b.label));
    return [...placeholders, ...regular];
  }, [options]);

  const filteredOptions = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return sortedOptions;
    return sortedOptions.filter((option) => option.value !== "" && normalize(option.label).includes(needle));
  }, [sortedOptions, query]);

  const currentValue =
    value !== undefined ? String(value) : (uncontrolledValue ?? sortedOptions[0]?.value ?? "");
  const selectedOption = options.find((option) => option.value === currentValue);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const above = spaceBelow < 240 && spaceAbove > spaceBelow;
    setPosition({
      top: above ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 192),
      maxHeight: Math.min(360, above ? spaceAbove : spaceBelow),
      above,
    });
  }, []);

  const openPopup = (initialQuery = "") => {
    if (disabled) return;
    updatePosition();
    setQuery(initialQuery);
    const selectedIdx = initialQuery ? 0 : sortedOptions.findIndex((option) => option.value === currentValue);
    setActiveIndex(Math.max(selectedIdx, 0));
    setOpen(true);
  };

  const closePopup = (restoreFocus = true) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  };

  const commit = (option: ParsedOption) => {
    if (option.disabled) return;
    closePopup();
    if (option.value === currentValue) return;
    const native = nativeRef.current;
    if (!native) return;
    // Set the value through the native setter and dispatch a real change event,
    // so React's onChange fires with a genuine ChangeEvent<HTMLSelectElement>.
    nativeValueSetter?.call(native, option.value);
    native.dispatchEvent(new Event("change", { bubbles: true }));
    if (value === undefined) setUncontrolledValue(option.value);
  };

  // Close on outside click; follow the trigger on scroll/resize.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      closePopup(false);
    };
    const onScroll = (event: Event) => {
      if (popupRef.current?.contains(event.target as Node)) return;
      updatePosition();
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const moveActive = (delta: number) => {
    if (filteredOptions.length === 0) return;
    let next = activeIndex;
    for (let i = 0; i < filteredOptions.length; i++) {
      next = (next + delta + filteredOptions.length) % filteredOptions.length;
      if (!filteredOptions[next].disabled) break;
    }
    setActiveIndex(next);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openPopup();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing on the closed control starts a search right away.
      event.preventDefault();
      openPopup(event.key);
    }
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(filteredOptions.length - 1, 0));
        break;
      case "Enter": {
        event.preventDefault();
        const option = filteredOptions[activeIndex];
        if (option) commit(option);
        break;
      }
      case "Escape":
        event.preventDefault();
        closePopup();
        break;
      case "Tab":
        closePopup(false);
        break;
    }
  };

  return (
    <div className="relative">
      <select
        ref={nativeRef}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
        onFocus={() => triggerRef.current?.focus()}
        {...rest}
      >
        {children}
      </select>

      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? closePopup() : openPopup())}
        onKeyDown={onTriggerKeyDown}
        className={`flex w-full items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-left text-base text-slate-900 sm:text-sm
          focus:border-brand-500 focus:outline focus:outline-2
          focus:outline-brand-200 disabled:cursor-not-allowed disabled:bg-slate-100 ${className}`}
      >
        <span className={`flex-1 truncate ${selectedOption?.value ? "" : "text-slate-500"}`}>
          {selectedOption?.label || " "}
        </span>
        <IoChevronDownOutline
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={popupRef}
            style={{
              position: "fixed",
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
              ...(position.above
                ? { bottom: window.innerHeight - position.top }
                : { top: position.top }),
            }}
            className="z-50 flex flex-col overflow-hidden rounded-md border border-slate-300 bg-white shadow-lg"
          >
            <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
              <IoSearchOutline className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Escriba para buscar..."
                aria-label="Buscar opción"
                aria-controls={listboxId}
                aria-activedescendant={filteredOptions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
                className="w-full bg-transparent text-base sm:text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
            <ul ref={listRef} id={listboxId} role="listbox" className="flex-1 overflow-y-auto py-1">
              {filteredOptions.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">Sin resultados</li>
              ) : (
                filteredOptions.map((option, index) => {
                  const selected = option.value === currentValue;
                  const active = index === activeIndex;
                  return (
                    <li
                      key={`${option.value}-${index}`}
                      id={`${listboxId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={option.disabled || undefined}
                      onMouseEnter={() => setActiveIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commit(option)}
                      className={`cursor-pointer truncate px-3 py-2 text-sm sm:py-1.5 ${
                        option.disabled
                          ? "cursor-not-allowed text-slate-400"
                          : active
                            ? "bg-brand-500 text-white"
                            : selected
                              ? "bg-brand-50 font-medium text-brand-800"
                              : "text-slate-900"
                      } ${option.value === "" && !active ? "text-slate-500" : ""}`}
                    >
                      {option.label || " "}
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
});
