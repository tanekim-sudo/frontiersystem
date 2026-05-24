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

/** Serves /api/signal-store during `vite` dev (same handler as Vercel). */
function signalStoreApiDevPlugin() {
  return {
    name: 'signal-store-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0];
        if (pathOnly !== '/api/signal-store') return next();

        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const readBody = () =>
          new Promise((resolve, reject) => {
            let b = '';
            req.on('data', (c) => {
              b += c;
            });
            req.on('end', () => resolve(b));
            req.on('error', reject);
          });

        const bodyStr = req.method === 'GET' ? '' : await readBody();
        let bodyObj = {};
        if (bodyStr) {
          try {
            bodyObj = JSON.parse(bodyStr);
          } catch {
            bodyObj = {};
          }
        }

        const mode = server.config.mode;
        const rootEnv = loadEnv(mode, process.cwd(), '');
        const prev = {
          SIGNAL_STORE_SECRET: process.env.SIGNAL_STORE_SECRET,
          SIGNAL_DATA_GITHUB_PAT: process.env.SIGNAL_DATA_GITHUB_PAT,
          GITHUB_TOKEN: process.env.GITHUB_TOKEN,
          SIGNAL_DATA_GIST_ID: process.env.SIGNAL_DATA_GIST_ID,
        };
        process.env.SIGNAL_STORE_SECRET = rootEnv.SIGNAL_STORE_SECRET || '';
        process.env.SIGNAL_DATA_GITHUB_PAT = rootEnv.SIGNAL_DATA_GITHUB_PAT || '';
        process.env.GITHUB_TOKEN = rootEnv.GITHUB_TOKEN || '';
        process.env.SIGNAL_DATA_GIST_ID = rootEnv.SIGNAL_DATA_GIST_ID || '';

        const mockReq = {
          method: req.method,
          headers: req.headers,
          body: bodyObj,
        };

        const mockRes = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(obj) {
            if (!res.headersSent) {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = this.statusCode;
              res.end(JSON.stringify(obj));
            }
          },
          end(chunk) {
            if (!res.headersSent) {
              res.statusCode = this.statusCode;
              res.end(chunk ?? '');
            }
          },
        };

        try {
          const { default: handler } = await import('./api/signal-store.js');
          await handler(mockReq, mockRes);
        } catch (e) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
        } finally {
          process.env.SIGNAL_STORE_SECRET = prev.SIGNAL_STORE_SECRET;
          process.env.SIGNAL_DATA_GITHUB_PAT = prev.SIGNAL_DATA_GITHUB_PAT;
          process.env.GITHUB_TOKEN = prev.GITHUB_TOKEN;
          process.env.SIGNAL_DATA_GIST_ID = prev.SIGNAL_DATA_GIST_ID;
        }
      });
    },
  };
}

/** Serves /api/dashboard-state during `vite` dev (Postgres via DATABASE_URL). */
function dashboardStateApiDevPlugin() {
  return {
    name: 'dashboard-state-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0];
        if (pathOnly !== '/api/dashboard-state') return next();

        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const readBody = () =>
          new Promise((resolve, reject) => {
            let b = '';
            req.on('data', (c) => {
              b += c;
            });
            req.on('end', () => resolve(b));
            req.on('error', reject);
          });

        const bodyStr = req.method === 'GET' ? '' : await readBody();
        let bodyObj = {};
        if (bodyStr) {
          try {
            bodyObj = JSON.parse(bodyStr);
          } catch {
            bodyObj = {};
          }
        }

        const mode = server.config.mode;
        const rootEnv = loadEnv(mode, process.cwd(), '');
        const prev = {
          DATABASE_URL: process.env.DATABASE_URL,
          DASHBOARD_STORE_SECRET: process.env.DASHBOARD_STORE_SECRET,
          SUPABASE_URL: process.env.SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        };
        process.env.DATABASE_URL = rootEnv.DATABASE_URL || '';
        process.env.DASHBOARD_STORE_SECRET = rootEnv.DASHBOARD_STORE_SECRET || '';
        process.env.SUPABASE_URL = rootEnv.SUPABASE_URL || '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = rootEnv.SUPABASE_SERVICE_ROLE_KEY || '';

        const mockReq = {
          method: req.method,
          headers: req.headers,
          body: bodyObj,
        };

        const mockRes = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(obj) {
            if (!res.headersSent) {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = this.statusCode;
              res.end(JSON.stringify(obj));
            }
          },
          end(chunk) {
            if (!res.headersSent) {
              res.statusCode = this.statusCode;
              res.end(chunk ?? '');
            }
          },
        };

        try {
          const { default: handler } = await import('./api/dashboard-state.js');
          await handler(mockReq, mockRes);
        } catch (e) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
        } finally {
          process.env.DATABASE_URL = prev.DATABASE_URL;
          process.env.DASHBOARD_STORE_SECRET = prev.DASHBOARD_STORE_SECRET;
          process.env.SUPABASE_URL = prev.SUPABASE_URL;
          process.env.SUPABASE_SERVICE_ROLE_KEY = prev.SUPABASE_SERVICE_ROLE_KEY;
        }
      });
    },
  };
}

