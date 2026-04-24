import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      proxy: {
        '/r2-music': {
          target: 'https://pub-cb7f6167a48441ff8887d8509ae0a500.r2.dev/G-Transpose',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/r2-music/, ''),
        }
      }
    },
  };
});
