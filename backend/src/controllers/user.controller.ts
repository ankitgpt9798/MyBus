import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { THEMES, User, toPublicUser } from '../models/User';
import { badRequest } from '../utils/AppError';
import { validate } from '../utils/validate';
import { PASSWORD_RULE } from './auth.controller';

export async function getMe(req: Request, res: Response) {
  res.json({ user: toPublicUser(req.user!) });
}

export async function updateMe(req: Request, res: Response) {
  validate(req.body, {
    name: { type: 'string', min: 2, max: 80 },
    phone: { type: 'string', max: 15, pattern: /^[0-9+\-\s]{7,15}$/ },
    language: { type: 'string', enum: SUPPORTED_LANGUAGES },
    theme: { type: 'string', enum: THEMES },
    notificationPreferences: { type: 'object' },
  });
  const user = req.user!;
  const { name, phone, language, theme, notificationPreferences } = req.body;
  if (name !== undefined) user.name = name.trim();
  if (phone !== undefined) user.phone = phone.trim();
  if (language !== undefined) user.language = language;
  if (theme !== undefined) user.theme = theme;
  if (notificationPreferences) {
    for (const key of ['email', 'push', 'promotional'] as const) {
      const value = notificationPreferences[key];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') {
        throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: `notificationPreferences.${key}`, rule: 'type' }]);
      }
      user.notificationPreferences![key] = value;
    }
  }
  await user.save();
  res.json({ user: toPublicUser(user) });
}

export async function changePassword(req: Request, res: Response) {
  validate(req.body, { currentPassword: { type: 'string', required: true }, newPassword: PASSWORD_RULE });
  const user = await User.findById(req.user!._id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) {
    throw badRequest('AUTH_WRONG_PASSWORD', 'Current password is incorrect');
  }
  user.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
  await user.save();
  res.status(204).end();
}
