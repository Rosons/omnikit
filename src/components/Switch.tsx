interface SwitchProps {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

/** 拨杆开关(设置页等场景),替代「开/关」文字按钮 */
export default function Switch({ on, onChange, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      className={`switch${on ? " on" : ""}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      disabled={disabled}
    >
      <span className="switch-knob" />
    </button>
  );
}
