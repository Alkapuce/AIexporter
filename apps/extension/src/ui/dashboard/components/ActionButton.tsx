import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function ActionButton({ children, style, ...props }: ActionButtonProps) {
  const mergedStyle: CSSProperties = {
    border: "none",
    borderRadius: 999,
    padding: "8px 12px",
    background: "#111827",
    color: "#fff",
    cursor: props.disabled ? "not-allowed" : "pointer",
    fontWeight: 600,
    fontSize: 13,
    opacity: props.disabled ? 0.55 : 1,
    ...style,
  };

  return (
    <button {...props} style={mergedStyle}>
      {children}
    </button>
  );
}
