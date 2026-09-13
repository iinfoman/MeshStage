import { expect, type Page } from '@playwright/test';

/** Collects anything the browser logged as an error, for a no-noise assertion. */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    // Aborted requests are normal when a stage unmounts mid-flight.
    if (!failure.includes('ABORTED')) {
      errors.push(`request: ${request.url().split('/').pop()} ${failure}`);
    }
  });
  return errors;
}

/** Runs stages 1 and 2, leaving the page on stage 3 with a rigged character. */
export async function generateCharacter(page: Page, prompt?: string) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Prompt Text' }).click();

  if (prompt) {
    await page.locator('textarea').fill(prompt);
  } else {
    await page.getByRole('button', { name: 'Cyberpunk astronaut with a neon visor' }).click();
  }

  await page.getByRole('button', { name: 'Generate 3D Character' }).click();

  // The pipeline is ~8s of simulated work; the CTA appearing is the signal.
  await expect(page.getByRole('button', { name: 'Finalize & Continue to Export' })).toBeVisible({
    timeout: 45_000,
  });
}

/** Satisfies the WebAudio gesture guard if it is showing. */
export async function unlockAudio(page: Page) {
  const overlay = page.getByRole('button', { name: /Tap to Initialize WebAudio/ });
  if (await overlay.isVisible().catch(() => false)) {
    await overlay.click();
    await expect(overlay).toBeHidden();
  }
}

export async function goToExport(page: Page) {
  await page.getByRole('button', { name: 'Finalize & Continue to Export' }).click();
  await expect(page.getByRole('button', { name: /^Download/ })).toBeVisible();
}

/**
 * Picks a card in the format grid.
 *
 * Scoped to the list on purpose: a bare name match also hits the "Download
 * .GLB" CTA in the action bar, which is a different control entirely.
 */
export async function selectFormat(page: Page, formatPattern: RegExp) {
  await page.getByRole('listitem').getByRole('button', { name: formatPattern }).click();
}

/** Selects a format card and runs the export, returning the verification text. */
export async function exportFormat(page: Page, formatPattern: RegExp): Promise<string> {
  await selectFormat(page, formatPattern);
  await page.getByRole('button', { name: /^Download/ }).click();

  const panel = page.getByLabel('Export verification');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  return (await panel.innerText()).replace(/\s+/g, ' ');
}
