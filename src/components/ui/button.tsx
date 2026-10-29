import Link from "next/link";

export interface ButtonProps {
  variant?: "primary" | "dark" | "outline" | "ghost" | "default";
  size?: "sm" | "default" | "lg";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  href?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "btn-gold font-extrabold hover:shadow-[0_12px_26px_rgba(207,142,25,0.28)]",
  default:
    "btn-gold font-extrabold hover:shadow-[0_12px_26px_rgba(207,142,25,0.28)]",
  dark: "bg-ink text-white font-extrabold hover:bg-ink-700 shadow-[0_7px_19px_rgba(12,18,28,0.18)]",
  outline:
    "border border-line bg-white text-ink font-extrabold hover:border-gold hover:text-gold-deep",
  ghost: "text-ink font-bold hover:bg-gold-soft hover:text-gold-deep",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-9 px-3.5 text-[12px] rounded-[10px]",
  default: "h-11 px-6 text-sm rounded-[11px]",
  lg: "h-13 px-8 text-base rounded-[12px] py-3.5",
};

const baseClasses =
  "site-button inline-flex items-center justify-center gap-2.5 transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-45 disabled:pointer-events-none";

export function Button({
  variant = "primary",
  size = "default",
  className = "",
  disabled,
  type = "button",
  href,
  ariaLabel,
  children,
  style,
  onClick,
}: ButtonProps) {
  const classes = `${variantClasses[variant]} ${sizeClasses[size]} ${baseClasses} ${className}`;

  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        onClick={onClick}
        className={classes}
        style={style}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      className={classes}
      style={style}
    >
      {children}
    </button>
  );
}
