/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        midnight: "#080B12",
        graphite: "#111722",
        cyan: "#00E5FF",
        lime: "#B6FF4A",
        ember: "#FF9F43"
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      }
    }
  },
  plugins: []
};
