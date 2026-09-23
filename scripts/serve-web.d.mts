import type http from 'node:http';

export function createWebServer(options?: {
  root?: string;
  apiPort?: number;
  webPort?: number;
}): http.Server;
