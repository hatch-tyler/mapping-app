import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.tsx'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        '*.config.js',
        '*.config.ts',
        'postcss.config.js',
        'tailwind.config.js',
        // Exclude files that require integration testing due to external dependencies
        'src/api/client.ts', // Axios interceptors - integration tested via E2E
        'src/components/map/MapContainer.tsx', // deck.gl/maplibre - integration tested via E2E
      ],
      thresholds: {
        statements: 95,
        branches: 90, // Some branch coverage gaps in complex conditional logic
        functions: 90, // Some functions require E2E testing (publicClient API calls)
        lines: 95,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
