import { CorsOptions } from 'cors';
import { env } from './env';

// Frontends that may call the API from a browser, on top of whatever
// CLIENT_URL (comma-separated) adds per environment.
const WHITELISTED_ORIGINS = ['https://multi-vendor-admin-panel.vercel.app'];

// Vercel preview/branch deploys of the admin panel, e.g.
// https://multi-vendor-admin-panel-mh3dirxqo-nishantsaini1208.vercel.app
const WHITELISTED_ORIGIN_PATTERNS = [/^https:\/\/multi-vendor-admin-panel-[a-z0-9-]+-nishantsaini1208\.vercel\.app$/];

const allowedOrigins = new Set([...WHITELISTED_ORIGINS, ...env.CLIENT_URLS]);

export function isOriginAllowed(origin: string): boolean {
  return allowedOrigins.has(origin) || WHITELISTED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export const corsOptions: CorsOptions = {
  // Requests without an Origin header (mobile apps, curl, server-to-server
  // like the admin panel's /api proxy) aren't subject to CORS.
  origin: (origin, callback) => callback(null, !origin || isOriginAllowed(origin)),
  credentials: true,
};
