/**
 * Every API error is returned as { code, message, details? }.
 * `code` is a stable identifier the frontend maps to a translated message.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (code = 'AUTH_REQUIRED', message = 'Authentication required') =>
  new AppError(401, code, message);
export const forbidden = (code = 'AUTH_FORBIDDEN', message = 'You are not allowed to do this') =>
  new AppError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = 'Resource not found') =>
  new AppError(404, code, message);
export const conflict = (code: string, message?: string, details?: unknown) =>
  new AppError(409, code, message, details);
