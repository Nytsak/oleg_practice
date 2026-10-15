import React from "react";
const paths = {
  mountain: "m3 18 7-12 5 8 3-5 5 9H3 M8 10l2-4 3 5",
  routes:
    "M6 6a2 2 0 1 0 0 .01M18 18a2 2 0 1 0 0 .01M8 6h8a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h8",
  map: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5 M9 3v16M15 5v16",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-2a8 8 0 0 1 16 0v2",
  plus: "M12 5v14M5 12h14",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  arrow: "M5 12h14M14 7l5 5-5 5",
  close: "m6 6 12 12M6 18 18 6",
  edit: "m4 16-1 5 5-1L21 7l-4-4L4 16 M14 6l4 4",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15 M10 10v7M14 10v7",
  sync: "M20 7a9 9 0 0 0-15-2L2 8 M2 3v5h5 M4 17a9 9 0 0 0 15 2l3-3 M22 21v-5h-5",
  check: "m5 12 4 4L19 6",
  share:
    "M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M9 10l6-3M9 14l6 3",
  play: "m7 4 14 8-14 8V4",
  pause: "M8 5v14M16 5v14",
  location: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v4M12 18v4M2 12h4M18 12h4",
  logout: "M9 3H3v18h6 M8 12h13M16 7l5 5-5 5",
  wifi: "M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0M12 20h.01",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2",
  menu: "M3 6h18M3 12h18M3 18h18",
  up: "m7 14 5-5 5 5",
  down: "m7 10 5 5 5-5",
};
export default function Icon({ name, size = 20, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.pin} />
    </svg>
  );
}
