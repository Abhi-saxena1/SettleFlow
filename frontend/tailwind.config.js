/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#07110d",
        mint: "#dbf8e8",
        leaf: "#17b26a",
        sage: "#effaf4"
      },
      boxShadow: {
        glow: "0 20px 60px rgba(23, 178, 106, 0.18)"
      }
    }
  },
  plugins: []
};
