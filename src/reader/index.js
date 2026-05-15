// Reader view public surface. Controller owns the orchestration; this
// file just re-exports so main.js can `import('./reader/index.js')`.

export { startReader, stopReader, rebuild } from './controller.js';
