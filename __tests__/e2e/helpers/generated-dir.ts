import path from 'node:path';

const TMP_DIR = path.resolve(__dirname, '..', 'strapi-app', '.tmp');

export const VALIBOT_DIR = path.resolve(TMP_DIR, 'generated-valibot');
export const ZOD_DIR = path.resolve(TMP_DIR, 'generated-zod');

// Default for agnostic tests - uses valibot output
export const GENERATED_DIR = VALIBOT_DIR;
