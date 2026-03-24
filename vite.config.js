import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      open: true,
      port: 5173,
      proxy: {
        '/serpapi': {
          target: 'https://serpapi.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/serpapi/, ''),
        },
        '/api/google-trends': {
          target: 'https://serpapi.com',
          changeOrigin: true,
          rewrite: (path) => {
            const url = new URL('http://localhost' + path);
            const params = url.searchParams;
            if (!params.get('api_key') && env.VITE_SERPAPI_KEY) {
              params.set('api_key', env.VITE_SERPAPI_KEY);
            }
            return '/search.json?' + params.toString();
          },
        },
        '/api/pcaob': {
          target: 'https://pcaobus.org',
          changeOrigin: true,
          rewrite: () => '/docs/default-source/generated-reports/inspecton-reports-json.json?sfvrsn=da1a11cd_987',
        },
        // Python FastAPI (rays_tracker) — run: uvicorn rays_tracker.main:app --port 8765
        '/rays-tracker': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rays-tracker/, ''),
        },
      },
    },
  };
});
