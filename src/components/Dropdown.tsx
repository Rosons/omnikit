import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  /** 触发按钮宽度 */
  width?: number;
}

/** 应用风格的自定义下拉选择;菜单用 fixed 定位,不受父容器 overflow 裁剪 */
export default function Dropdown({ value, options, onChange, width = 220 }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width });
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  function toggle() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScroll(e: Event) {
      // 菜单内部滚动不关闭,只防页面滚动导致浮层错位
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    // 菜单超出视口底部时改为向上弹出
    const menuH = Math.min(options.length * 34 + 8, 280);
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect && rect.bottom + 4 + menuH > window.innerHeight) {
      setPos({ top: rect.top - 4 - menuH, left: rect.left, width: rect.width });
    }
  }, [open, options.length]);

  return (
    <div ref={rootRef} style={{ width, flex: "none" }}>
      <button
        type="button"
        ref={btnRef}
        className="dd-btn"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="dd-label">{current?.label ?? ""}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path
            d="M2 3.5L5 6.5L8 3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="dd-menu" ref={menuRef} style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: pos.width }}>
          {options.map((o) => (
            <button
              type="button"
              className={`dd-item${o.value === value ? " sel" : ""}`}
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.value === value && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M2.5 6.2L5 8.7L9.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
