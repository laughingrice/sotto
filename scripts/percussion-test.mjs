// Compatibility entry point: verify the exported bass/drum bundle with recorded sounds.
if (process.argv[2] && !process.argv[2].startsWith('--')) process.argv.push('--score', process.argv[2]);
await import('./part-instruments-test.mjs');
