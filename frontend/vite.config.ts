import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL || process.env.VITE_API_URL || 'http://127.0.0.1:3001';
  let backendOrigin = '';
  try {
    backendOrigin = new URL(apiUrl).origin;
  } catch {
    backendOrigin = apiUrl;
  }

  const origins = new Set(['http://127.0.0.1:3001', 'http://localhost:3001', 'https://*.supabase.co']);
  if (backendOrigin) {
    origins.add(backendOrigin);
  }

  const connectSrc = `'self' ${Array.from(origins).join(' ')}`;
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://*.supabase.co; connect-src ${connectSrc}; frame-ancestors 'none';`;

  // Sync to vercel.json
  const vercelJsonPath = path.resolve(__dirname, 'vercel.json');
  if (fs.existsSync(vercelJsonPath)) {
    try {
      const vJson = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
      if (vJson.headers?.[0]?.headers) {
        const cspEntry = vJson.headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy');
        if (cspEntry) {
          cspEntry.value = csp;
          fs.writeFileSync(vercelJsonPath, JSON.stringify(vJson, null, 2) + '\n');
        }
      }
    } catch {
      // Ignore sync error if file is locked or invalid JSON
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4173,
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy': csp,
      },
    },
  };
});
