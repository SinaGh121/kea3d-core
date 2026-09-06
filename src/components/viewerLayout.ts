import { useEffect, useState } from 'react';

export const sideWorkspaceWidth = 'min(360px, 46vw)';
export function useSideWorkspace(): boolean {
  const query = '(min-width: 600px) and (max-width: 1023px) and (max-height: 500px) and (orientation: landscape)';
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return matches;
}
