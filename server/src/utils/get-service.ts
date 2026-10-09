import type { Core } from '@strapi/types';

import { PLUGIN_ID } from '../constants';
import type services from '../services';

type PluginServices = typeof services;
export type PluginServiceName = keyof PluginServices;

// Typed by the service registry itself, so a renamed service fails to compile
// instead of returning undefined at runtime
export const getService = <N extends PluginServiceName>(
  strapi: Core.Strapi,
  name: N,
): ReturnType<PluginServices[N]> =>
  strapi.plugin(PLUGIN_ID).service(name) as ReturnType<PluginServices[N]>;
