// Loads src/js/core.js (a classic browser script) into a node vm sandbox and returns OP.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export function loadCore(file, extra = {}) {
  const code = fs.readFileSync(file, 'utf8');
  return vm.runInNewContext(code + '\n;OP', { URL, setTimeout, clearTimeout, console, Promise, ...extra });
}
export const coreFile = (root) => path.join(root, 'src/js/core.js');
