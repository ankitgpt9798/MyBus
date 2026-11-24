import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { SUPPORTED_LANGUAGES, t } from '../i18n';
import { RevokedToken } from '../models/RevokedToken';
import { THEMES, User, UserDoc, toPublicUser } from '../models/User';
import { appEvents } from '../services/events';
import { renderEmail, sendMail } from '../services/mail.service';
import { createOpaqueToken, hashToken, signAccessToken } from '../services/token.service';
import { AppError, badRequest, conflict, unauthorized } from '../utils/AppError';
import { validate } from '../utils/validate';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RULE = { type: 'string', required: true, min: 8, max: 72 } as const;

const authResponse = (user: UserDoc) => ({ token: signAccessToken(String(user._id), user.role), user: toPublicUser(user) });

async function sendVerificationEmail(user: UserDoc): Promise<void> {
  const { token, hash } = createOpaqueToken();
  user.verificationTokenHash = hash;
  user.verificationExpires = new Date(Date.now() + VERIFY_TTL_MS);
  await user.save();

  const url = `${env.frontendUrl}/verify-email?token=${token}`;
  const lang = user.language;
  const { html, text } = renderEmail(lang, {
    name: user.name,
    paragraphs: [t(lang, 'email.verify.intro'), t(lang, 'email.verify.expiry')],
    action: { label: t(lang, 'email.verify.button'), url },
    note: t(lang, 'email.verify.ignore'),
  });
  try {
    const result = await sendMail({ to: user.email, subject: t(lang, 'email.verify.subject'), html, text });
    // Console mode or a reserved demo address (e.g. @mybus.local): print the link so the account can still be verified.
    if (!result.delivered) console.log(`[auth] verification link for ${user.email}: ${url}`);
  } catch (err) {
    // Registration must not fail because of SMTP; the user can request a new link.
    console.error(`[auth] could not send verification email to ${user.email}:`, err);
    console.log(`[auth] verification link for ${user.email}: ${url}`);
  }
}

export async function register(req: Request, res: Response) {
  validate(req.body, {
    name: { type: 'string', required: true, min: 2, max: 80 },
    email: { type: 'email', required: true, max: 120 },
    password: PASSWORD_RULE,
    language: { type: 'string', enum: SUPPORTED_LANGUAGES },
    theme: { type: 'string', enum: THEMES },
  });
  const { name, password, language, theme } = req.body;
  const email = String(req.body.email).trim().toLowerCase();
  if (await User.exists({ email })) throw conflict('AUTH_EMAIL_TAKEN', 'An account with this email already exists');

  const user = await User.create({
    name: name.trim(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    language: language ?? 'en',
    theme: theme ?? 'light',
  });
  await sendVerificationEmail(user);
  appEvents.emit('user.registered', { userId: String(user._id) });
  res.status(201).json(authResponse(user));
}

export async function login(req: Request, res: Response) {
  validate(req.body, {
    email: { type: 'email', required: true },
    password: { type: 'string', required: true },
  });
  const email = String(req.body.email).trim().toLowerCase();
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  res.json(authResponse(user));
}

export async function logout(req: Request, res: Response) {
  if (req.auth) {
    await RevokedToken.updateOne(
      { jti: req.auth.jti },
      { $setOnInsert: { jti: req.auth.jti, expiresAt: new Date(req.auth.exp * 1000) } },
      { upsert: true },
    );
  }
  res.status(204).end();
}

export async function verifyEmail(req: Request, res: Response) {
  validate(req.body, { token: { type: 'string', required: true, min: 10, max: 200 } });
  const user = await User.findOne({
    verificationTokenHash: hashToken(req.body.token),
    verificationExpires: { $gt: new Date() },
  });
  if (!user) throw badRequest('VERIFY_TOKEN_INVALID', 'Verification link is invalid or has expired');
  user.emailVerified = true;
  user.verificationTokenHash = undefined;
  user.verificationExpires = undefined;
  await user.save();
  res.json({ user: toPublicUser(user) });
}

export async function resendVerification(req: Request, res: Response) {
  const user = req.user!;
  if (user.emailVerified) throw new AppError(400, 'AUTH_ALREADY_VERIFIED', 'Email is already verified');
  await sendVerificationEmail(user);
  res.status(202).json({ sent: true });
}
