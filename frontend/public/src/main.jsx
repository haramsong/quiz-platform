import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installNoPullToRefresh } from './utils/noPullRefresh';

installNoPullToRefresh();

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
);
