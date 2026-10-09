import * as http from 'node:http';
import * as https from 'node:https';

import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS } from './constants';

const HTTP_OK = 200;
const REDIRECT_RANGE = { min: 300, max: 399 } as const;
// Enough of an error page to be useful, not enough to flood the terminal
const BODY_EXCERPT_LENGTH = 200;

export interface HttpResponse {
  readonly status: number;
  readonly location: string | undefined;
  readonly body: Buffer;
}

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

// Strapi wraps errors as { error: { message } }; anything else is shown raw
const extractErrorDetail = (body: Buffer): string | undefined => {
  const text = body.toString('utf-8').trim();
  if (text === '') return undefined;
  try {
    const parsed = JSON.parse(text) as { readonly error?: { readonly message?: unknown } };
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
  } catch {
    // not JSON - fall through to the raw excerpt
  }
  return text.length > BODY_EXCERPT_LENGTH ? `${text.slice(0, BODY_EXCERPT_LENGTH)}...` : text;
};

export const describeHttpFailure = (what: string, url: string, response: HttpResponse): string => {
  const base = `HTTP ${response.status}: failed to fetch ${what} from ${url}`;
  if (response.status >= REDIRECT_RANGE.min && response.status <= REDIRECT_RANGE.max) {
    const target = response.location ? ` to ${response.location}` : '';
    return `${base} (redirected${target} - use the final URL, e.g. https:// instead of http://)`;
  }
  const detail = extractErrorDetail(response.body);
  return detail ? `${base}: ${detail}` : base;
};

export const httpGet = (url: string, token: string, accept: string): Promise<HttpResponse> =>
  new Promise((resolve, reject) => {
    const client = new URL(url).protocol === 'https:' ? https : http;

    const req = client.get(
      url,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: accept },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            req.destroy(new Error(`Response from ${url} exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request to ${url} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
    });
    req.on('error', reject);
  });

export const fetchOk = async (
  what: string,
  url: string,
  token: string,
  accept: string,
): Promise<Buffer> => {
  const response = await httpGet(url, token, accept);
  if (response.status !== HTTP_OK) {
    throw new HttpError(describeHttpFailure(what, url, response), response.status);
  }
  return response.body;
};
