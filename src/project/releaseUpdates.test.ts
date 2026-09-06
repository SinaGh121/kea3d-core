import { describe, expect, it } from 'vitest';
import { newerVersion, publishedVersion, releaseDestination, releasePlatform } from './releaseUpdates';
describe('release updates', () => {
  it('compares numeric versions without offering downgrades', () => {
    expect(newerVersion('0.1.100', '0.1.99')).toBe(true);
    expect(newerVersion('0.1.99', '0.1.100')).toBe(false);
    expect(newerVersion('0.1.99', '0.1.99')).toBe(false);
    expect(newerVersion('0.2.0-beta', '0.1.99')).toBe(false);
  });
  it('does not announce unavailable platform releases', () => {
    expect(publishedVersion({ schema: 1, platforms: { android: null } }, 'android')).toBeNull();
    expect(() => publishedVersion({ schema: 1, platforms: {} }, 'windows')).toThrow();
    expect(() => publishedVersion({ schema: 1, platforms: { windows: '<bad>' } }, 'windows')).toThrow();
  });
  it('uses controlled destinations and detects native platforms', () => {
    expect(releasePlatform('Android Linux')).toBe('android');
    expect(releasePlatform('iPhone Mac')).toBe('ios');
    expect(releasePlatform('Windows NT')).toBe('windows');
    expect(releaseDestination('windows')).toBe('https://kea3d.com/download/');
    expect(releaseDestination('android')).toContain('com.kea3d.app');
  });
});
