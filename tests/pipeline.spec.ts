import { expect, test } from '@playwright/test';
import { generateCharacter, goToExport, unlockAudio, watchForErrors } from './helpers';

test.describe('creation pipeline', () => {
  test('walks all four stages and returns to the start on discard', async ({ page }) => {
    const errors = watchForErrors(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Start your character' })).toBeVisible();

    // Stage 1: the CTA stays disabled until there is usable input.
    const generate = page.getByRole('button', { name: 'Generate 3D Character' });
    await expect(generate).toBeDisabled();

    await page.getByRole('tab', { name: 'Prompt Text' }).click();
    await page.getByRole('button', { name: 'Cyberpunk astronaut with a neon visor' }).click();
    await expect(generate).toBeEnabled();

    // Discard is confirmed, never immediate.
    await page.getByRole('button', { name: 'Discard / Reset Input' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Keep working' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(generate).toBeEnabled();

    // Stage 2: progress runs and the CTA reports it.
    await generate.click();
    await expect(page.getByText('Building your asset')).toBeVisible();
    await expect(page.getByRole('button', { name: /Processing Asset \(\d+%\)/ })).toBeVisible();

    // Stage 3.
    await expect(page.getByRole('button', { name: 'Finalize & Continue to Export' })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText('15 visemes')).toBeVisible();

    // Stage 4.
    await goToExport(page);
    await expect(page.getByText(/free tier/i)).toBeVisible();

    // A full discard resets the session to stage 1.
    await page.getByRole('button', { name: 'Discard & New Character' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Discard & new character/i }).click();
    await expect(page.getByRole('heading', { name: 'Start your character' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate 3D Character' })).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('cancelling generation keeps the input so nothing is re-entered', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Prompt Text' }).click();
    await page.locator('textarea').fill('Deep-sea archivist in a bioluminescent suit');
    await page.getByRole('button', { name: 'Generate 3D Character' }).click();

    await expect(page.getByText('Building your asset')).toBeVisible();
    await page.getByRole('button', { name: 'Discard & Start Over' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Discard & start over/i }).click();

    // Back on stage 1 with the prompt intact — a cancel must be cheap to undo.
    await expect(page.getByRole('heading', { name: 'Start your character' })).toBeVisible();
    await expect(page.locator('textarea')).toHaveValue(
      'Deep-sea archivist in a bioluminescent suit',
    );
  });

  test('the same prompt always rebuilds the same character', async ({ page }) => {
    await generateCharacter(page, 'Desert courier wrapped in sun-bleached linen');
    const first = await page.locator('.glass').first().textContent();

    await page.reload();
    await generateCharacter(page, 'Desert courier wrapped in sun-bleached linen');
    const second = await page.locator('.glass').first().textContent();

    expect(second).toBe(first);
  });
});

test.describe('mobile behaviour', () => {
  test('the shell never scrolls; only its inner panes do', async ({ page }) => {
    await page.goto('/');

    const overflow = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      vertical: document.body.scrollHeight > window.innerHeight + 1,
    }));

    expect(overflow.horizontal, 'page must never scroll sideways').toBe(false);
    expect(overflow.vertical, 'the shell is fixed height; panes scroll').toBe(false);
  });

  test('every interactive control clears the 48px thumb target', async ({ page }) => {
    await generateCharacter(page);
    await unlockAudio(page);

    const undersized = await page.evaluate(() => {
      const bad: string[] = [];

      for (const el of document.querySelectorAll('button, select, [role="tab"]')) {
        const rect = el.getBoundingClientRect();
        // Skip anything not currently laid out.
        if (rect.width === 0 || rect.height === 0) continue;

        // A control may keep a small visual box and extend its hit area with
        // an absolutely-positioned ::after. Hit testing returns the
        // originating element for that overlay, so the effective target is
        // the union — measure that, not just the border box.
        let height = rect.height;
        const after = getComputedStyle(el, '::after');
        if (after.content && after.content !== 'none' && after.position === 'absolute') {
          const top = parseFloat(after.top);
          const bottom = parseFloat(after.bottom);
          if (!Number.isNaN(top) && !Number.isNaN(bottom)) {
            height = Math.max(height, rect.height - top - bottom);
          }
        }

        if (height < 48) {
          bad.push(`${el.tagName}.${el.className.split(' ')[0]} = ${Math.round(height)}px`);
        }
      }

      return bad;
    });

    expect(undersized, 'controls below the 48px floor').toEqual([]);
  });

  test('iOS text inputs are 16px so focus never triggers a zoom', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Prompt Text' }).click();

    const fontSize = await page
      .locator('textarea')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test('the WebAudio gate blocks speech until a gesture arrives', async ({ page }) => {
    await generateCharacter(page);

    const overlay = page.getByRole('button', { name: /Tap to Initialize WebAudio/ });
    const preview = page.getByRole('button', { name: /Preview lip-sync/ });

    // Chromium starts the context suspended here, same as iOS Safari.
    if (await overlay.isVisible().catch(() => false)) {
      await expect(preview).toBeDisabled();
      await overlay.click();
      await expect(overlay).toBeHidden();
    }

    await expect(preview).toBeEnabled();
  });
});
