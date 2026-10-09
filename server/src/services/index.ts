import schemaReader from './schema-reader';
import codeWriter from './code-writer';
import generator from './generator';
import populateBuilder from './populate-builder';

export default {
  'schema-reader': schemaReader,
  'code-writer': codeWriter,
  generator,
  'populate-builder': populateBuilder,
};
