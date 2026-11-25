import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { sharePage } from './controllers/share.controller';
import { errorHandler, notFoundHandler } from './middleware/error';
import './models';
import { api } from './routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', api);
  // Uploaded photos: read-only, only generated image names, never sniffed or rendered as anything else.
  app.use(
    '/uploads',
    (req, res, next) => (/^\/community\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(req.path) ? next() : notFoundHandler(req, res, next)),
    express.static(env.uploadsDir, {
      index: false,
      dotfiles: 'deny',
      redirect: false,
      fallthrough: true, // a missing file falls through to the 404 handler
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      },
    }),
  );
  // Link previews for shared community posts (Open Graph), then on to the post in the web app.
  app.get('/share/posts/:id', sharePage);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
