/** Stable application error with a Bengali user-facing message. */
export class AppError extends Error {
  readonly code: string;
  readonly messageBn: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, messageBn: string, messageEn: string, details?: Record<string, unknown>) {
    super(messageEn);
    this.code = code;
    this.messageBn = messageBn;
    this.details = details;
  }
}

export const Errors = {
  validation: (bn: string, en?: string, details?: Record<string, unknown>) =>
    new AppError('VALIDATION', bn, en ?? bn, details),
  notFound: (entity = 'রেকর্ড') =>
    new AppError('NOT_FOUND', `${entity} পাওয়া যায়নি`, `${entity} not found`),
  permissionDenied: (perm?: string) =>
    new AppError('PERMISSION_DENIED', 'এই কাজটি করার অনুমতি আপনার নেই', 'Permission denied', { permission: perm }),
  insufficientStock: (product: string, available?: string) =>
    new AppError('INSUFFICIENT_STOCK', `পর্যাপ্ত স্টক নেই: ${product}${available ? ` (আছে ${available})` : ''}`, 'Insufficient stock', { product, available }),
  expiredProduct: (product: string) =>
    new AppError('EXPIRED_PRODUCT', `মেয়াদ শেষ হয়ে যাওয়া প্রোডাক্ট বিক্রি করা যাবে না: ${product}`, 'Expired product cannot be sold', { product }),
  duplicate: (what: string) =>
    new AppError('DUPLICATE', `${what} আগে থেকেই আছে`, `${what} already exists`),
  invalidLicense: (reasonBn: string) =>
    new AppError('LICENSE_INVALID', `লাইসেন্স গ্রহণযোগ্য নয়: ${reasonBn}`, 'Invalid license', { reason: reasonBn }),
  auth: (bn = 'ইউজারনেম বা পাসওয়ার্ড ভুল') =>
    new AppError('AUTH_FAILED', bn, 'Authentication failed'),
  locked: (until?: string) =>
    new AppError('ACCOUNT_LOCKED', 'অ্যাকাউন্ট সাময়িকভাবে লক করা হয়েছে। কিছুক্ষণ পর চেষ্টা করুন', 'Account temporarily locked', { until }),
  conflict: (bn: string) => new AppError('CONFLICT', bn, 'Conflict'),
  immutable: () => new AppError('IMMUTABLE', 'পোস্ট করা আর্থিক এন্ট্রি মুছে ফেলা যায় না; রিভার্সাল করুন', 'Posted financial entries cannot be deleted; use reversal'),
  costIncomplete: () => new AppError('COST_INCOMPLETE', 'কিছু প্রোডাক্টের ক্রয়মূল্যের তথ্য অসম্পূর্ণ', 'Cost information incomplete'),
};

export function toUserError(e: unknown): { code: string; messageBn: string; details?: Record<string, unknown> } {
  if (e instanceof AppError) return { code: e.code, messageBn: e.messageBn, details: e.details };
  return { code: 'INTERNAL', messageBn: 'অপ্রত্যাশিত সমস্যা হয়েছে। আবার চেষ্টা করুন; সমস্যা থাকলে লগ ফাইল দেখুন', details: undefined };
}
