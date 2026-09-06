import { useCallback, useEffect, useRef, useState } from 'react';
import metadata from '../../package.json';
import { newerVersion, publishedVersion, releasePlatform } from './releaseUpdates';

const preference = 'kea3d.update-checks.v1';
export function useReleaseUpdates(native: boolean) {
  const platform = releasePlatform(navigator.userAgent);
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(preference) !== 'off'; } catch { return true; }
  });
  const [status, setStatus] = useState<'idle' | 'checking' | 'current' | 'available' | 'unpublished' | 'error'>('idle');
  const [version, setVersion] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    if (!native) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timer = setTimeout(() => request.abort(), 8000);
    setStatus('checking');
    try {
      const response = await fetch('https://kea3d.com/releases.json', { signal: request.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Release check failed');
      const text = await response.text();
      if (text.length > 8192) throw new Error('Release list too large');
      const latest = publishedVersion(JSON.parse(text), platform);
      if (controller.current !== request) return;
      setVersion(latest);
      setStatus(latest === null ? 'unpublished' : newerVersion(latest, metadata.version) ? 'available' : 'current');
    } catch {
      if (controller.current === request) setStatus('error');
    } finally { clearTimeout(timer); }
  }, [native, platform]);
  useEffect(() => {
    if (!native || !enabled) return;
    const timer = setTimeout(() => { void check(); }, 5000);
    return () => { clearTimeout(timer); controller.current?.abort(); controller.current = null; };
  }, [native, enabled, check]);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  const toggle = (value: boolean) => {
    if (!value) {
      controller.current?.abort();
      controller.current = null;
      setStatus(previous => previous === 'checking' ? 'idle' : previous);
    }
    setEnabled(value);
    try { localStorage.setItem(preference, value ? 'on' : 'off'); } catch { /* Session preference still works. */ }
  };
  return { status, version, platform, enabled, toggle, check };
}
