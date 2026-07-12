import React from 'react';

interface AnimatedArsLogoProps {
  className?: string;
  animate?: boolean;
}

const AnimatedArsLogo: React.FC<AnimatedArsLogoProps> = ({ className = '', animate = false }) => (
  <svg
    className={`ars-animated-logo ${animate ? 'is-animated' : 'is-pending'} ${className}`.trim()}
    viewBox="0 0 128 128"
    role="img"
    aria-label="Ars-note"
  >
    <defs>
      <linearGradient id="ars-logo-primary" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#5965d8" />
        <stop offset="1" stopColor="#6f78e8" />
      </linearGradient>
      <linearGradient id="ars-logo-secondary" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8a78ed" />
        <stop offset="1" stopColor="#7168d8" />
      </linearGradient>
    </defs>

    <path
      className="ars-logo-petal ars-logo-petal-far-left"
      d="M54 91C34 91 17 82 10 67c19-1 36 5 49 18z"
      fill="url(#ars-logo-primary)"
    />
    <path
      className="ars-logo-petal ars-logo-petal-far-right"
      d="M74 91c20 0 37-9 44-24-19-1-36 5-49 18z"
      fill="url(#ars-logo-primary)"
    />
    <path
      className="ars-logo-petal ars-logo-petal-left"
      d="M59 88C39 79 28 60 29 34c20 6 32 22 34 48z"
      fill="url(#ars-logo-secondary)"
    />
    <path
      className="ars-logo-petal ars-logo-petal-right"
      d="M69 88c20-9 31-28 30-54-20 6-32 22-34 48z"
      fill="url(#ars-logo-secondary)"
    />
    <path
      className="ars-logo-petal ars-logo-petal-base-left"
      d="M62 91c-13 17-31 22-47 13 14-10 31-14 48-14z"
      fill="url(#ars-logo-secondary)"
    />
    <path
      className="ars-logo-petal ars-logo-petal-base-right"
      d="M66 91c13 17 31 22 47 13-14-10-31-14-48-14z"
      fill="url(#ars-logo-secondary)"
    />

    <path
      className="ars-logo-a"
      d="M64 14 91 73H77L64 43 51 73H37z"
      fill="url(#ars-logo-primary)"
    />
    <path
      className="ars-logo-cursor"
      d="M64 54v39"
      fill="none"
      stroke="#6686a8"
      strokeLinecap="round"
      strokeWidth="7"
    />
    <path className="ars-logo-tip" d="m64 91 8 10-8 10-8-10z" fill="#766ce0" />
  </svg>
);

export default AnimatedArsLogo;
