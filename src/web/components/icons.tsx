import type { SVGProps } from 'react';

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = () => (
  <Icon>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </Icon>
);

export const CrossIcon = () => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const SpinnerIcon = () => (
  <Icon className="spin">
    <path d="M8 2a6 6 0 1 0 6 6" />
  </Icon>
);

export const SendIcon = () => (
  <Icon>
    <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
  </Icon>
);

export const StopIcon = () => (
  <Icon fill="currentColor">
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
  </Icon>
);

export const ImageIcon = () => (
  <Icon>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="6" cy="7" r="1.2" />
    <path d="M2.5 12l3.5-3 3 2.5 2-1.5 2.5 2" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M5 3.5v9l7-4.5-7-4.5z" fill="currentColor" />
  </Icon>
);

export const DownloadIcon = () => (
  <Icon>
    <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />
  </Icon>
);

export const PrintIcon = () => (
  <Icon>
    <path d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Icon>
);
