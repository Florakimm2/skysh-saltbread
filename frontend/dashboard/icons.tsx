import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const defaultProps = {
  fill: "none",
  viewBox: "0 0 24 24",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
  "aria-hidden": true,
};

export function SparklesIcon(props: IconProps) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M12 3.5c.7 4.1 2.4 5.8 6.5 6.5-4.1.7-5.8 2.4-6.5 6.5-.7-4.1-2.4-5.8-6.5-6.5 4.1-.7 5.8-2.4 6.5-6.5Z" />
      <path d="M5.5 16.5c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3ZM19 2v4M17 4h4" />
    </svg>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 3.5-4 3 2 5-6" />
      <path d="M15.5 7H18.5V10" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...defaultProps} {...props}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M7 3h8l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5M8 13h8M8 17h5" />
    </svg>
  );
}

export function EmptyBoxIcon(props: IconProps) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="m4 8 8-4 8 4-8 4-8-4Z" />
      <path d="m4 8 8 4 8-4v8l-8 4-8-4V8Z" />
      <path d="M12 12v8" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...defaultProps} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function GuardrailIcon(props: IconProps) {
  return (
    <svg {...defaultProps} {...props}>
      <path d="M12 3 5 6v5.5c0 4.1 2.8 7.9 7 9.5 4.2-1.6 7-5.4 7-9.5V6l-7-3Z" />
      <path d="M9 12h6M12 9v6" />
    </svg>
  );
}

export function BrandIcon(props: IconProps) {
  return (
    <svg {...defaultProps} {...props} strokeWidth={2}>
      <path d="M7 17.5c2.3-1.1 3.7-3.3 3.6-6.2 2.6 1.1 4.7.7 6.4-1.3.9 4.3-1.2 8-5.1 9.1-1.9.5-3.7 0-4.9-1.6Z" />
      <path d="M9.2 10.8c-.3-2.4.6-4.5 2.7-6.3.4 2.2 1.5 3.8 3.4 4.8" />
    </svg>
  );
}
