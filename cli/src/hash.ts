import { computeOutputHash, fetchEntries } from './pull';

// Prints ONLY the output hash to stdout - scripts consume it directly
// (publish-or-skip comparisons, mode lines). No filesystem writes.
export const hash = async (url: string, token: string, query: string): Promise<void> => {
  const baseUrl = url.replace(/\/$/, '');
  const entries = await fetchEntries(baseUrl, token, query);
  console.log(computeOutputHash(entries));
};
