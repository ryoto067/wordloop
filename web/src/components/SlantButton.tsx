import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";

type Variant = "primary" | "secondary";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

const cls = (variant: Variant, extra = "") => `btn-slant slant ${variant === "secondary" ? "secondary" : ""} ${extra}`.trim();

export function SlantButton({ variant = "primary", className = "", ...rest }: Props) {
  return <button {...rest} className={cls(variant, className)} />;
}

export function SlantLink({ to, children, variant = "primary" }: { to: string; children: ReactNode; variant?: Variant }) {
  return (
    <Link to={to} className={cls(variant)}>
      {children}
    </Link>
  );
}
