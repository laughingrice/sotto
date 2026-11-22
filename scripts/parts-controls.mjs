export async function setPracticeParts(page, ids) {
  const opened = !await page.locator('.parts-panel').isVisible();
  if (opened) await page.getByRole('button', { name: 'Parts and practice', exact: true }).click();
  for (const input of await page.locator('.parts-panel input[data-practice-voice]').all()) {
    const id = await input.getAttribute('data-practice-voice');
    await input.setChecked(ids === 'all' || (Array.isArray(ids) ? ids.includes(id) : ids === id));
  }
  if (opened) await page.getByRole('button', { name: 'Close parts', exact: true }).click();
}
export async function selectedPracticeParts(page) {
  return page.locator('.parts-panel input[data-practice-voice]').evaluateAll(inputs => inputs.filter(input => input.checked).map(input => input.dataset.practiceVoice));
}
export async function selectPartInstrument(page, name, value) {
  const opened = !await page.locator('.parts-panel').isVisible();
  if (opened) await page.getByRole('button', { name: 'Parts and practice', exact: true }).click();
  const details = page.locator('.part-sound').filter({ has: page.locator(`select[aria-label=${JSON.stringify(name + ' instrument')}]`) });
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  await page.getByRole('combobox', { name: name + ' instrument', exact: true }).selectOption(value);
  if (opened) await page.getByRole('button', { name: 'Close parts', exact: true }).click();
}

export async function expandPartSounds(page) {
  for (const details of await page.locator('.parts-panel:visible .part-sound').all()) if (await details.getAttribute('open') === null) await details.locator('summary').click();
}
