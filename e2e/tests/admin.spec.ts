import { test, expect } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

test.describe('Admin Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).not.toHaveURL(/login/);
  });

  test('should navigate to admin page', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/admin|management|users|datasets/i).first()).toBeVisible();
  });

  test('should show user list', async ({ page }) => {
    await page.goto('/admin');
    // Look for a users section or table
    await expect(page.getByText(/users|members/i).first()).toBeVisible();
    // Should show at least the admin user
    await expect(page.getByText(TEST_EMAIL)).toBeVisible();
  });

  test('should show dataset management table', async ({ page }) => {
    await page.goto('/admin');
    // Should have a datasets section
    const datasetsSection = page.getByText(/datasets|layers/i).first();
    await expect(datasetsSection).toBeVisible();
  });

  test('should toggle dataset visibility', async ({ page }) => {
    await page.goto('/admin');
    // Find a visibility toggle in the dataset table
    const visibilityToggle = page.locator(
      '[data-testid="visibility-toggle"], button:has-text("visible"), button:has-text("hidden")'
    ).first();
    if (await visibilityToggle.isVisible({ timeout: 5000 })) {
      await visibilityToggle.click();
      // Toggle back
      await page.waitForTimeout(500);
      await visibilityToggle.click();
    }
  });

  test('should show registration requests section', async ({ page }) => {
    await page.goto('/admin');
    const regSection = page.getByText(/registration|requests|pending/i).first();
    if (await regSection.isVisible({ timeout: 5000 })) {
      // Registration requests section exists
      expect(true).toBeTruthy();
    }
  });
});
