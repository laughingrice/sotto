import { readFile } from 'node:fs/promises';
const fixture = JSON.parse(await readFile(new URL('./fixtures/julia-florida.sotto.json', import.meta.url), 'utf8'));

// Legacy repeat/meter regression fixture is test data, outside public/.
// Seed the existing single-song resume slot instead of publishing it or adding
// a bookmark that would change the library counts under test.
export async function openPracticeFixture(page) {
  await page.getByRole('heading', { name: 'Étude Op. 60 No. 1', exact: true }).waitFor();
  await page.evaluate(async score => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('sotto-library'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('library', 'readwrite');
      transaction.objectStore('library').put({ key: 'builtin:julia-florida', score }, 'last-score');
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    });
    db.close(); localStorage.setItem('sotto.session', JSON.stringify({ score: 'builtin:julia-florida' }));
  }, fixture);
  await page.reload();
  await page.getByRole('heading', { name: 'Julia Florida', exact: true }).waitFor();
}
