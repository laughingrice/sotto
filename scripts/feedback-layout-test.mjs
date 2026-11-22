/** Real-browser regression: paired notes/tabs, ledger notes, reserved feedback
 * space and reversible layout. Run against the local Sotto dev/preview server. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const i = process.argv.indexOf('--chrome');
const browser = await chromium.launch({ headless: true, executablePath: i < 0 ? process.env.CHROME_PATH : process.argv[i + 1] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const notes = Array.from({ length: 8 }, (_, i) => ({ id: `layout-note-${i}`, voice: 'guitar', beat: i * 2, duration: 1,
  grace: 0, midi: 64, bar: Math.floor(i / 2) + 1, measure: Math.floor(i / 2), tie: false }));
function svg(view) {
  let content = '';
  for (let row = 0; row < 2; row++) {
    const y = 35 + row * 100;
    const kinds = view === 'both' ? ['notation', 'tabs'] : [view];
    for (const [staff, kind] of kinds.entries()) {
      const top = y + staff * 20;
      content += `<g class="sotto-staff-geometry" data-system="${row}">${Array.from({ length: kind === 'tabs' ? 6 : 5 }, (_, line) => `<path d="M10 ${top + line}H150" stroke="black" stroke-width=".1"/>`).join('')}</g>`;
      for (let n = row * 4; n < row * 4 + 4; n++) {
        // A high notation note is deliberately outside the staff's padding.
        const cy = kind === 'tabs' ? top + 2 : top + (n % 4 === 0 ? -18 : 2);
        content += `<g id="${kind}-${n}" class="score-note" data-event-id="layout-note-${n}" data-voice="guitar"><circle cx="${[22, 58, 92, 128][n % 4]}" cy="${cy}" r="1"/></g>`;
      }
    }
    for (const [boundary, x] of [[row * 2 + 1, 80], [row * 2 + 2, 150]]) content += `<g class="sotto-bar-boundary" data-system="${row}" data-boundary="${boundary}"><rect x="${x}" y="${y}" width=".1" height="${view === 'both' ? 25 : 5}"/></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 220"><g transform="translate(2 2)">${content}</g></svg>`;
}
const fixture = { format: 'sotto-score', version: 1, title: 'Feedback layout regression', composer: '', subtitle: '', description: '',
  voices: [{ id: 'guitar', name: 'Guitar', color: '#31745e' }], notes, bpm: 100, beatUnit: 1, beatsPerBar: 4,
  bars: Array.from({ length: 4 }, (_, index) => ({ index, label: String(index + 1), start: index * 4, duration: 4, meter: [4, 4] })),
  sequence: [0, 1, 2, 3], pages: [svg('notation')], renderings: Object.fromEntries(['notation', 'tabs', 'both'].map(view => [view, { pages: [svg(view)] }])) };
try {
  await page.goto(process.env.BASE_URL || 'http://localhost:4179/sotto/');
  await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  await page.locator('[data-score-input]').setInputFiles({ name: 'feedback-layout.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('heading', { name: fixture.title, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Rhythm feedback', exact: true }).click();
  const view = page.getByRole('combobox', { name: 'Score notation view', exact: true });
  const placement = page.getByRole('combobox', { name: 'Feedback placement', exact: true });
  for (const width of [1440, 768]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const name of ['notation', 'tabs', 'both', 'notation', 'both']) {
      await placement.selectOption('timeline'); await view.selectOption(name);
      const original = await page.locator('.score-page svg').getAttribute('viewBox');
      const positions = () => page.locator('.score-note').evaluateAll(notes => notes.map(note => { const b = note.getBoundingClientRect(); return [b.x, b.y]; }));
      const before = await positions();
      await placement.selectOption('score');
      await page.waitForFunction(() => document.querySelectorAll('.score-feedback-lane').length === 4);
      const problems = await page.evaluate(() => {
        const failures = [];
        for (const lane of document.querySelectorAll('.score-feedback-lane')) {
          const written = Number(lane.dataset.barIndex), rect = document.querySelector(`.current-bar-highlight[data-bar-index="${written}"]`);
          // Inactive highlights have display:none; reveal them for measurement.
          rect.style.display = 'block'; const bar = rect.getBoundingClientRect(), strip = lane.getBoundingClientRect();
          for (const note of document.querySelectorAll('.score-note')) {
            const index = Number(note.dataset.eventId.split('-').at(-1));
            if (Math.floor(index / 2) !== written) continue;
            const ink = note.getBoundingClientRect();
            if (ink.top < bar.top - .1 || ink.bottom > bar.bottom + .1) failures.push(`bar ${written}: highlight missed note ${index}`);
            if (ink.bottom >= strip.top) failures.push(`bar ${written}: feedback overlaps note ${index}`);
          }
          if (strip.top < bar.bottom - .1) failures.push(`bar ${written}: no reserved space`);
          rect.style.removeProperty('display');
        }
        return failures;
      });
      assert.deepEqual(problems, [], `${name} at ${width}px includes both visual copies and high ledger notes`);
      await placement.selectOption('timeline');
      assert.equal(await page.locator('.score-page svg').getAttribute('viewBox'), original);
      const after = await positions();
      assert.equal(after.length, before.length);
      for (let n = 0; n < after.length; n++) for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(before[n][axis] - after[n][axis]) < .1, 'Closing feedback restores the engraving exactly');
    }
  }
  await placement.selectOption('score'); await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/feedback-both-layout-tablet.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: Notes, Tabs and Both include all ledger notes, reserve feedback space and restore geometry without drift at desktop and tablet widths.');
} finally { await browser.close(); }
