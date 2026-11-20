import { Schema, model } from 'mongoose';

/** JWT ids invalidated by logout; MongoDB's TTL index drops them once the token would expire anyway. */
const revokedTokenSchema = new Schema({
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const RevokedToken = model('RevokedToken', revokedTokenSchema);
