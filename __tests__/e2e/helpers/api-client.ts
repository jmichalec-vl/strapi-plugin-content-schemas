import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE_URL = process.env.STRAPI_URL ?? 'http://127.0.0.1:1337';

const ADMIN_CREDENTIALS = {
  email: 'admin@test.com',
  password: 'Admin1234!',
} as const;

const TEST_IMAGE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let cachedAdminToken: string | null = null;
let cachedApiToken: string | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const request = async (
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; data: unknown }> => {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cachedAdminToken ? { Authorization: `Bearer ${cachedAdminToken}` } : {}),
      ...options.headers,
    },
  });

  const data = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : null;

  return { status: response.status, data };
};

export const login = async (retries = 3): Promise<string> => {
  if (cachedAdminToken) return cachedAdminToken;

  for (let attempt = 0; attempt < retries; attempt++) {
    const { status, data } = await request('/admin/login', {
      method: 'POST',
      body: JSON.stringify(ADMIN_CREDENTIALS),
    });

    if (status === 429) {
      await sleep((attempt + 1) * 2000);
      continue;
    }

    const token = (data as { data?: { token?: string } })?.data?.token;
    if (!token) {
      throw new Error(`Login failed (${status}): ${JSON.stringify(data)}`);
    }

    cachedAdminToken = token;
    return token;
  }

  throw new Error('Login failed: rate limited after all retries');
};

export const getApiToken = (): string => {
  if (cachedApiToken) return cachedApiToken;

  const tokenFile = path.resolve(__dirname, '..', 'strapi-app', '.tmp', 'api-token.txt');

  if (!fs.existsSync(tokenFile)) {
    throw new Error(`API token file not found at ${tokenFile}. Check bootstrap.`);
  }

  const token = fs.readFileSync(tokenFile, 'utf-8').trim();
  cachedApiToken = token;
  return token;
};

export const uploadFile = async (name = 'test-image.png'): Promise<number> => {
  const blob = new Blob([TEST_IMAGE_PNG], { type: 'image/png' });
  const formData = new FormData();
  formData.append('files', blob, name);
  formData.append(
    'fileInfo',
    JSON.stringify({ name, alternativeText: 'Test image', caption: 'Test' }),
  );

  const response = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cachedAdminToken}` },
    body: formData,
  });

  const result = (await response.json()) as Array<{ id: number }>;
  if (!result?.[0]?.id) {
    throw new Error(`Upload failed: ${JSON.stringify(result)}`);
  }

  return result[0].id;
};

const CM_BASE = '/content-manager/collection-types';

export const createEntry = async (
  uid: string,
  data: Record<string, unknown>,
): Promise<{ documentId: string }> => {
  const { status, data: result } = await adminApi.post(`${CM_BASE}/${uid}`, data);
  const entry = (result as { data?: { documentId: string } })?.data;
  if (!entry?.documentId) {
    throw new Error(`Create ${uid} failed (${status}): ${JSON.stringify(result).slice(0, 500)}`);
  }
  return entry;
};

export const publishEntry = async (uid: string, documentId: string): Promise<void> => {
  await adminApi.post(`${CM_BASE}/${uid}/${documentId}/actions/publish`);
};

export const updateSingleType = async (
  uid: string,
  data: Record<string, unknown>,
): Promise<void> => {
  const { status, data: result } = await adminApi.put(`/content-manager/single-types/${uid}`, data);
  if (status >= 400) {
    throw new Error(`Update ${uid} failed (${status}): ${JSON.stringify(result).slice(0, 500)}`);
  }
};

export const adminApi = {
  get: (path: string) => request(path),
  post: (path: string, body?: unknown) =>
    request(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: (path: string, body?: unknown) =>
    request(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
} as const;

export const getBaseUrl = (): string => BASE_URL;
