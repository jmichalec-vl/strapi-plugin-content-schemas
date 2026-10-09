import { spawn, execSync, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const STRAPI_APP_DIR = path.resolve(__dirname, '..', 'strapi-app');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.resolve(STRAPI_APP_DIR, '.tmp', 'data.db');
const GENERATED_VALIBOT_DIR = path.resolve(STRAPI_APP_DIR, '.tmp', 'generated-valibot');
const GENERATED_ZOD_DIR = path.resolve(STRAPI_APP_DIR, '.tmp', 'generated-zod');
const SEED_FILE = path.resolve(STRAPI_APP_DIR, '.tmp', 'seed-ids.json');
const TOKEN_PATH = path.resolve(STRAPI_APP_DIR, '.tmp', 'api-token.txt');
const CLI_PATH = path.resolve(PLUGIN_ROOT, 'dist', 'cli', 'index.js');
const BASE_URL = process.env.STRAPI_URL ?? 'http://127.0.0.1:1337';
const STARTUP_TIMEOUT_MS = 120_000;

let strapiProcess: ChildProcess | null = null;

const waitForHealth = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now();

    const check = async () => {
      if (Date.now() - start > STARTUP_TIMEOUT_MS) {
        reject(new Error('Strapi did not start within timeout'));
        return;
      }

      try {
        const response = await fetch(`${BASE_URL}/_health`);
        if (response.status === 204) {
          resolve();
          return;
        }
      } catch {
        // Not ready yet
      }

      setTimeout(check, 1_000);
    };

    check();
  });

const waitForFile = (filePath: string, label: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > 30_000) {
        reject(new Error(`${label} did not complete within timeout`));
        return;
      }
      if (fs.existsSync(filePath)) {
        resolve();
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });

export const setup = async (): Promise<void> => {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }

  if (fs.existsSync(GENERATED_VALIBOT_DIR)) {
    fs.rmSync(GENERATED_VALIBOT_DIR, { recursive: true, force: true });
  }

  if (fs.existsSync(GENERATED_ZOD_DIR)) {
    fs.rmSync(GENERATED_ZOD_DIR, { recursive: true, force: true });
  }

  if (fs.existsSync(SEED_FILE)) {
    fs.unlinkSync(SEED_FILE);
  }

  console.log('[strapi] Starting Strapi in dev mode...');

  strapiProcess = spawn('npx', ['strapi', 'develop'], {
    cwd: STRAPI_APP_DIR,
    env: { ...process.env, NODE_ENV: 'development', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  strapiProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) process.stdout.write(`[strapi] ${line}\n`);
  });

  strapiProcess.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) process.stderr.write(`[strapi:err] ${line}\n`);
  });

  strapiProcess.on('error', (err) => {
    console.error('[strapi] Process error:', err);
  });

  await waitForHealth();
  console.log('[strapi] Health check passed. Waiting for API token...');

  await waitForFile(TOKEN_PATH, 'API token creation');
  const token = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();

  console.log('[strapi] Pulling valibot schemas via CLI...');
  execSync(
    `node ${CLI_PATH} pull --url ${BASE_URL} --token ${token} --output ${GENERATED_VALIBOT_DIR} --target valibot --jsdoc --mocks --prettier`,
    { stdio: 'inherit', cwd: STRAPI_APP_DIR },
  );

  console.log('[strapi] Pulling zod schemas via CLI...');
  execSync(
    `node ${CLI_PATH} pull --url ${BASE_URL} --token ${token} --output ${GENERATED_ZOD_DIR} --target zod --jsdoc --prettier`,
    { stdio: 'inherit', cwd: STRAPI_APP_DIR },
  );

  console.log('[strapi] Schema generation complete (both targets).');
};

export const teardown = async (): Promise<void> => {
  if (!strapiProcess) return;

  return new Promise((resolve) => {
    strapiProcess!.on('close', () => {
      strapiProcess = null;
      resolve();
    });

    strapiProcess!.kill('SIGTERM');

    setTimeout(() => {
      if (strapiProcess) {
        strapiProcess.kill('SIGKILL');
      }
    }, 5_000);
  });
};
