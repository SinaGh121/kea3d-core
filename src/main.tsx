import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PwaStatus } from './PwaStatus';
import { loadAppSettings, resolveThemePreference } from './settings';
import { resetNativeWebCache } from './nativeShell';
import './styles.css';

const startupSettings = loadAppSettings();
const startupTheme = resolveThemePreference(startupSettings.appearance.theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark', startupTheme === 'dark');
document.documentElement.dataset.theme = startupTheme;
document.documentElement.dataset.accent = startupSettings.appearance.accent;
void resetNativeWebCache();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PwaStatus />
  </StrictMode>,
);
