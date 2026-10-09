import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { watch } from '../../../cli/src/watch';
import { pull } from '../../../cli/src/pull';
import { fetchManifest } from '../../../cli/src/manifest';
import { HttpError } from '../../../cli/src/http';

vi.mock('../../../cli/src/pull', () => ({ pull: vi.fn() }));
vi.mock('../../../cli/src/manifest', () => ({ fetchManifest: vi.fn() }));

const INTERVAL_MS = 1000;

const startWatch = (): void => {
  // watch() never resolves (it blocks until SIGINT); the returned promise is
  // intentionally left pending
  void watch('http://x', 't', './out', '', false, INTERVAL_MS, 'valibot');
};

describe('watch', () => {
  let calls: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(pull).mockImplementation(async () => {
      calls.push('pull');
      return 'hash';
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('takes the baseline hash before the initial pull so no change is missed', async () => {
    vi.mocked(fetchManifest).mockImplementation(async () => {
      calls.push('manifest');
      return { hash: 'h1' };
    });

    startWatch();
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual(['manifest', 'pull']);
  });

  it('re-pulls when the manifest hash changes', async () => {
    vi.mocked(fetchManifest)
      .mockResolvedValueOnce({ hash: 'h1' })
      .mockResolvedValueOnce({ hash: 'h1' })
      .mockResolvedValueOnce({ hash: 'h2' });

    startWatch();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(pull).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(pull).toHaveBeenCalledTimes(2);
  });

  it('explains a permission failure instead of blaming the plugin version', async () => {
    vi.mocked(fetchManifest).mockRejectedValue(new HttpError('HTTP 403', 403));

    startWatch();
    await vi.advanceTimersByTimeAsync(0);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('lacks permission'));
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('predate'));
  });

  it('suggests an old plugin on 404', async () => {
    vi.mocked(fetchManifest).mockRejectedValue(new HttpError('HTTP 404', 404));

    startWatch();
    await vi.advanceTimersByTimeAsync(0);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('predate'));
  });

  it('logs a repeating poll error once until it changes', async () => {
    vi.mocked(fetchManifest)
      .mockResolvedValueOnce({ hash: 'h1' })
      .mockRejectedValue(new Error('ECONNREFUSED'));

    startWatch();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    const pollErrors = vi
      .mocked(console.error)
      .mock.calls.filter(([line]) => String(line).startsWith('Poll error'));
    expect(pollErrors).toHaveLength(1);
  });
});
