import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerLocalLoaders } from './utils/loaders';
import './styles/globals.css';

// Register loaders.gl parsers with a same-origin worker URL so the MVT
// decoder doesn't fall back to https://unpkg.com (blocked by our CSP).
registerLocalLoaders();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
