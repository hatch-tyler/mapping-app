import React from 'react';
import ReactDOM from 'react-dom/client';
import { setLoaderOptions } from '@loaders.gl/core';
import App from './App';
import './styles/globals.css';

// loaders.gl's default worker bootstrap pulls scripts from https://unpkg.com,
// which our production CSP (`script-src 'self' 'unsafe-inline'`) blocks. Run
// parsers on the main thread so the browser never tries the external fetch.
setLoaderOptions({ worker: false });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
