import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const source = arg('--score');
if (!source) throw new Error('Pass --score path/to/piece.sotto.json');
const text = await readFile(source, 'utf8'), score = JSON.parse(text);
const browser = await chromium.launch({ headless: true, executablePath: arg('--chrome') || process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.noteStarts = 0;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) { if (this.buffer?.duration > .1 && !this.loop) window.noteStarts++; return start.apply(this, args); };
});
const button = name => page.getByRole('button', { name, exact: true });
await mkdir('test-results', { recursive: true });
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4176/sotto/');
  await page.getByRole('heading', { name: 'Julia Florida', exact: true }).waitFor();
  await page.locator('[data-score-input]').setInputFiles({ name: source.split('/').at(-1), mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.getByRole('heading', { name: score.title, exact: true }).waitFor();
  assert.equal(await page.locator('.score-page svg').count(), score.pages.length);
  assert.equal(await page.locator('.score-note').count(), score.notes.length);
  assert.deepEqual(await page.locator('.voice-heading strong').allTextContents(), score.voices.map(voice => voice.name));
  assert.equal(await page.locator('.score-pages').evaluate(root => root.textContent.includes('Julia Florida')), false, 'Imported engraving replaces Julia');
  for (const voice of score.voices) {
    await button(`Mute ${voice.name.toLowerCase()}`).click();
    assert.equal(await page.locator(`.score-note.voice-muted[data-voice="${voice.id}"]`).count(), score.notes.filter(note => note.voice === voice.id).length);
    await button(`Unmute ${voice.name.toLowerCase()}`).click();
  }
  await button(`Solo ${score.voices[0].name.toLowerCase()}`).click();
  assert.equal(await page.locator(`.score-note.voice-muted[data-voice="${score.voices[0].id}"]`).count(), 0);
  assert.ok(await page.locator('.score-note.voice-muted').count() > 0, 'Solo keeps the other part independent');
  await button('Restore all voices').click();
  assert.equal(await page.locator('.measure-readout strong').innerText(), `0 / ${score.bars.at(-1).label}`, 'Pickup starts at bar zero');
  await button('Next measure').click();
  assert.ok((await page.locator('.measure-readout strong').innerText()).startsWith('1 /'), 'First full measure is bar one');
  await button('Restart').click();
  await button('Sound and metronome settings').click();
  assert.equal(await page.getByRole('checkbox', { name: 'One-bar count-in', exact: true }).isChecked(), true, 'Count-in defaults on');
  await page.getByRole('checkbox', { name: 'One-bar count-in', exact: true }).uncheck();
  await page.getByRole('combobox', { name: 'Playback instrument', exact: true }).selectOption('violin');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Playback instrument"]').disabled);
  assert.equal(await page.getByRole('combobox', { name: 'Playback octave', exact: true }).inputValue(), '0');
  await button('Back to the music').click();
  assert.ok(Number(await page.getByRole('slider', { name: 'Tempo', exact: true }).getAttribute('max')) >= 220);
  await page.getByRole('slider', { name: 'Tempo', exact: true }).fill('168');
  assert.equal(await page.getByRole('slider', { name: 'Tempo', exact: true }).inputValue(), '168', 'Spring can be practiced at 168 BPM');
  await page.getByTitle('Reset to score tempo').click();
  await button('Play score').click(); await button('Pause playback').waitFor();
  await page.waitForTimeout(700); await button('Pause playback').click();
  assert.ok(await page.evaluate(() => window.noteStarts) >= 4, 'Violin recordings play the imported parts');
  await page.screenshot({ path: 'test-results/imported-parts.png' });
  await page.reload(); await page.getByRole('heading', { name: score.title, exact: true }).waitFor();
  assert.equal(await page.locator('.score-note').count(), score.notes.length, 'Last-song resume keeps the corrected engraving');
  assert.deepEqual(errors, []);
  console.log(`PASS: ${score.title}, ${score.pages.length} pages, ${score.notes.length} noteheads, separate parts, mute/solo, violin playback and resume.`);
} catch (error) { await page.screenshot({ path: 'test-results/score-load-failure.png' }); throw error; }
finally { await browser.close(); }
