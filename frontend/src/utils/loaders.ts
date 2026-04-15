import { registerLoaders } from '@loaders.gl/core';
import { MVTLoader } from '@loaders.gl/mvt';
// Vite copies the worker bundle into the build output and returns a
// same-origin, hashed URL. This keeps loaders.gl from falling back to
// its default unpkg.com fetch, which our CSP (`script-src 'self'
// 'unsafe-inline'`) blocks.
import mvtWorkerUrlRaw from '@loaders.gl/mvt/dist/mvt-worker.js?url';

export const mvtWorkerUrl: string = mvtWorkerUrlRaw;

let registered = false;

/**
 * Register the full MVT loader (both parsers) with loaders.gl, pointing the
 * worker bootstrap at our locally-bundled worker script. Safe to call
 * multiple times — only runs once per page.
 */
export function registerLocalLoaders(): void {
  if (registered) return;
  registered = true;

  const base = MVTLoader as unknown as {
    options?: { mvt?: Record<string, unknown> } & Record<string, unknown>;
  } & Record<string, unknown>;
  const patched = {
    ...base,
    options: {
      ...(base.options ?? {}),
      mvt: {
        ...((base.options?.mvt as Record<string, unknown>) ?? {}),
        workerUrl: mvtWorkerUrl,
      },
    },
  };
  // The loaders.gl Loader type is strict about the shape of `options`; we
  // supply the full MVTLoader with a widened `options.mvt.workerUrl`, so
  // casting through unknown is the safest bridge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerLoaders([patched as any]);
}
