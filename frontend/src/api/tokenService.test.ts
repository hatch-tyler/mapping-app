import { describe, it, expect, beforeEach } from 'vitest';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './tokenService';

describe('tokenService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return null when no access token is stored', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('should return null when no refresh token is stored', () => {
    expect(getRefreshToken()).toBeNull();
  });

  it('should store and retrieve access token', () => {
    setTokens('access-123', 'refresh-456');
    expect(getAccessToken()).toBe('access-123');
  });

  it('should store and retrieve refresh token', () => {
    setTokens('access-123', 'refresh-456');
    expect(getRefreshToken()).toBe('refresh-456');
  });

  it('should clear both tokens', () => {
    setTokens('access-123', 'refresh-456');
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('should overwrite existing tokens', () => {
    setTokens('old-access', 'old-refresh');
    setTokens('new-access', 'new-refresh');
    expect(getAccessToken()).toBe('new-access');
    expect(getRefreshToken()).toBe('new-refresh');
  });
});
