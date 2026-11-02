import { useId, type SVGProps } from 'react';

/** Mascot that inherits the surrounding icon color; static unless blinking is enabled. */
export function HypequeryMascotIcon({ blink = false, ...props }: SVGProps<SVGSVGElement> & { blink?: boolean }) {
  const faceId = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 36"
      fill="currentColor"
      aria-hidden={props['aria-label'] ? undefined : true}
      role={props['aria-label'] ? 'img' : undefined}
      {...props}
    >
      <defs>
        <mask id={faceId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="36" style={{ maskType: 'luminance' }}>
          <rect width="32" height="36" fill="white" />
          <g fill="black" className={blink ? 'mascot-blinking-eyes' : undefined}>
            <rect x="14" y="20.5" width="3.5" height="5" rx="1.75" />
            <rect x="23" y="20.5" width="3.5" height="5" rx="1.75" />
          </g>
        </mask>
      </defs>
      <path mask={`url(#${faceId})`} d="M5 17H11V13A3 3 0 0 1 14 10H21V6A3 3 0 0 1 24 3H27A3 3 0 0 1 30 6V30A3 3 0 0 1 27 33H5A3 3 0 0 1 2 30V20A3 3 0 0 1 5 17Z" />
    </svg>
  );
}
