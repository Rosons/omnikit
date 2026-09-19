import { useEffect, useState } from "react";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作时确认按钮显示为红色 */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let setPendingFn: ((p: Pending | null) => void) | null = null;

/** 应用内确认弹窗,替代系统原生 confirm;Promise 返回是否确认 */
export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (setPendingFn) setPendingFn({ ...opts, resolve });
    else resolve(false);
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    setPendingFn = setPending;
    return () => {
      setPendingFn = null;
    };
  }, []);

  function done(ok: boolean) {
    if (pending) {
      pending.resolve(ok);
      setPending(null);
    }
  }

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className={`modal-mask${pending ? " open" : ""}`} onClick={() => done(false)}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{pending?.title}</div>
        <div className="confirm-message">{pending?.message}</div>
        <div className="confirm-actions">
          <button className="btn btn-sm" onClick={() => done(false)}>
            {pending?.cancelLabel ?? "取消"}
          </button>
          <button
            className={`btn btn-sm ${pending?.danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => done(true)}
          >
            {pending?.confirmLabel ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
