import { fetchOk } from './http';

export interface ServerManifest {
  // Optional because older plugin versions may respond without a hash
  readonly hash?: string;
  readonly pluginVersion?: string;
  readonly schemaFormatVersion?: number;
}

export const fetchManifest = async (url: string, token: string): Promise<ServerManifest> => {
  const manifestUrl = `${url.replace(/\/$/, '')}/api/content-schemas/manifest`;
  const body = await fetchOk('manifest', manifestUrl, token, 'application/json');
  return JSON.parse(body.toString('utf-8')) as ServerManifest;
};
