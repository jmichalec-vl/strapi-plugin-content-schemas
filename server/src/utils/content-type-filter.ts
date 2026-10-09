const escapeRegex = (pattern: string): string => pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const globToRegex = (pattern: string): RegExp => {
  const regexStr = escapeRegex(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${regexStr}$`);
};

export const matchesUidPattern = (uid: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => globToRegex(pattern).test(uid));
