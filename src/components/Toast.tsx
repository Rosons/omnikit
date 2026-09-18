import { useEffect, useReducer } from "react";

/** 轻量全局 toast:模块级状态 + 订阅,任意组件 showToast() 即可 */
export type ToastType = "error" | "success" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  msg: string;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let seq = 1;

function emit() {
  listeners.forEach((l) => l());
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** 错误类建议手动调用方决定时长;默认 4 秒自动消失,点击可关闭 */
export function showToast(msg: string, type: ToastType = "info", duration = 4000) {
  const id = seq++;
  items = [...items, { id, type, msg }];
  emit();
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
}

export function ToastHost() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const l = () => force();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  return (
    <div className="toast-host">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          onClick={() => dismissToast(t.id)}
          title="点击关闭"
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
