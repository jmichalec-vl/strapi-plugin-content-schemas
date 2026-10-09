export const createTestContentTypes = () => ({
  'api::article.article': {
    uid: 'api::article.article',
    kind: 'collectionType',
    info: {
      singularName: 'article',
      pluralName: 'articles',
      displayName: 'Article',
    },
    attributes: {
      id: { type: 'integer' },
      documentId: { type: 'string' },
      title: { type: 'string', required: true },
      slug: { type: 'uid', required: true },
      body: { type: 'richtext' },
      excerpt: { type: 'text' },
      email: { type: 'email' },
      published: { type: 'boolean', required: true },
      viewCount: { type: 'integer' },
      rating: { type: 'float' },
      price: { type: 'decimal' },
      publishDate: { type: 'date' },
      publishedAt: { type: 'datetime' },
      readTime: { type: 'time' },
      metadata: { type: 'json' },
      content: { type: 'blocks' },
      status: {
        type: 'enumeration',
        enum: ['draft', 'published', 'archived'],
        required: true,
      },
      coverImage: { type: 'media', multiple: false },
      seo: { type: 'component', component: 'shared.seo', repeatable: false },
      author: {
        type: 'relation',
        relation: 'manyToOne',
        target: 'api::author.author',
      },
      createdAt: { type: 'datetime' },
      updatedAt: { type: 'datetime' },
    },
  },

  'api::page.page': {
    uid: 'api::page.page',
    kind: 'singleType',
    info: {
      singularName: 'page',
      pluralName: 'pages',
      displayName: 'Page',
    },
    attributes: {
      id: { type: 'integer' },
      title: { type: 'string', required: true },
      description: { type: 'text' },
      image: { type: 'media', multiple: false },
      gallery: { type: 'media', multiple: true },
      seo: { type: 'component', component: 'shared.seo', repeatable: false },
      modules: {
        type: 'dynamiczone',
        components: ['hero-section.hero-section', 'faq.faq'],
      },
      author: {
        type: 'relation',
        relation: 'manyToOne',
        target: 'api::author.author',
      },
      tags: {
        type: 'relation',
        relation: 'manyToMany',
        target: 'api::tag.tag',
      },
      relatedArticles: {
        type: 'relation',
        relation: 'oneToMany',
        target: 'api::article.article',
      },
      password: { type: 'password' },
    },
  },

  'api::author.author': {
    uid: 'api::author.author',
    kind: 'collectionType',
    info: {
      singularName: 'author',
      pluralName: 'authors',
      displayName: 'Author',
    },
    attributes: {
      id: { type: 'integer' },
      name: { type: 'string', required: true },
      bio: { type: 'text' },
      avatar: { type: 'media', multiple: false },
    },
  },

  'admin::user': {
    uid: 'admin::user',
    kind: 'collectionType',
    info: {
      singularName: 'user',
      pluralName: 'users',
      displayName: 'Admin User',
    },
    attributes: {
      username: { type: 'string', required: true },
      email: { type: 'email', required: true },
    },
  },

  'plugin::upload.file': {
    uid: 'plugin::upload.file',
    kind: 'collectionType',
    info: {
      singularName: 'file',
      pluralName: 'files',
      displayName: 'File',
    },
    attributes: {
      name: { type: 'string', required: true },
      url: { type: 'string', required: true },
    },
  },
});

export const createTestComponents = () => ({
  'shared.seo': {
    uid: 'shared.seo',
    category: 'shared',
    info: { displayName: 'SEO' },
    attributes: {
      metaTitle: { type: 'string', required: true },
      metaDescription: { type: 'text' },
      metaImage: { type: 'media', multiple: false },
    },
  },

  'hero-section.hero-section': {
    uid: 'hero-section.hero-section',
    category: 'hero-section',
    info: { displayName: 'Hero Section' },
    attributes: {
      title: { type: 'richtext', required: true },
      subtitle: { type: 'text' },
      image: { type: 'media', multiple: false, required: true },
      mobileImage: { type: 'media', multiple: false },
      align: {
        type: 'enumeration',
        enum: ['left', 'center'],
        required: true,
      },
      textColor: { type: 'string', required: true },
      heroSectionButtons: {
        type: 'component',
        component: 'hero-section.hero-section-buttons',
        repeatable: true,
        required: true,
      },
    },
  },

  'hero-section.hero-section-buttons': {
    uid: 'hero-section.hero-section-buttons',
    category: 'hero-section',
    info: { displayName: 'Hero Section Buttons' },
    attributes: {
      label: { type: 'string', required: true },
      url: { type: 'string', required: true },
      variant: {
        type: 'enumeration',
        enum: ['primary', 'secondary'],
        required: true,
      },
    },
  },

  'faq.faq': {
    uid: 'faq.faq',
    category: 'faq',
    info: { displayName: 'FAQ' },
    attributes: {
      title: { type: 'string', required: true },
      faqItems: {
        type: 'component',
        component: 'faq.faq-item',
        repeatable: true,
        required: true,
      },
    },
  },

  'faq.faq-item': {
    uid: 'faq.faq-item',
    category: 'faq',
    info: { displayName: 'FAQ Item' },
    attributes: {
      question: { type: 'string', required: true },
      answer: { type: 'richtext', required: true },
    },
  },
});

export type TestContentTypes = ReturnType<typeof createTestContentTypes>;
export type TestComponents = ReturnType<typeof createTestComponents>;
