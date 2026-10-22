import type { Config } from "tailwindcss";

// REGAIN design tokens — light, calm surfaces; deep plum as a restrained brand accent;
// crimson only for risk or negative results; green only for positive outcomes.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F7F6F8", // page background
        shell: "#FFFFFF", // sidebar
        surface: { DEFAULT: "#FFFFFF", 2: "#FAF8FB", 3: "#F3EDF5" }, // card · hover · subtle fill
        line: { DEFAULT: "#E5DFE8", strong: "#D5CCD9" },
        ink: {
          DEFAULT: "#211A25", // primary text (17:1 on white)
          soft: "#3F3545", // body copy (11.6:1)
          muted: "#716778", // secondary text (5.4:1)
          faint: "#716778", // tertiary text — same tone; lighter greys fail contrast on white
        },
        brand: { DEFAULT: "#38263C", hover: "#4A3350" }, // primary actions
        plum: { DEFAULT: "#F3EDF5", hover: "#EBE2EE", accent: "#806587", text: "#38263C" }, // selection / emphasis
        crimson: { DEFAULT: "#C83F52", text: "#B33547", bg: "#FBECEF", line: "#F0C8D0" },
        good: { DEFAULT: "#287A55", bg: "#EAF5EE", line: "#BFE0CD" },
        info: { DEFAULT: "#52657B" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
      fontSize: { "2xs": ["11px", "16px"] },
      boxShadow: { card: "0 1px 2px rgba(33, 26, 37, 0.04)" },
    },
  },
  plugins: [],
};
export default config;
