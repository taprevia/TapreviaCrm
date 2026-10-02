import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        bg: {
          DEFAULT: "var(--bg-base)",
          raised: "var(--bg-raised)",
        },
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
        },
        field: {
          DEFAULT: "var(--input-bg)",
          alt: "var(--input-bg-alt)",
        },
        accent: {
          DEFAULT: "#2563EB",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#2563EB",
        },
        line: {
          DEFAULT: "#334155",
          subtle: "#2D3748",
          strong: "#475569",
        },
        ink: {
          DEFAULT: "#F8FAFC",
          inverse: "#FFFFFF",
          mute: "#94A3B8",
          faint: "#64748B",
        },
        ok: "#10B981",
        wa: "#25D366",
        warn: "#F59E0B",
        bad: {
          DEFAULT: "#EF4444",
          solid: "#DC2626",
        },
        brand: {
          navy: "#151E3D",
          dark: "#1A2744",
          slate: "#1F2A44",
          accent: "#3B5BFF",
          accentHover: "#254BFF",
          bgLight: "#F8F9FB",
          border: "#E5E7EB",
          textMuted: "#6B7280",
          star: "#F59E0B",
          teal: "#10B981",
          whatsapp: "#25D366",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        e1: "0 1px 2px 0 rgb(0 0 0 / 0.40)",
        e2: "0 4px 12px -2px rgb(0 0 0 / 0.50)",
        e3: "0 12px 32px -8px rgb(0 0 0 / 0.60)",
        pop: "0 8px 24px -4px rgb(0 0 0 / 0.55)",
        glow: "inset 0 1px 0 0 rgb(255 255 255 / 0.04)",
        rail: "-16px 0 40px rgb(0 0 0 / 0.45)",
        card: "0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        "card-hover":
          "0 4px 12px 0 rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
        elevated:
          "0 10px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.04)",
        brandCard: "0 4px 20px -2px rgba(21, 30, 61, 0.05)",
        heroCard: "0 10px 40px -10px rgba(0, 0, 0, 0.08)",
        float: "0 12px 32px -4px rgba(0, 0, 0, 0.12)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
        "4xl": "1.75rem",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(24px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
        "slide-in-right": "slide-in-right 0.26s cubic-bezier(0.32, 0.72, 0, 1)",
        "scale-in": "scale-in 0.2s ease-out",
        "shimmer": "shimmer 2s infinite linear",
        "toast-in": "toast-in 0.2s cubic-bezier(0.2, 0, 0, 1)",
        "marquee": "marquee 25s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
