import type { CollectionName } from '@/lib/types/catalog';

export type ValidityTier = 'short' | 'long';

export interface ValidityOption {
  readonly tier: ValidityTier;
  readonly validityMonths: number;
  readonly label: string;
  readonly shortLabel: string;
  readonly discountPct: number;
  readonly payablePrice: number;
  readonly fullPrice: number;
  readonly savingsAmount: number;
  readonly isLongValidity: boolean;
}

export interface DefaultCatalogPricing {
  readonly discountedPrice: number;
  readonly fullPrice: number;
  readonly discountPct: number;
  readonly savingsAmount: number;
  readonly isFree: boolean;
  readonly defaultValidityMonths: number;
  readonly defaultValidityLabel: string;
}

export interface PurchaseExpiryRecordInput {
  readonly collectionName: CollectionName;
  readonly createdAtIso?: string;
  readonly expiresAtIso?: string;
  readonly validityMonths?: number;
  readonly validityLabel?: string;
}

export interface PurchaseExpiryMeta {
  readonly isExpired: boolean;
  readonly expiresAtMs: number;
  readonly expiresAtIso: string;
  readonly remainingMs: number;
  readonly remainingDays: number;
  readonly remainingHours: number;
  readonly validityMonths: number;
  readonly validityLabel: string;
  readonly formattedExpiryDate: string;
  readonly isExpiringSoon: boolean;
  readonly chipLabel: string;
}

interface CollectionValidityRule {
  readonly shortMonths: number;
  readonly shortLabel: string;
  readonly shortCode: string;
  readonly shortDiscountPct: number;
  readonly longMonths: number;
  readonly longLabel: string;
  readonly longCode: string;
}

const VALIDITY_RULES: Record<CollectionName, CollectionValidityRule> = {
  ExamPackDocument: {
    shortMonths: 1,
    shortLabel: '1 Month',
    shortCode: '1M',
    shortDiscountPct: 50,
    longMonths: 6,
    longLabel: '6 Months',
    longCode: '6M',
  },
  books: {
    shortMonths: 3,
    shortLabel: '3 Months',
    shortCode: '3M',
    shortDiscountPct: 40,
    longMonths: 24,
    longLabel: '2 Years',
    longCode: '2Y',
  },
};

const UTC_SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function sanitizePrice(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw);
}

export function formatValidityMonthsLabel(months: number): string {
  const safe = Math.max(1, Math.round(months));
  if (safe % 12 === 0) {
    const years = safe / 12;
    return years === 1 ? '1 Year' : `${years} Years`;
  }
  return safe === 1 ? '1 Month' : `${safe} Months`;
}

export function isValidValidityMonthsForCollection(
  collectionName: CollectionName,
  months: unknown,
): months is number {
  if (typeof months !== 'number' || !Number.isInteger(months)) return false;
  const rule = VALIDITY_RULES[collectionName];
  return months === rule.shortMonths || months === rule.longMonths;
}

export function getValidityOptions(
  collectionName: CollectionName,
  baseBuyPrice: number,
): readonly [ValidityOption, ValidityOption] {
  const rule = VALIDITY_RULES[collectionName];
  const fullPrice = sanitizePrice(baseBuyPrice);
  const isFree = fullPrice <= 0;

  const shortPayable = isFree
    ? 0
    : Math.max(1, Math.round((fullPrice * (100 - rule.shortDiscountPct)) / 100));
  const shortSavings = isFree ? 0 : Math.max(0, fullPrice - shortPayable);
  const effectiveShortDiscount = isFree ? 0 : rule.shortDiscountPct;

  const shortOption: ValidityOption = {
    tier: 'short',
    validityMonths: rule.shortMonths,
    label: rule.shortLabel,
    shortLabel: rule.shortCode,
    discountPct: effectiveShortDiscount,
    payablePrice: shortPayable,
    fullPrice,
    savingsAmount: shortSavings,
    isLongValidity: false,
  };

  const longOption: ValidityOption = {
    tier: 'long',
    validityMonths: rule.longMonths,
    label: rule.longLabel,
    shortLabel: rule.longCode,
    discountPct: 0,
    payablePrice: fullPrice,
    fullPrice,
    savingsAmount: 0,
    isLongValidity: true,
  };

  return [shortOption, longOption] as const;
}

export function getDefaultCatalogPricing(
  collectionName: CollectionName,
  baseBuyPrice: number,
): DefaultCatalogPricing {
  const [shortOption, longOption] = getValidityOptions(collectionName, baseBuyPrice);
  const isFree = shortOption.fullPrice <= 0;
  const active = isFree ? longOption : shortOption;
  return {
    discountedPrice: active.payablePrice,
    fullPrice: active.fullPrice,
    discountPct: active.discountPct,
    savingsAmount: active.savingsAmount,
    isFree,
    defaultValidityMonths: active.validityMonths,
    defaultValidityLabel: active.label,
  };
}

