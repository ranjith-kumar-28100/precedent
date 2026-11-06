/** Precedent mark (docs/brand/logo-mark.svg): brackets around a P, with the bar in the accent colour. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label="Precedent" className="text-fg">
      <rect x="15" y="32" width="18" height="6" rx="1" className="fill-accent" opacity="0.9" />
      <g fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round">
        <path d="M18 6 H8 V42 H18" />
        <path d="M30 6 H40 V42 H30" />
        <path d="M19 38 V12 H27 a7 7 0 0 1 0 14 H19" />
      </g>
    </svg>
  )
}
