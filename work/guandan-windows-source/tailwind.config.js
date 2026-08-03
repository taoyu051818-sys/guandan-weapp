/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      fontFamily: {
        cinzel: ['"Cinzel"', "serif"],
        outfit: ['"Outfit"', "sans-serif"],
      },
      colors: {
        luxury: {
          gold: '#d4af37',
          goldLight: '#f3e5ab',
          goldDark: '#aa8c2c',
          crimson: '#8b0000',
          obsidian: '#0b0c10',
          midnight: '#1a1a2e',
          slate: '#2c3e50',
          ivory: '#fffff0',
        }
      },
      boxShadow: {
        'gold-glow': '0 0 15px rgba(212, 175, 55, 0.5)',
        'crimson-glow': '0 0 15px rgba(139, 0, 0, 0.5)',
        'card': '0 10px 30px -5px rgba(0, 0, 0, 0.5)',
        'card-hover': '0 20px 40px -5px rgba(0, 0, 0, 0.7)',
      },
      backgroundImage: {
        'radial-poker': 'radial-gradient(ellipse at center, #1a1a2e 0%, #0b0c10 100%)',
        'gold-gradient': 'linear-gradient(135deg, #aa8c2c 0%, #f3e5ab 50%, #d4af37 100%)',
        'glass': 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)',
      }
    },
  },
  plugins: [],
};
