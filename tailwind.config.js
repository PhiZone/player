import daisyui from 'daisyui';
import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      backgroundSize: {
        'size-200': '200% 200%',
      },
      backgroundPosition: {
        'pos-0': '2% 2%',
        'pos-100': '98% 98%',
      },
    },
  },
  plugins: [
    daisyui,
    forms({
      strategy: 'class',
    }),
  ],
  daisyui: {
    themes: ['winter', 'night'],
    darkTheme: 'night',
  },
};
