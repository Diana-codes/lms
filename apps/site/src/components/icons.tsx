import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconLoan = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 9.5v5M18 9.5v5" />
  </svg>
);

export const IconAdvisory = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    <path d="m16 8 3-3 2 2" />
  </svg>
);

export const IconFunds = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5H12z" />
    <path d="M15 2.9A9.5 9.5 0 0 1 21.1 9H15z" />
  </svg>
);

export const IconInvoice = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M6 2.5h9l4 4v15H6z" />
    <path d="M15 2.5v4h4M9 11h7M9 15h7M9 19h4" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const IconArrowRight = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const IconArrowUpRight = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

export const IconSprout = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 21v-9" />
    <path d="M12 12c0-4 3-7 8-7 0 4.5-3 7-8 7z" />
    <path d="M12 14c0-3.5-2.5-6-7-6 0 3.8 2.6 6 7 6z" />
  </svg>
);

export const IconBell = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </svg>
);

export const IconMenu = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconClose = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconEye = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconPhone = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </svg>
);

export const IconTrack = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
    <path d="M7 12h3M14 12h3" />
  </svg>
);

export const IconWallet = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3" />
    <rect x="3" y="7.5" width="18" height="12" rx="2.5" />
    <path d="M16.5 13.5h1" />
  </svg>
);

export const IconLanguage = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 5.5 6 7M11 5c-.5 3-2.5 5.5-6 7" />
    <path d="m13 21 4-9 4 9M14.5 18h5" />
  </svg>
);

export const IconShield = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </svg>
);

export const IconMapPin = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 21.5s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

export const IconMail = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="m3 6 9 7 9-7" />
  </svg>
);

export const IconClock = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 7v5l3 2" />
  </svg>
);
