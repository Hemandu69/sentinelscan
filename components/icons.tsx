type Name =
  | "tower"
  | "overview"
  | "web"
  | "activity"
  | "shield"
  | "sun"
  | "moon"
  | "plus"
  | "refresh"
  | "menu"
  | "close"
  | "arrow";
const paths: Record<Name, React.ReactNode> = {
  tower: (
    <>
      <path d="M2 8 12 2l10 6M4 8h16M6 9v5h12V9M4 15h16M8 15l-3 7m11-7 3 7M8 16l9 6m-1-6-9 6M10 9v4m4-4v4" />
    </>
  ),
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  shield: <path d="m12 2 8 3v6c0 4-3 8-8 11-5-3-8-7-8-11V5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
    </>
  ),
  moon: <path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 9a8 8 0 1 0 0 7M20 3v6h-6" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  close: <path d="m5 5 14 14M19 5 5 19" />,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
};
export function Icon({ name, size = 18 }: { name: Name; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