/** Serves /api/ai-news during `vite` dev (SerpAPI Google News). */
function aiNewsApiDevPlugin() {
  return {
    name: 'ai-news-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0];
        if (pathOnly !== '/api/ai-news') return next();
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        const mode = server.config.mode;
        const rootEnv = loadEnv(mode, process.cwd(), '');
        const mockReq = { method: 'GET', query: Object.fromEntries(new URL(req.url || '', 'http://localhost').searchParams) };
        const mockRes = {
          statusCode: 200,
          status(c) {
            this.statusCode = c;
            return this;
          },
          setHeader(k, v) {
            res.setHeader(k, v);
          },
          json(obj) {
            if (!res.headersSent) {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = this.statusCode || 200;
              res.end(JSON.stringify(obj));
            }
          },
        };
        process.env.SERPAPI_KEY = rootEnv.SERPAPI_KEY || rootEnv.VITE_SERPAPI_KEY || '';
        try {
          const { default: handler } = await import('./api/ai-news.js');
          await handler(mockReq, mockRes);
        } catch (e) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
        }
      });
    },
  };
}

/** Serves /api/stock-pulse during `vite` dev (Yahoo + optional SerpAPI). */
function stockPulseApiDevPlugin() {
  return {
    name: 'stock-pulse-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0];
        if (pathOnly !== '/api/stock-pulse') return next();
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        const mode = server.config.mode;
        const rootEnv = loadEnv(mode, process.cwd(), '');
        const mockReq = { method: 'GET', query: Object.fromEntries(new URL(req.url || '', 'http://localhost').searchParams) };
        const mockRes = {
          statusCode: 200,
          status(c) {
            this.statusCode = c;
            return this;
          },
          setHeader(k, v) {
            res.setHeader(k, v);
          },
          json(obj) {
            if (!res.headersSent) {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = this.statusCode || 200;
              res.end(JSON.stringify(obj));
            }
          },
        };
        process.env.SERPAPI_KEY = rootEnv.SERPAPI_KEY || rootEnv.VITE_SERPAPI_KEY || '';
        try {
          const { default: handler } = await import('./api/stock-pulse.js');
          await handler(mockReq, mockRes);
        } catch (e) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
        }
      });
    },
  };
}

/** Serves /api/dashboard-health during `vite` dev. */
function dashboardHealthApiDevPlugin() {
  return {
    name: 'dashboard-health-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0];
        if (pathOnly !== '/api/dashboard-health') return next();
        if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.statusCode = 204; res.end(); return; }
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        const mode = server.config.mode;
        const rootEnv = loadEnv(mode, process.cwd(), '');
        const prev = { DATABASE_URL: process.env.DATABASE_URL, DASHBOARD_STORE_SECRET: process.env.DASHBOARD_STORE_SECRET, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
        process.env.DATABASE_URL = rootEnv.DATABASE_URL || '';
        process.env.DASHBOARD_STORE_SECRET = rootEnv.DASHBOARD_STORE_SECRET || '';
        process.env.SUPABASE_URL = rootEnv.SUPABASE_URL || '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = rootEnv.SUPABASE_SERVICE_ROLE_KEY || '';
        const mockReq = { method: 'GET', headers: req.headers };
        const mockRes = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(obj) { if (!res.headersSent) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.statusCode = this.statusCode; res.end(JSON.stringify(obj)); } }, end(c) { if (!res.headersSent) { res.statusCode = this.statusCode; res.end(c ?? ''); } } };
        try { const { default: handler } = await import('./api/dashboard-health.js'); await handler(mockReq, mockRes); } catch (e) { if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: e.message })); } }
        finally { Object.assign(process.env, prev); }
      });
    },
  };
}

/** Serves /api/interface-layer/* during `vite` dev. */
function interfaceLayerApiDevPlugin() {
  return {
    name: 'interface-layer-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0];
        if (!pathOnly.startsWith('/api/interface-layer/')) return next();
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        const layer = pathOnly.replace('/api/interface-layer/', '').trim();
        const map = {
          physical_ai: './api/interface-layer/physical_ai.js',
          voice: './api/interface-layer/voice.js',
          spatial: './api/interface-layer/spatial.js',
          agent: './api/interface-layer/agent.js',
          neural: './api/interface-layer/neural.js',
        };
        const target = map[layer];
        if (!target) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Unknown layer: ${layer}` }));
          return;
        }
        const mockReq = { method: 'GET', headers: req.headers, query: Object.fromEntries(new URL(req.url || '', 'http://localhost').searchParams) };
        const mockRes = {
          statusCode: 200,
          status(c) { this.statusCode = c; return this; },
          setHeader(k, v) { res.setHeader(k, v); },
          json(obj) {
            if (!res.headersSent) {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = this.statusCode || 200;
              res.end(JSON.stringify(obj));
            }
          },
          end(chunk) {
            if (!res.headersSent) {
              res.statusCode = this.statusCode || 200;
              res.end(chunk ?? '');
            }
          },
        };
        try {
          const { default: handler } = await import(target);
          await handler(mockReq, mockRes);
        } catch (e) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), laborApiDevPlugin(), signalStoreApiDevPlugin(), dashboardStateApiDevPlugin(), dashboardHealthApiDevPlugin(), aiNewsApiDevPlugin(), stockPulseApiDevPlugin(), interfaceLayerApiDevPlugin()],
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
        // Optional: Python FastAPI (+ SQLite) — not used by /api/labor (Vercel uses Node).
        '/tracker': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/tracker/, ''),
        },
      },
    },
  };
});
