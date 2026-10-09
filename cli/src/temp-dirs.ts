import * as fs from 'node:fs';

// Staging and candidate directories live inside the consumer's source tree
// (a hidden sibling of the output dir). A Ctrl+C mid-run must not leave them
// behind as untracked clutter, so every one is registered here until removed.
const EXIT_CODE_SIGINT = 130;
const registered = new Set<string>();
let handlerInstalled = false;

const removeAll = (): void => {
  for (const dir of registered) fs.rmSync(dir, { recursive: true, force: true });
  registered.clear();
};

const installHandler = (): void => {
  if (handlerInstalled) return;
  handlerInstalled = true;
  process.once('SIGINT', () => {
    removeAll();
    process.exit(EXIT_CODE_SIGINT);
  });
};

export const registerTempDir = (dir: string): void => {
  installHandler();
  registered.add(dir);
};

export const removeTempDir = (dir: string): void => {
  fs.rmSync(dir, { recursive: true, force: true });
  registered.delete(dir);
};
