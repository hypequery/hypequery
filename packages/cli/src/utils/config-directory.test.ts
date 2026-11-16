import { describe, expect, it } from 'vitest';
import { configDirectory, explicitConfigDirectory } from './config-directory.js';

describe('CLI config directory', () => {
  it('uses the existing per-platform convention', () => {
    expect(configDirectory({}, 'darwin', '/home/user')).toBe('/home/user/Library/Application Support/hypequery');
    expect(configDirectory({}, 'linux', '/home/user')).toBe('/home/user/.config/hypequery');
    expect(configDirectory({ XDG_CONFIG_HOME: '/settings' }, 'linux', '/home/user')).toBe('/settings/hypequery');
    expect(configDirectory({ APPDATA: '/roaming', LOCALAPPDATA: '/local' }, 'win32', '/home/user')).toBe('/roaming/hypequery');
    expect(configDirectory({ LOCALAPPDATA: '/local' }, 'win32', '/home/user')).toBe('/local/hypequery');
    expect(configDirectory({ HYPEQUERY_CONFIG_DIR: '/override' }, 'darwin', '/home/user')).toBe('/override');
  });

  it('ignores directory variables a project .env file set', () => {
    const fromFile = new Set(['HYPEQUERY_CONFIG_DIR', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA']);
    expect(configDirectory({ HYPEQUERY_CONFIG_DIR: '/repo/.hq' }, 'darwin', '/home/user', fromFile))
      .toBe('/home/user/Library/Application Support/hypequery');
    expect(configDirectory({ XDG_CONFIG_HOME: '/repo' }, 'linux', '/home/user', fromFile))
      .toBe('/home/user/.config/hypequery');
    expect(configDirectory({ APPDATA: 'C:\\repo', LOCALAPPDATA: 'C:\\repo' }, 'win32', 'C:\\Users\\me', fromFile))
      .toBe(configDirectory({}, 'win32', 'C:\\Users\\me'));
    expect(explicitConfigDirectory({ HYPEQUERY_CONFIG_DIR: '/repo/.hq' }, 'linux', fromFile)).toBeUndefined();
  });

  it('refuses a relative HYPEQUERY_CONFIG_DIR and ignores a relative platform variable', () => {
    expect(() => configDirectory({ HYPEQUERY_CONFIG_DIR: './.hq' }, 'linux', '/home/user', new Set()))
      .toThrow(/HYPEQUERY_CONFIG_DIR must be an absolute path/);
    expect(configDirectory({ XDG_CONFIG_HOME: 'settings' }, 'linux', '/home/user', new Set()))
      .toBe('/home/user/.config/hypequery');
    expect(configDirectory({ APPDATA: 'roaming' }, 'win32', '/home/user', new Set()))
      .toBe(configDirectory({}, 'win32', '/home/user'));
  });
});
