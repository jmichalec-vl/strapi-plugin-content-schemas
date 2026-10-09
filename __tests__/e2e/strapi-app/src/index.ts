import fs from 'node:fs';
import path from 'node:path';

const ADMIN_USER = {
  username: 'admin',
  email: 'admin@test.com',
  password: 'Admin1234!',
  firstname: 'Test',
  lastname: 'Admin',
};

const depth = __dirname.includes(path.join('dist', 'src')) ? 2 : 1;
const appRoot = path.resolve(__dirname, ...Array.from({ length: depth }, () => '..'));
const TOKEN_FILE = path.join(appRoot, '.tmp', 'api-token.txt');

const ensureAdminUser = async (strapi: any): Promise<void> => {
  const existingAdmin = await strapi.db.query('admin::user').findOne({
    where: { email: ADMIN_USER.email },
  });
  if (existingAdmin) return;

  const superAdminRole = await strapi.db.query('admin::role').findOne({
    where: { code: 'strapi-super-admin' },
  });
  if (!superAdminRole) return;

  const hashedPassword = await strapi.service('admin::auth').hashPassword(ADMIN_USER.password);
  await strapi.db.query('admin::user').create({
    data: {
      ...ADMIN_USER,
      password: hashedPassword,
      isActive: true,
      blocked: false,
      roles: [superAdminRole.id],
    },
  });
};

const ensureApiToken = async (strapi: any): Promise<void> => {
  if (fs.existsSync(TOKEN_FILE)) return;

  const tokenService = strapi.service('admin::api-token');
  const token = await tokenService.create({
    name: 'e2e-test-token',
    description: 'Token for e2e tests',
    type: 'full-access',
    lifespan: null,
  });
  fs.writeFileSync(TOKEN_FILE, token.accessKey, 'utf-8');
};

export default {
  async bootstrap({ strapi }: { strapi: any }) {
    await ensureAdminUser(strapi);
    await ensureApiToken(strapi);
  },
};
