import type { User } from '../api/types';

/** True if the user is allowed to persist dataset style changes for
 *  everyone. Mirrors the backend rule on PUT /api/v1/datasets/{id}
 *  (``get_current_editor_or_admin_user``) so the UI never offers a
 *  Save action that the backend would 403. Viewers and unauthenticated
 *  users may still preview style changes locally — that path doesn't
 *  go through this gate. */
export function canSaveDatasetStyle(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'editor';
}