export function resolveValiditySelection(
  collectionName: CollectionName,
  baseBuyPrice: number,
  requestedValidityMonths?: number | null,
): ValidityOption {
  const [shortOption, longOption] = getValidityOptions(collectionName, baseBuyPrice);
  const isFree = shortOption.fullPrice <= 0;

  if (requestedValidityMonths === longOption.validityMonths) {
    return longOption;
  }
  if (requestedValidityMonths === shortOption.validityMonths) {
    return isFree ? longOption : shortOption;
  }
  return isFree ? longOption : shortOption;
}

export function getLegacyDefaultValidityMonths(collectionName: CollectionName): number {
  return VALIDITY_RULES[collectionName].longMonths;
}

export function addCalendarMonthsUtc(startMs: number, months: number): number {
  const safeMonths = Math.max(1, Math.round(months));
  const d = new Date(startMs);
  const startYear = d.getUTCFullYear();
  const startMonth = d.getUTCMonth();
  const startDay = d.getUTCDate();

  const totalMonths = startMonth + safeMonths;
  const targetYear = startYear + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const maxDayInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(startDay, maxDayInTargetMonth);

  return Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

export function computePurchaseExpiryIso(
  createdAtIsoOrMs: string | number,
  validityMonths: number,
): string {
  const startMs =
    typeof createdAtIsoOrMs === 'number'
      ? createdAtIsoOrMs
      : Date.parse(createdAtIsoOrMs);
  const safeStartMs = Number.isFinite(startMs) ? startMs : Date.now();
  return new Date(addCalendarMonthsUtc(safeStartMs, validityMonths)).toISOString();
}

export function formatUtcShortDate(ms: number): string {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const month = UTC_SHORT_MONTHS[d.getUTCMonth()] ?? 'Jan';
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function resolvePurchaseExpiryMeta(
  record: PurchaseExpiryRecordInput,
  nowMs: number = Date.now(),
): PurchaseExpiryMeta {
  const validityMonths =
    typeof record.validityMonths === 'number' &&
    Number.isInteger(record.validityMonths) &&
    record.validityMonths > 0
      ? record.validityMonths
      : getLegacyDefaultValidityMonths(record.collectionName);

  const validityLabel =
    record.validityLabel && record.validityLabel.trim().length > 0
      ? record.validityLabel.trim()
      : formatValidityMonthsLabel(validityMonths);

  const parsedExpiresMs = record.expiresAtIso ? Date.parse(record.expiresAtIso) : Number.NaN;
  const parsedCreatedMs = record.createdAtIso ? Date.parse(record.createdAtIso) : Number.NaN;

  let expiresAtMs: number;
  if (Number.isFinite(parsedExpiresMs)) {
    expiresAtMs = parsedExpiresMs;
  } else if (Number.isFinite(parsedCreatedMs)) {
    expiresAtMs = addCalendarMonthsUtc(parsedCreatedMs, validityMonths);
  } else {
    expiresAtMs = addCalendarMonthsUtc(nowMs, validityMonths);
  }

  const remainingMs = expiresAtMs - nowMs;
  const isExpired = remainingMs <= 0;
  const remainingDays = isExpired ? 0 : Math.ceil(remainingMs / DAY_MS);
  const remainingHours = isExpired ? 0 : Math.max(1, Math.ceil(remainingMs / HOUR_MS));
  const isExpiringSoon = !isExpired && remainingMs <= 7 * DAY_MS;
  const formattedExpiryDate = formatUtcShortDate(expiresAtMs);

  let chipLabel: string;
  if (isExpired) {
    chipLabel = 'Expired';
  } else if (remainingMs < DAY_MS) {
    chipLabel = `${validityLabel} · ${remainingHours}h left`;
  } else {
    chipLabel = `${validityLabel} · ${remainingDays}d left · Exp ${formattedExpiryDate}`;
  }

  return {
    isExpired,
    expiresAtMs,
    expiresAtIso: new Date(expiresAtMs).toISOString(),
    remainingMs,
    remainingDays,
    remainingHours,
    validityMonths,
    validityLabel,
    formattedExpiryDate,
    isExpiringSoon,
    chipLabel,
  };
}

export function filterActivePurchases<T extends PurchaseExpiryRecordInput>(
  records: readonly T[],
  nowMs: number = Date.now(),
): { active: T[]; expired: T[] } {
  const active: T[] = [];
  const expired: T[] = [];
  for (const record of records) {
    const meta = resolvePurchaseExpiryMeta(record, nowMs);
    if (meta.isExpired) {
      expired.push(record);
    } else {
      active.push(record);
    }
  }
  return { active, expired };
}
