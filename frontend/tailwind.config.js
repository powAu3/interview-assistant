/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0f0f12',
          secondary: '#1a1a24',
          tertiary: '#24243a',
          hover: '#2a2a44',
        },
        accent: {
          blue: '#6366f1',
          green: '#22c55e',
          red: '#ef4444',
          amber: '#f59e0b',
        },
        text: {
          primary: '#e2e8f0',
          secondary: '#94a3b8',
          muted: '#64748b',
        },
      },
    },
  },
  plugins: [],
}
