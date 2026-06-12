import { test, expect, type Page } from '@playwright/test';

const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin123';

// The upload UI lives behind a "+ Upload Dataset" modal on /upload.
async function openUploadModal(page: Page) {
  await page.goto('/upload');
  await page.getByRole('button', { name: /\+ upload dataset/i }).click();
  await expect(page.getByRole('heading', { name: /upload dataset/i })).toBeVisible();
}

test.describe('Data Upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).not.toHaveURL(/login/);
  });

  test('should navigate to upload/data manager page', async ({ page }) => {
    await page.goto('/upload');
    await expect(page.getByText(/upload|data manager/i).first()).toBeVisible();
  });

  test('should show upload form with file input', async ({ page }) => {
    await openUploadModal(page);
    // The upload modal's dropzone renders a file input.
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();
  });

  test('should reject unsupported file formats', async ({ page }) => {
    await openUploadModal(page);
    const fileInput = page.locator('input[type="file"]').first();

    // The dropzone only accepts geospatial formats; an unsupported file is
    // silently rejected (never selected), so the prompt stays and the submit
    // button remains disabled.
    await fileInput.setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a geospatial file'),
    });

    await expect(page.getByText(/drag & drop a file here/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^upload dataset$/i })).toBeDisabled();
  });

  test('should upload a GeoJSON file', async ({ page }) => {
    await openUploadModal(page);
    const fileInput = page.locator('input[type="file"]').first();

    // Include an explicit CRS so the upload passes the backend's CRS
    // enforcement deterministically.
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] },
          properties: { name: 'San Francisco' },
        },
      ],
    });

    // Unique name so reruns/retries never collide with an existing dataset.
    await fileInput.setInputFiles({
      name: `e2e-upload-${Date.now()}.geojson`,
      mimeType: 'application/geo+json',
      buffer: Buffer.from(geojson),
    });

    // The dataset name auto-fills from the filename; submit and wait for the
    // success message (upload + background processing).
    await page.getByRole('button', { name: /^upload dataset$/i }).click();
    await expect(
      page.getByText(/uploaded and processed successfully|success|complete/i),
    ).toBeVisible({ timeout: 30000 });
  });
});
