import { describe, it, expect } from 'vitest';

import { isVersionMismatch } from '../../../cli/src/version';

describe('isVersionMismatch', () => {
  it('matches when majors agree on the 1.x+ line regardless of minor', () => {
    expect(isVersionMismatch('1.2.3', '1.5.0')).toBe(false);
  });

  it('mismatches on differing majors', () => {
    expect(isVersionMismatch('1.0.0', '2.0.0')).toBe(true);
  });

  it('mismatches on differing minors when both majors are 0', () => {
    expect(isVersionMismatch('0.3.0', '0.4.0')).toBe(true);
  });

  it('matches on the same 0.x minor regardless of patch', () => {
    expect(isVersionMismatch('0.3.1', '0.3.9')).toBe(false);
  });

  it('mismatches when only one side is on the 0.x line', () => {
    expect(isVersionMismatch('0.3.0', '1.0.0')).toBe(true);
  });
});
