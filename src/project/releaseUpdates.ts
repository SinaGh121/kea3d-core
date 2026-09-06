export type ReleasePlatform = 'windows' | 'linux' | 'macos' | 'android' | 'ios';
export function releasePlatform(agent: string): ReleasePlatform {
  if (/Android/i.test(agent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(agent)) return 'ios';
  if (/Windows/i.test(agent)) return 'windows';
  return /Mac/i.test(agent) ? 'macos' : 'linux';
}
export function newerVersion(candidate: string, current: string): boolean {
  const valid = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!valid.test(candidate) || !valid.test(current)) return false;
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number);
  if (![...a, ...b].every(Number.isSafeInteger)) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
export function publishedVersion(data: unknown, platform: ReleasePlatform): string | null {
  if (!data || typeof data !== 'object' || !('schema' in data) || data.schema !== 1 || !('platforms' in data)) throw new Error('Invalid release list');
  const channels = data.platforms;
  if (!channels || typeof channels !== 'object' || !(platform in channels)) throw new Error('Missing release channel');
  const version = (channels as Record<string, unknown>)[platform];
  if (version === null) return null;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Invalid release version');
  return version;
}
// Never open a server-supplied executable URL or replace running binaries.
export function releaseDestination(platform: ReleasePlatform): string {
  return platform === 'android' ? 'https://play.google.com/store/apps/details?id=com.kea3d.app' : 'https://kea3d.com/download/';
}
