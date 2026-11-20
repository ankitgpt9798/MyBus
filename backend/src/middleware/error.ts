import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../utils/AppError';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

// Express recognises error handlers by their four parameters.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, rule: e.kind }));
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid input', details });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ code: 'INVALID_ID', message: `Invalid value for ${err.path}` });
    return;
  }
  if (typeof err === 'object' && err && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ code: 'INVALID_JSON', message: 'Malformed JSON body' });
    return;
  }
  if (typeof err === 'object' && err && 'code' in err && err.code === 11000) {
    res.status(409).json({ code: 'DUPLICATE', message: 'Duplicate value' });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ code: 'SERVER_ERROR', message: 'Something went wrong' });
}
