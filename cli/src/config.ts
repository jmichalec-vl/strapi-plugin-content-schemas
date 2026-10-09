import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CliConfig {
  readonly url?: string;
  readonly output?: string;
  readonly target?: string;
  readonly nullableStyle?: string;
  readonly populate?: boolean;
  readonly client?: boolean;
  readonly jsdoc?: boolean;
  readonly mocks?: boolean;
  readonly prettier?: boolean;
  readonly watchInterval?: number;
}

export const defineConfig = (config: CliConfig): CliConfig => config;

const CONFIG_FILE_NAMES = [
  'content-schemas.config.ts',
  'content-schemas.config.js',
  'content-schemas.config.mjs',
] as const;

// All config flavors load through jiti: a native import() cannot load a .ts
// config without a loader, and routing .js/.mjs through the same path keeps
// one behaviour (interop, error messages) for every flavor
const loadModule = async (filePath: string): Promise<Record<string, unknown>> => {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(__filename);
  return (await jiti.import(filePath)) as Record<string, unknown>;
};

export const loadConfig = async (cwd: string = process.cwd()): Promise<CliConfig | null> => {
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = path.resolve(cwd, fileName);
    if (!fs.existsSync(filePath)) continue;

    try {
      const mod = await loadModule(filePath);
      const config = mod.default ?? mod;
      // stderr: `hash` promises a bare hash on stdout for script consumption
      console.error(`Loaded config from ${fileName}`);
      return config as CliConfig;
    } catch (err) {
      throw new Error(`Failed to load config from ${fileName}: ${(err as Error).message}`);
    }
  }

  return null;
};
