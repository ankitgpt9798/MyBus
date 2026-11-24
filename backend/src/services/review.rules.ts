/** Review limits and content guidelines (R6). */
export const REVIEW_MIN_LENGTH = 30;
export const REVIEW_MAX_LENGTH = 1000;
/** Authors can change rating and text for 24 hours; after that the review (and its rating) is locked. */
export const REVIEW_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Distinct reports after which a review is hidden automatically until an admin looks at it. */
export const REVIEW_HIDE_THRESHOLD = 3;
/** Trusted reviewer: at least this many helpful votes in total, across at least this many visible reviews. */
export const TRUSTED_MIN_HELPFUL = 10;
export const TRUSTED_MIN_REVIEWS = 3;

export const REPORT_REASONS = ['spam', 'offensive', 'irrelevant', 'fake', 'other'] as const;
export const REMOVE_REASONS = ['spam', 'offensive', 'irrelevant', 'fake', 'personal_info', 'other'] as const;
export const REVIEW_SORTS = ['recent', 'helpful', 'highest', 'lowest'] as const;

export type GuidelineRule = 'link' | 'email' | 'phone' | 'banned';

const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|in|net|org|io|co|xyz|info|biz|me|app|ly|link|site|online|shop)\b/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
// Indian mobile numbers (with optional +91 / 0, allowing "98765 43210") or any run of 10+ digits.
const PHONE_RE = /(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b|\b\d{10,}\b/;
// Small list of abusive words (English and common Hindi transliterations), matched as whole words.
const BANNED_WORDS = ['fuck', 'fucking', 'shit', 'bitch', 'bastard', 'asshole', 'chutiya', 'madarchod', 'bhenchod', 'behenchod', 'harami', 'randi', 'gaandu'];
const BANNED_RE = new RegExp(`\\b(?:${BANNED_WORDS.join('|')})\\b`, 'i');

/** First content-guideline problem in a review text, or null when it is fine. */
export function guidelineViolation(text: string): GuidelineRule | null {
  if (EMAIL_RE.test(text)) return 'email';
  if (LINK_RE.test(text)) return 'link';
  if (PHONE_RE.test(text)) return 'phone';
  if (BANNED_RE.test(text)) return 'banned';
  return null;
}
