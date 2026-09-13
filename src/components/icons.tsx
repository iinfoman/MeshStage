import type { SVGProps } from 'react';

/**
 * Inline 24px stroke icons. Bundled rather than fetched: an icon font or
 * sprite request on a cold mobile connection is a visible pop-in.
 */
type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const TrashIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6m3 0v13.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const SparkIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
  </svg>
);

export const UploadIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
  </svg>
);

export const TextIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

export const CameraIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.9a1 1 0 0 0 .83-.45l.94-1.4A1 1 0 0 1 10 3.7h4a1 1 0 0 1 .83.45l.94 1.4a1 1 0 0 0 .83.45h1.9A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-9Z" />
    <circle cx="12" cy="13" r="3.4" />
  </svg>
);

export const PlayIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M7 4.8v14.4a.8.8 0 0 0 1.22.68l11.3-7.2a.8.8 0 0 0 0-1.36L8.22 4.12A.8.8 0 0 0 7 4.8Z" />
  </svg>
);

export const StopIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const CheckIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4.5 12.5 9.5 17.5 19.5 7" />
  </svg>
);

export const ArrowRightIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 12h16m0 0-6-6m6 6-6 6" />
  </svg>
);

export const DownloadIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" />
    <path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2" />
  </svg>
);

export const CloudIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M7 18.5a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17.4 9.6 3.95 3.95 0 0 1 17 18.5H7Z" />
    <path d="M12 15.5v-4m0 0 2 2m-2-2-2 2" />
  </svg>
);

export const SpeakerIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 9.5h3L11.5 6v12L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
    <path d="M15 9.2a4 4 0 0 1 0 5.6M17.8 6.5a8 8 0 0 1 0 11" />
  </svg>
);

export const BoltIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M13.5 2 4 13.5h6L10.5 22 20 10.5h-6L13.5 2Z" />
  </svg>
);

export const ChevronDownIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="m6 9.5 6 6 6-6" />
  </svg>
);

export const AlertIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 8.5v4.5m0 3.2v.1" />
    <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3l-7.7-13.5a2 2 0 0 0-3.4 0Z" />
  </svg>
);

export const CubeIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 2.8 20.5 7.4v9.2L12 21.2 3.5 16.6V7.4L12 2.8Z" />
    <path d="M3.5 7.4 12 12l8.5-4.6M12 12v9.2" />
  </svg>
);

export const BoneIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="6.5" cy="6.5" r="2.6" />
    <circle cx="17.5" cy="17.5" r="2.6" />
    <path d="m8.4 8.4 7.2 7.2" />
  </svg>
);
