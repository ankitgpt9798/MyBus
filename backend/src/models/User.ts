import { HydratedDocument, InferSchemaType, Schema, model } from 'mongoose';
import { SUPPORTED_LANGUAGES } from '../i18n';

export const ROLES = ['user', 'admin'] as const;
export const THEMES = ['light', 'dark'] as const;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, trim: true, default: '' },
    role: { type: String, enum: ROLES, default: 'user' },
    emailVerified: { type: Boolean, default: false },
    verificationTokenHash: { type: String, select: false },
    verificationExpires: { type: Date, select: false },
    language: { type: String, enum: SUPPORTED_LANGUAGES, default: 'en' },
    theme: { type: String, enum: THEMES, default: 'light' },
    // Channels the user receives notifications on; promotional offers are opt-in.
    notificationPreferences: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
      promotional: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

/** Shape of a user as returned by the API. */
export function toPublicUser(u: UserDoc | (UserAttrs & { _id: unknown })) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone ?? '',
    role: u.role,
    emailVerified: u.emailVerified,
    language: u.language,
    theme: u.theme,
    notificationPreferences: {
      email: u.notificationPreferences?.email ?? true,
      push: u.notificationPreferences?.push ?? true,
      inApp: u.notificationPreferences?.inApp ?? true,
      promotional: u.notificationPreferences?.promotional ?? false,
    },
    createdAt: u.createdAt,
  };
}
