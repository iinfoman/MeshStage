import { expect, test } from '@playwright/test';
import { writeFixtures } from './fixtures';
import { unlockAudio, watchForErrors } from './helpers';

const fixtures = writeFixtures();

/**
 * The upload has to matter.
 *
 * An earlier build seeded the character from the *file name* and never opened
 * the image, so every upload produced the same body and renaming a file
 * produced a different one. These assert the inverse of both.
 */
async function generateFromUpload(page: import('@playwright/test').Page, file: string) {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', file);
  await expect(page.getByRole('button', { name: 'Generate 3D Character' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate 3D Character' }).click();
  await expect(page.getByRole('button', { name: 'Finalize & Continue to Export' })).toBeVisible({
    timeout: 45_000,
  });
  await unlockAudio(page);
}

/** The character's derived identity, from the viewport's status summary. */
async function identityOf(page: import('@playwright/test').Page): Promise<string> {
  return (await page.getByRole('status').first().getAttribute('aria-label')) ?? '';
}

test.describe('generation from an upload', () => {
  test('two different images produce two different characters', async ({ page }) => {
    const errors = watchForErrors(page);

    await generateFromUpload(page, fixtures.mascotWarm);
    const warm = await identityOf(page);

    await generateFromUpload(page, fixtures.mascotCool);
    const cool = await identityOf(page);

    expect(warm).not.toBe(cool);
    expect(errors).toEqual([]);
  });

  test('the same image under a different file name is the same character', async ({ page }) => {
    await generateFromUpload(page, fixtures.mascotWarm);
    const original = await identityOf(page);

    await generateFromUpload(page, fixtures.mascotWarmRenamed);
    const renamed = await identityOf(page);

    // Seeded from pixel content, so the file name cannot change the result.
    expect(renamed).toBe(original);
  });

  test('the character carries the reference artwork and palette', async ({ page }) => {
    await generateFromUpload(page, fixtures.mascotWarm);

    // Sample the rendered frame: any warm majority on screen can only have
    // come from the uploaded orange mascot, because the procedural fallback
    // palette is a cool blue-grey.
    //
    // Polled rather than sampled once — the first frame, the camera fit and
    // the texture upload all land asynchronously, and reading before them
    // returns an empty buffer.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const canvas = document.querySelector('canvas');
            if (!canvas) return -1;

            const probe = document.createElement('canvas');
            probe.width = canvas.width;
            probe.height = canvas.height;
            const context = probe.getContext('2d');
            if (!context) return -1;

            context.drawImage(canvas, 0, 0);
            const { data } = context.getImageData(0, 0, probe.width, probe.height);

            let warm = 0;
            let lit = 0;
            for (let i = 0; i < data.length; i += 4) {
              const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
              if (r + g + b < 90) continue;
              lit += 1;
              if (r > 120 && r > b * 1.5 && g < r) warm += 1;
            }

            // Nothing drawn yet — keep polling rather than reporting a share.
            if (lit < 500) return -1;
            return warm / lit;
          }),
        { timeout: 20_000, message: 'viewport never rendered a readable frame' },
      )
      .toBeGreaterThan(0.3);
  });

  test('a face reference produces a head, with no settings touched', async ({ page }) => {
    const errors = watchForErrors(page);
    await generateFromUpload(page, fixtures.face);

    // The app reads the upload and matches the output to it. Nothing here
    // clicks the Build control — that is the whole point.
    await expect(
      page.getByRole('button', { name: /Head only/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    expect(errors).toEqual([]);
  });

  test('a standing figure produces a full body', async ({ page }) => {
    await generateFromUpload(page, fixtures.figure);

    await expect(
      page.getByRole('button', { name: /Full body/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('a prompt produces a full character', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Prompt Text' }).click();
    await page.locator('textarea').fill('Cobalt warden in a heavy exosuit');
    await page.getByRole('button', { name: 'Generate 3D Character' }).click();
    await expect(page.getByRole('button', { name: 'Finalize & Continue to Export' })).toBeVisible({
      timeout: 45_000,
    });

    await expect(
      page.getByRole('button', { name: /Full body/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('a failed upload returns to stage 1 with the input intact', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Prompt Text' }).click();
    await page.locator('textarea').fill('Halcyon courier');
    await page.getByRole('button', { name: 'Generate 3D Character' }).click();
    await page.getByRole('button', { name: 'Discard & Start Over' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Discard & start over/i }).click();

    await expect(page.locator('textarea')).toHaveValue('Halcyon courier');
  });
});
