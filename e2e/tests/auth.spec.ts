import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

test.describe('Authentication', () => {
  test('should show login page for unauthenticated users', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/login/);
    await expect(page.getByRole('heading', { name: /sign in|log in/i }).or(page.getByRole('button', { name: /sign in|log in/i }))).toBeVisible();
  });

  test('should login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // Should redirect to the map or home page
    await expect(page).not.toHaveURL(/login/);
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('wrong@example.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // Should stay on login page with an error
    await expect(page).toHaveURL(/login/);
    await expect(page.getByText(/invalid|incorrect|error/i)).toBeVisible();
  });

  test('should redirect to login after logout', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).not.toHaveURL(/login/);

    // Find and click logout
    // Try clicking user menu or logout button directly
    const userMenu = page.getByRole('button', { name: /account|user|profile|menu/i });
    if (await userMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
      await userMenu.click();
    }
    const logoutBtn = page.getByRole('button', { name: /log out|sign out|logout/i }).or(page.getByText(/log out|sign out|logout/i));
    await logoutBtn.first().click();

    await expect(page).toHaveURL(/login/);
  });

  test('should protect routes when not authenticated', async ({ page }) => {
    await page.goto('/map');
    await expect(page).toHaveURL(/login/);
  });
});
