export default {
  type: 'admin',
  routes: [
    {
      method: 'GET',
      path: '/status',
      handler: 'content-schemas.getStatus',
      config: {
        policies: [],
      },
    },
  ],
};
