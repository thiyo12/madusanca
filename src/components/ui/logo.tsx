import Image from "next/image";
import Link from "next/link";

export interface LogoProps {
  href?: string;
  compact?: boolean;
  className?: string;
}

export function Logo({ href = "/", compact = false, className = "" }: LogoProps) {
  return (
    <Link
      href={href}
      aria-label="Wisdom Driving Academy — home"
      className={`inline-flex shrink-0 items-center ${className}`}
    >
      <Image
        src="/wisdom-logo.png"
        alt="Wisdom Driving Academy"
        width={938}
        height={608}
        sizes="(max-width: 640px) 112px, 150px"
        className={compact ? "h-auto w-[66px]" : "h-auto w-[112px] sm:w-[140px] xl:w-[150px]"}
      />
    </Link>
  );
}
