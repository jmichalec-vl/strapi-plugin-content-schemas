export default {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/schemas',
      handler: 'content-schemas.getSchemas',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/manifest',
      handler: 'content-schemas.getManifest',
      config: {
        policies: [],
      },
    },
  ],
};
