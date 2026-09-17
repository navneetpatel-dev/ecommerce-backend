'use strict';

/**
 * typescript-eslint 8 still requires the TypeScript 6 programmatic API.
 * Keep `typescript@7` for `tsc`; resolve `require('typescript')` to
 * `@typescript/typescript6` only while ESLint is running.
 */
const Module = require('module');
const originalLoad = Module._load;

Module._load = function loadTypescript6(request, parent, isMain) {
  if (request === 'typescript') {
    return originalLoad.call(this, '@typescript/typescript6', parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
