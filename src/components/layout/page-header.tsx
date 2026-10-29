export interface PageHeaderProps {
  eyebrow: string;
  title: string;
  /** Brand-accented second half of the headline */
  accent?: string;
  lead?: string;
}

/** Shared editorial header for public interior pages. */
export function PageHeader({ eyebrow, title, accent, lead }: PageHeaderProps) {
  return (
    <section className="border-b border-line bg-[#f7f7f3]">
      <div className="mx-auto max-w-7xl px-5 pb-12 pt-16 sm:px-6 sm:pb-16 sm:pt-20">
        <p className="flex items-center gap-2.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#426a2c]">
          <span aria-hidden="true" className="h-0.5 w-5 bg-[#8ac155]" />
          {eyebrow}
        </p>
        <h1 className="mt-4 max-w-4xl font-display text-[clamp(36px,5.5vw,64px)] font-extrabold leading-[1.08] tracking-[-0.055em] text-ink">
          {title}{" "}
          {accent && <span className="text-[#426a2c]">{accent}</span>}
        </h1>
        {lead && (
          <p className="mt-5 max-w-[650px] text-[15px] leading-[1.8] text-soft sm:text-[16px]">
            {lead}
          </p>
        )}
      </div>
    </section>
  );
}
