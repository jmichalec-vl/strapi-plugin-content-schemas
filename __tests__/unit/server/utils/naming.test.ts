import { describe, it, expect } from 'vitest';

import { escapeSingleQuoted, escapeTemplateLiteral } from '../../../../server/src/utils/naming';

describe('escapeSingleQuoted', () => {
  it('escapes backslashes and single quotes', () => {
    expect(escapeSingleQuoted(`it's a \\ path`)).toBe(`it\\'s a \\\\ path`);
  });

  it('escapes every line terminator JS recognizes so the literal cannot end early', () => {
    expect(escapeSingleQuoted('a\nb\rc d e')).toBe('a\\nb\\rc\\u2028d\\u2029e');
  });

  it('round-trips through evaluation', () => {
    const value = "multi\nline 'quoted'   \\ value";
    const literal = `'${escapeSingleQuoted(value)}'`;
    expect(new Function(`return ${literal};`)()).toBe(value);
  });
});

describe('escapeTemplateLiteral', () => {
  it('escapes backticks and interpolation openers', () => {
    expect(escapeTemplateLiteral('/x/`${evil}`')).toBe('/x/\\`\\${evil}\\`');
  });

  it('round-trips through evaluation', () => {
    const value = '/page/`${slug}`/\\end';
    const literal = `\`${escapeTemplateLiteral(value)}\``;
    expect(new Function(`return ${literal};`)()).toBe(value);
  });
});
