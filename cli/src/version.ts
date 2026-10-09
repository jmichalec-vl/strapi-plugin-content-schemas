import * as fs from 'node:fs';
import * as path from 'node:path';

// The CLI is compiled file-by-file, so this module sits two levels below the
// package root both in source (cli/src) and in the build output (dist/cli)
const PACKAGE_JSON_PATH = path.resolve(__dirname, '..', '..', 'package.json');

const readCliVersion = (): string | null => {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
      readonly name?: string;
      readonly version?: string;
    };
    return pkg.name === 'strapi-plugin-content-schemas' && pkg.version ? pkg.version : null;
  } catch {
    return null;
  }
};

export const CLI_VERSION = readCliVersion();

// Semver treats 0.x minor bumps as breaking, so the 0.x line compares minors
export const isVersionMismatch = (cliVersion: string, pluginVersion: string): boolean => {
  const [cliMajor, cliMinor] = cliVersion.split('.');
  const [pluginMajor, pluginMinor] = pluginVersion.split('.');
  if (cliMajor !== pluginMajor) return true;
  return cliMajor === '0' && cliMinor !== pluginMinor;
};
