const transformValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(transformValue);
  if (typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && isRichtextField(key)) {
      result[key] = { html: val, meta: {} };
    } else {
      result[key] = transformValue(val);
    }
  }

  return result;
};

const RICHTEXT_FIELD_NAMES = new Set([
  'content',
  'body',
  'bio',
  'subtitle',
  'bottomText',
  'copyrightNotice',
  'answer',
  'sectionContent',
]);

const isRichtextField = (fieldName: string): boolean => RICHTEXT_FIELD_NAMES.has(fieldName);

export default () => async (ctx: any, next: () => Promise<void>) => {
  await next();

  if (!ctx.url.startsWith('/api/') || ctx.method !== 'GET') return;
  if (!ctx.body?.data) return;

  ctx.body = {
    ...ctx.body,
    data: transformValue(ctx.body.data),
  };
};
