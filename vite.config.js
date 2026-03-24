import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** Serves /api/labor/* during `vite` dev (same handlers as Vercel serverless). */
function laborApiDevPlugin() {
  return {
    name: 'labor-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0];
        if (!pathOnly.startsWith('/api/labor')) return next();
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.statusCode = 200;
          res.end();
          return;
        }
        if (req.method !== 'GET') return next();

        const mode = server.config.mode;
        const rootEnv = loadEnv(mode, process.cwd(), '');
        const fredKey = rootEnv.FRED_API_KEY || '';

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        try {
          if (pathOnly.startsWith('/api/labor/overview')) {
            const { buildLaborOverview } = await import('./lib/labor/overview.js');
            const data = await buildLaborOverview({ fredApiKey: fredKey });
            res.end(JSON.stringify(data));
            return;
          }
          if (pathOnly.startsWith('/api/labor/chicago-fed')) {
            const { fetchChicagoFedLabor } = await import('./lib/labor/chicagoFed.js');
            const data = await fetchChicagoFedLabor();
            res.end(JSON.stringify(data));
            return;
          }
          if (pathOnly.startsWith('/api/labor/fred')) {
            const { fetchAllFredLatest, fetchFredSeries, SERIES_MAP } = await import('./lib/labor/fred.js');
            if (!fredKey.trim()) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Add FRED_API_KEY to .env (repo root) for FRED in dev.' }));
              return;
            }
            const full = new URL(req.url || '', 'http://localhost');
            const series = full.searchParams.get('series') || full.searchParams.get('series_id');
            if (series) {
              const obs = await fetchFredSeries(series, fredKey);
              res.end(
                JSON.stringify({
                  series_id: series,
                  meta: SERIES_MAP[series] || { name: series },
                  observations: obs,
                }),
              );
              return;
            }
            const all = await fetchAllFredLatest(fredKey);
            res.end(JSON.stringify({ series: all }));
            return;
          }
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message || String(e) }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), laborApiDevPlugin()],
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
        // Optional: Python FastAPI (rays_tracker + SQLite) — not used by /api/labor (Vercel uses Node).
        '/rays-tracker': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rays-tracker/, ''),
        },
      },
    },
  };
});
