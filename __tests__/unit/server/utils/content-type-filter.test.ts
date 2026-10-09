import { describe, it, expect } from 'vitest';

import { matchesUidPattern } from '../../../../server/src/utils/content-type-filter';

describe('matchesUidPattern', () => {
  it('matches wildcard pattern api::*', () => {
    expect(matchesUidPattern('api::article.article', ['api::*'])).toBe(true);
    expect(matchesUidPattern('api::page.page', ['api::*'])).toBe(true);
  });

  it('does not match non-api UIDs with api::* pattern', () => {
    expect(matchesUidPattern('admin::user', ['api::*'])).toBe(false);
    expect(matchesUidPattern('plugin::upload.file', ['api::*'])).toBe(false);
  });

  it('matches exact UID', () => {
    expect(matchesUidPattern('api::article.article', ['api::article.article'])).toBe(true);
    expect(matchesUidPattern('api::page.page', ['api::article.article'])).toBe(false);
  });

  it('matches partial wildcard', () => {
    expect(matchesUidPattern('api::article.article', ['api::article.*'])).toBe(true);
    expect(matchesUidPattern('api::page.page', ['api::article.*'])).toBe(false);
  });

  it('matches against multiple patterns', () => {
    const patterns = ['api::article.*', 'plugin::upload.*'];

    expect(matchesUidPattern('api::article.article', patterns)).toBe(true);
    expect(matchesUidPattern('plugin::upload.file', patterns)).toBe(true);
    expect(matchesUidPattern('admin::user', patterns)).toBe(false);
  });

  it('returns false for empty patterns array', () => {
    expect(matchesUidPattern('api::article.article', [])).toBe(false);
  });
});
