import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/sec-www': {
        target: 'https://www.sec.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sec-www/, ''),
        headers: {
          'User-Agent': 'BeneishTerminal/1.0 (contact@beneish-screener.com)',
          'Accept': 'application/json'
        }
      },
      '/api/sec-data': {
        target: 'https://data.sec.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sec-data/, ''),
        headers: {
          'User-Agent': 'BeneishTerminal/1.0 (contact@beneish-screener.com)',
          'Accept': 'application/json'
        }
      },
      '/api/yahoo': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json'
        }
      }
    }
  }
})
