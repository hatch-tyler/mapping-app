import { describe, it, expect } from 'vitest';
import { canSaveDatasetStyle } from './permissions';
import type { User } from '../api/types';

const baseUser: User = {
  id: 'u1',
  email: 'u@example.com',
  full_name: 'U',
  is_active: true,
  is_admin: false,
  role: 'viewer',
  created_at: '2026-01-01T00:00:00Z',
};

describe('canSaveDatasetStyle', () => {
  it('returns false for unauthenticated user', () => {
    expect(canSaveDatasetStyle(null)).toBe(false);
    expect(canSaveDatasetStyle(undefined)).toBe(false);
  });

  it('returns false for viewer role', () => {
    expect(canSaveDatasetStyle({ ...baseUser, role: 'viewer' })).toBe(false);
  });

  it('returns true for editor role', () => {
    expect(canSaveDatasetStyle({ ...baseUser, role: 'editor' })).toBe(true);
  });

  it('returns true for admin role', () => {
    expect(canSaveDatasetStyle({ ...baseUser, role: 'admin' })).toBe(true);
  });

  it('does not honor legacy is_admin without role=admin', () => {
    // The backend rule is keyed off `role`; is_admin alone shouldn't
    // grant save access on the frontend either.
    expect(
      canSaveDatasetStyle({ ...baseUser, is_admin: true, role: 'viewer' }),
    ).toBe(false);
  });
});
