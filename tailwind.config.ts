import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 50-500 are TEXT ONLY in this codebase; 600-950 are surfaces and
        // borders only. That separation is what lets the text tiers be raised
        // to a bright, high-contrast set without touching a single background.
        // Every tier below clears 7:1 against the #0a1929 ground AND against
        // the .glass-card surface it sits on — the previous 400/500 were
        // 6.1:1 and 4.1:1, which is where the "text is too dim" came from.
        navy: {
          50: "#ffffff",   // headings, stat values          17.7:1
          100: "#f2f6fb",  // primary body                   16.3:1
          200: "#e4edf7",  // emphasised body                15.0:1
          300: "#dce6f2",  // secondary body                 14.1:1
          400: "#c4d4e6",  // tertiary body, table cells     11.8:1
          500: "#e8c88a",  // labels, captions, units (warm) 11.0:1
          600: "#486581",  // border only
          700: "#334e68",  // surface / border
          800: "#243b53",  // surface / border
          900: "#102a43",  // card surface
          950: "#0a1929",  // page ground
        },
        // Gold replaces the cyan accent throughout. 400 is text (links,
        // eyebrows, section numbers); 500 is a surface that carries navy-950
        // text at 7.7:1; 600 is the hover step.
        accent: {
          400: "#e8b54a",  // 9.4:1 on ground
          500: "#d9a227",  // 7.7:1 — also the active-chip background
          600: "#c08a10",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
