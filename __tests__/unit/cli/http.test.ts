import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';

import { describeHttpFailure, fetchOk, HttpError } from '../../../cli/src/http';

const response = (status: number, body: string, location?: string) => ({
  status,
  location,
  body: Buffer.from(body),
});

describe('describeHttpFailure', () => {
  it('surfaces the Strapi error envelope message', () => {
    const message = describeHttpFailure(
      'schemas',
      'http://x/api',
      response(400, JSON.stringify({ error: { message: 'Invalid target: "yup"' } })),
    );

    expect(message).toBe(
      'HTTP 400: failed to fetch schemas from http://x/api: Invalid target: "yup"',
    );
  });

  it('includes a bounded excerpt of a non-JSON body', () => {
    const message = describeHttpFailure('schemas', 'http://x/api', response(502, 'x'.repeat(500)));

    expect(message).toContain('HTTP 502');
    expect(message.length).toBeLessThan(300);
    expect(message.endsWith('...')).toBe(true);
  });

  it('hints at the final URL on redirects', () => {
    const message = describeHttpFailure(
      'manifest',
      'http://x/api',
      response(301, '', 'https://x/api'),
    );

    expect(message).toContain('redirected to https://x/api');
    expect(message).toContain('https:// instead of http://');
  });

  it('keeps the message bare when the body is empty', () => {
    expect(describeHttpFailure('schemas', 'http://x/api', response(404, ''))).toBe(
      'HTTP 404: failed to fetch schemas from http://x/api',
    );
  });
});

describe('fetchOk', () => {
  let server: http.Server | undefined;

  const listen = (handler: http.RequestListener): Promise<string> =>
    new Promise((resolve) => {
      server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        resolve(`http://127.0.0.1:${port}`);
      });
    });

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it('returns the body for a 200 and sends the bearer token', async () => {
    let seenAuth: string | undefined;
    const base = await listen((req, res) => {
      seenAuth = req.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });

    const body = await fetchOk('manifest', `${base}/m`, 'secret', 'application/json');

    expect(body.toString('utf-8')).toBe('{"ok":true}');
    expect(seenAuth).toBe('Bearer secret');
  });

  it('throws an HttpError carrying the status for non-200 responses', async () => {
    const base = await listen((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Forbidden' } }));
    });

    await expect(fetchOk('manifest', `${base}/m`, 't', 'application/json')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HttpError && error.status === 403 && error.message.includes('Forbidden'),
    );
  });
});
