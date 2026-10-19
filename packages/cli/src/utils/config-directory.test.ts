import { describe, expect, it } from 'vitest';
import { configDirectory } from './config-directory.js';

describe('CLI config directory', () => {
  it('uses the existing per-platform convention', () => {
    expect(configDirectory({}, 'darwin', '/home/user')).toBe('/home/user/Library/Application Support/hypequery');
    expect(configDirectory({}, 'linux', '/home/user')).toBe('/home/user/.config/hypequery');
    expect(configDirectory({ XDG_CONFIG_HOME: '/settings' }, 'linux', '/home/user')).toBe('/settings/hypequery');
    expect(configDirectory({ APPDATA: '/roaming', LOCALAPPDATA: '/local' }, 'win32', '/home/user')).toBe('/roaming/hypequery');
    expect(configDirectory({ LOCALAPPDATA: '/local' }, 'win32', '/home/user')).toBe('/local/hypequery');
    expect(configDirectory({ HYPEQUERY_CONFIG_DIR: '/override' }, 'darwin', '/home/user')).toBe('/override');
  });
});
