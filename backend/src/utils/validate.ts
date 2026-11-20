import { badRequest } from './AppError';

type RuleType = 'string' | 'email' | 'number' | 'boolean' | 'date' | 'array' | 'object';

export interface Rule {
  type: RuleType;
  required?: boolean;
  min?: number; // string length / number value / array length
  max?: number;
  enum?: readonly (string | number)[];
  pattern?: RegExp;
}

export interface FieldError {
  field: string;
  rule: string;
  params?: Record<string, unknown>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function check(field: string, value: unknown, rule: Rule): FieldError | null {
  const err = (r: string, params?: Record<string, unknown>) => ({ field, rule: r, params });
  if (value === undefined || value === null || value === '') {
    return rule.required ? err('required') : null;
  }
  switch (rule.type) {
    case 'string':
    case 'email': {
      if (typeof value !== 'string') return err('type');
      const v = value.trim();
      if (rule.required && !v) return err('required');
      if (rule.type === 'email' && !EMAIL_RE.test(v)) return err('email');
      if (rule.min !== undefined && v.length < rule.min) return err('minlength', { min: rule.min });
      if (rule.max !== undefined && v.length > rule.max) return err('maxlength', { max: rule.max });
      if (rule.pattern && !rule.pattern.test(v)) return err('pattern');
      break;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return err('type');
      if (rule.min !== undefined && n < rule.min) return err('min', { min: rule.min });
      if (rule.max !== undefined && n > rule.max) return err('max', { max: rule.max });
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') return err('type');
      break;
    case 'date':
      if (Number.isNaN(new Date(value as string).getTime())) return err('date');
      break;
    case 'array':
      if (!Array.isArray(value)) return err('type');
      if (rule.min !== undefined && value.length < rule.min) return err('minItems', { min: rule.min });
      if (rule.max !== undefined && value.length > rule.max) return err('maxItems', { max: rule.max });
      break;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) return err('type');
      break;
  }
  if (rule.enum && !rule.enum.includes(value as string | number)) return err('enum');
  return null;
}

/** Validates `data` against `rules`; throws VALIDATION_ERROR with per-field details. */
export function validate(data: unknown, rules: Record<string, Rule>): void {
  const source = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const errors = Object.entries(rules)
    .map(([field, rule]) => check(field, source[field], rule))
    .filter((e): e is FieldError => e !== null);
  if (errors.length) throw badRequest('VALIDATION_ERROR', 'Invalid input', errors);
}

export const isObjectId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
