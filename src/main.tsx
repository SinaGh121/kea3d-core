import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadAppSettings, resolveThemePreference } from './settings';
import { isNativeShell } from './nativeShell';
import './styles.css';

const PwaStatus = !isNativeShell()
  ? lazy(() => import('./PwaStatus').then((module) => ({ default: module.PwaStatus })))
  : null;

const startupSettings = loadAppSettings();
const startupTheme = resolveThemePreference(startupSettings.appearance.theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark', startupTheme === 'dark');
document.documentElement.dataset.theme = startupTheme;
document.documentElement.dataset.accent = startupSettings.appearance.accent;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {PwaStatus ? (
      <Suspense fallback={null}>
        <PwaStatus />
      </Suspense>
    ) : null}
  </StrictMode>,
);
