import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../prisma.js';
import { fail, ok } from './httpResponses.js';

function hmacHex(key: string, msg: string): string {
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

function safeHexEquals(a: string, b: string): boolean {
  const aHex = a.trim().toLowerCase();
  const bHex = b.trim().toLowerCase();
  if (aHex.length !== bHex.length) return false;

  const aBuf = Buffer.from(aHex, 'utf8');
  const bBuf = Buffer.from(bHex, 'utf8');
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function normalizeHashedOrder(value: unknown): {
  digest: string;
  hadPrefix: boolean;
  validHex: boolean;
  digestLength: number;
  digestHasNonHexChars: boolean;
  hadSurroundingWhitespace: boolean;
} {
  const rawInput = String(value ?? '');
  const rawTrimmed = rawInput.trim();
  const hadPrefix = rawTrimmed.toLowerCase().startsWith('sha256=');
  const digest = hadPrefix ? rawTrimmed.slice('sha256='.length).trim() : rawTrimmed;
  const validHex = /^[0-9a-fA-F]{64}$/.test(digest);

  return {
    digest,
    hadPrefix,
    validHex,
    digestLength: digest.length,
    digestHasNonHexChars: digest ? /[^0-9a-fA-F]/.test(digest) : false,
    hadSurroundingWhitespace: rawInput !== rawTrimmed,
  };
}

function normalizeProcessedAt(value: unknown): {
  processed_at: string | null;
  processed_at_iso: string | null;
  processed_at_valid: boolean;
} {
  const processedAt = String(value ?? '').trim();
  if (!processedAt) {
    return {
      processed_at: null,
      processed_at_iso: null,
      processed_at_valid: false,
    };
  }

  const parsedMs = Date.parse(processedAt);
  if (!Number.isNaN(parsedMs)) {
    return {
      processed_at: processedAt,
      processed_at_iso: new Date(parsedMs).toISOString(),
      processed_at_valid: true,
    };
  }

  return {
    processed_at: processedAt,
    processed_at_iso: null,
    processed_at_valid: false,
  };
}

function normalizeError(value: unknown): { error: string | null; error_truncated: boolean } {
  const errorRaw = String(value ?? '').trim();
  if (!errorRaw) return { error: null, error_truncated: false };

  if (errorRaw.length > 500) {
    return {
      error: errorRaw.slice(0, 500),
      error_truncated: true,
    };
  }

  return {
    error: errorRaw,
    error_truncated: false,
  };
}

function normalizeNumericAudit(value: unknown): {
  raw: string | null;
  number: number | null;
  valid: boolean;
} {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return {
      raw: null,
      number: null,
      valid: false,
    };
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return {
      raw,
      number: null,
      valid: false,
    };
  }

  return {
    raw,
    number: numeric,
    valid: true,
  };
}

function numericShapeAudit(rawValue: string | null): {
  decimal_places: number | null;
  uses_scientific_notation: boolean;
  has_leading_plus: boolean;
} {
  if (!rawValue) {
    return {
      decimal_places: null,
      uses_scientific_notation: false,
      has_leading_plus: false,
    };
  }

  const normalized = rawValue.trim();
  const scientific = /[eE]/.test(normalized);
  const fractional = normalized.match(/\.(\d+)/);

  return {
    decimal_places: fractional?.[1]?.length ?? 0,
    uses_scientific_notation: scientific,
    has_leading_plus: normalized.startsWith('+'),
  };
}

function webhookNumericShapeAuditMeta(amountRaw: string | null, feeRaw: string | null): {
  amount_decimal_places: number | null;
  amount_uses_scientific_notation: boolean;
  amount_has_leading_plus: boolean;
  fee_decimal_places: number | null;
  fee_uses_scientific_notation: boolean;
  fee_has_leading_plus: boolean;
} {
  const amountShape = numericShapeAudit(amountRaw);
  const feeShape = numericShapeAudit(feeRaw);

  return {
    amount_decimal_places: amountShape.decimal_places,
    amount_uses_scientific_notation: amountShape.uses_scientific_notation,
    amount_has_leading_plus: amountShape.has_leading_plus,
    fee_decimal_places: feeShape.decimal_places,
    fee_uses_scientific_notation: feeShape.uses_scientific_notation,
    fee_has_leading_plus: feeShape.has_leading_plus,
  };
}

function normalizeAddress(value: unknown): {
  address: string | null;
  valid: boolean;
  kind: 'bech32' | 'base58' | 'unknown' | null;
} {
  const address = String(value ?? '').trim();
  if (!address) {
    return {
      address: null,
      valid: false,
      kind: null,
    };
  }

  const bech32Like = /^(bc1|tb1|bcrt1)[ac-hj-np-z02-9]{11,100}$/i.test(address);
  if (bech32Like) {
    return {
      address,
      valid: true,
      kind: 'bech32',
    };
  }

  const base58Like = /^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,49}$/.test(address);
  if (base58Like) {
    return {
      address,
      valid: true,
      kind: 'base58',
    };
  }

  return {
    address,
    valid: false,
    kind: 'unknown',
  };
}

function normalizeReference(value: unknown): { reference: string | null; reference_truncated: boolean } {
  const referenceRaw = String(value ?? '').trim();
  if (!referenceRaw) return { reference: null, reference_truncated: false };

  if (referenceRaw.length > 200) {
    return {
      reference: referenceRaw.slice(0, 200),
      reference_truncated: true,
    };
  }

  return {
    reference: referenceRaw,
    reference_truncated: false,
  };
}

function normalizeWebhookId(value: unknown): {
  id: string | null;
  id_raw: string | null;
  id_length: number | null;
  id_truncated: boolean;
  id_had_surrounding_whitespace: boolean;
} {
  const idRaw = String(value ?? '');
  const idTrimmed = idRaw.trim();
  if (!idTrimmed) {
    return {
      id: null,
      id_raw: null,
      id_length: null,
      id_truncated: false,
      id_had_surrounding_whitespace: false,
    };
  }

  const idTruncated = idTrimmed.length > 128;
  return {
    id: idTruncated ? idTrimmed.slice(0, 128) : idTrimmed,
    id_raw: idTrimmed,
    id_length: idTrimmed.length,
    id_truncated: idTruncated,
    id_had_surrounding_whitespace: idRaw !== idTrimmed,
  };
}

function normalizeStatus(value: unknown): {
  status_raw: string | null;
  status: string;
  status_known: boolean;
  status_kind: 'confirmed' | 'failure' | 'unknown';
  status_had_surrounding_whitespace: boolean;
} {
  const statusRawInput = String(value ?? '');
  const statusRawTrimmed = statusRawInput.trim();
  const status = statusRawTrimmed.toLowerCase();
  const statusKnown = status === 'confirmed' || status === 'error' || status === 'failed';

  return {
    status_raw: statusRawTrimmed || null,
    status,
    status_known: statusKnown,
    status_kind: status === 'confirmed' ? 'confirmed' : status === 'error' || status === 'failed' ? 'failure' : 'unknown',
    status_had_surrounding_whitespace: statusRawInput !== statusRawTrimmed,
  };
}

function normalizeType(value: unknown): {
  type: string | null;
  type_raw: string | null;
  type_known: boolean;
} {
  const typeRaw = String(value ?? '').trim();
  if (!typeRaw) {
    return {
      type: null,
      type_raw: null,
      type_known: false,
    };
  }

  const type = typeRaw.toLowerCase();
  return {
    type,
    type_raw: typeRaw,
    type_known: type === 'withdrawal',
  };
}

function webhookPayoutIdAuditMeta(withdrawalId: string, providerWithdrawalId: unknown): {
  provider_withdrawal_id: string | null;
  provider_withdrawal_id_length: number | null;
  provider_withdrawal_id_matches: boolean;
  provider_withdrawal_id_casefold_matches: boolean;
} {
  const providerId = String(providerWithdrawalId ?? '').trim();
  const inboundId = String(withdrawalId ?? '').trim();

  if (!providerId) {
    return {
      provider_withdrawal_id: null,
      provider_withdrawal_id_length: null,
      provider_withdrawal_id_matches: false,
      provider_withdrawal_id_casefold_matches: false,
    };
  }

  return {
    provider_withdrawal_id: providerId,
    provider_withdrawal_id_length: providerId.length,
    provider_withdrawal_id_matches: providerId === inboundId,
    provider_withdrawal_id_casefold_matches: providerId.toLowerCase() === inboundId.toLowerCase(),
  };
}

function webhookAmountFeeAuditMeta(amountMeta: { number: number | null; valid: boolean }, feeMeta: { number: number | null; valid: boolean }): {
  amount_negative: boolean;
  amount_zero: boolean;
  fee_negative: boolean;
  fee_zero: boolean;
  fee_greater_than_amount: boolean;
  fee_equal_amount: boolean;
} {
  const amount = amountMeta.valid ? amountMeta.number : null;
  const fee = feeMeta.valid ? feeMeta.number : null;

  return {
    amount_negative: amount != null ? amount < 0 : false,
    amount_zero: amount != null ? amount === 0 : false,
    fee_negative: fee != null ? fee < 0 : false,
    fee_zero: fee != null ? fee === 0 : false,
    fee_greater_than_amount: fee != null && amount != null ? fee > amount : false,
    fee_equal_amount: fee != null && amount != null ? fee === amount : false,
  };
}

function webhookStatusErrorAuditMeta(status: string, error: string | null): {
  error_present: boolean;
  error_missing_for_failure: boolean;
  error_present_on_confirmed: boolean;
  error_present_on_unknown_status: boolean;
} {
  const errorPresent = Boolean(error);
  const statusIsFailure = status === 'error' || status === 'failed';
  const statusIsConfirmed = status === 'confirmed';
  const statusIsUnknown = !statusIsFailure && !statusIsConfirmed;

  return {
    error_present: errorPresent,
    error_missing_for_failure: statusIsFailure && !errorPresent,
    error_present_on_confirmed: statusIsConfirmed && errorPresent,
    error_present_on_unknown_status: statusIsUnknown && errorPresent,
  };
}

function webhookHashedOrderAuditMeta(hashedOrder: {
  digestLength: number;
  digestHasNonHexChars: boolean;
  hadSurroundingWhitespace: boolean;
}): {
  hashed_order_length: number;
  hashed_order_expected_length: number;
  hashed_order_length_matches_expected: boolean;
  hashed_order_has_non_hex_chars: boolean;
  hashed_order_had_surrounding_whitespace: boolean;
} {
  const expectedLength = 64;
  return {
    hashed_order_length: hashedOrder.digestLength,
    hashed_order_expected_length: expectedLength,
    hashed_order_length_matches_expected: hashedOrder.digestLength === expectedLength,
    hashed_order_has_non_hex_chars: hashedOrder.digestHasNonHexChars,
    hashed_order_had_surrounding_whitespace: hashedOrder.hadSurroundingWhitespace,
  };
}

function webhookProcessedAtTimingAuditMeta(processedAtIso: string | null): {
  processed_at_age_seconds: number | null;
  processed_at_in_future: boolean;
  processed_at_older_than_30d: boolean;
} {
  if (!processedAtIso) {
    return {
      processed_at_age_seconds: null,
      processed_at_in_future: false,
      processed_at_older_than_30d: false,
    };
  }

  const processedAtMs = Date.parse(processedAtIso);
  if (Number.isNaN(processedAtMs)) {
    return {
      processed_at_age_seconds: null,
      processed_at_in_future: false,
      processed_at_older_than_30d: false,
    };
  }

  const ageSeconds = Math.floor((Date.now() - processedAtMs) / 1000);
  return {
    processed_at_age_seconds: ageSeconds,
    processed_at_in_future: ageSeconds < 0,
    processed_at_older_than_30d: ageSeconds > 30 * 24 * 60 * 60,
  };
}


function webhookLookupMissMeta(args: {
  withdrawalId: string;
  status: string;
  statusKnown: boolean;
  type: string | null;
  typeKnown: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: string;
  status_known: boolean;
  type: string | null;
  type_known: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_known: args.statusKnown,
    type: args.type,
    type_known: args.typeKnown,
  };
}

function webhookUnknownStatusMeta(args: {
  withdrawalId: string;
  status: string;
  statusKnown: boolean;
  statusRaw: string | null;
  type: string | null;
  typeKnown: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: string;
  status_raw: string | null;
  status_known: boolean;
  type: string | null;
  type_known: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    status_known: args.statusKnown,
    type: args.type,
    type_known: args.typeKnown,
  };
}

function webhookFailureStatusMeta(args: {
  withdrawalId: string;
  status: string;
  statusKnown: boolean;
  errorPresent: boolean;
  errorTruncated: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: string;
  status_known: boolean;
  error_present: boolean;
  error_truncated: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_known: args.statusKnown,
    error_present: args.errorPresent,
    error_truncated: args.errorTruncated,
  };
}

function webhookProviderIdMismatchMeta(args: {
  withdrawalId: string;
  providerWithdrawalId: string | null;
  providerWithdrawalIdLength: number | null;
  providerWithdrawalIdMatches: boolean;
  providerWithdrawalIdCasefoldMatches: boolean;
}): {
  withdrawal_id: string;
  withdrawal_id_length: number;
  provider_withdrawal_id: string | null;
  provider_withdrawal_id_length: number | null;
  provider_withdrawal_id_matches: boolean;
  provider_withdrawal_id_casefold_matches: boolean;
} {
  return {
    withdrawal_id: args.withdrawalId,
    withdrawal_id_length: args.withdrawalId.length,
    provider_withdrawal_id: args.providerWithdrawalId,
    provider_withdrawal_id_length: args.providerWithdrawalIdLength,
    provider_withdrawal_id_matches: args.providerWithdrawalIdMatches,
    provider_withdrawal_id_casefold_matches: args.providerWithdrawalIdCasefoldMatches,
  };
}

function webhookTypeDriftMeta(args: {
  withdrawalId: string;
  type: string | null;
  typeRaw: string | null;
  typeKnown: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  type: string | null;
  type_raw: string | null;
  type_known: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    type: args.type,
    type_raw: args.typeRaw,
    type_known: args.typeKnown,
  };
}

function webhookProcessedAtAnomalyMeta(args: {
  withdrawalId: string;
  processedAt: string | null;
  processedAtIso: string | null;
  processedAtValid: boolean;
  processedAtInFuture: boolean;
  processedAtOlderThan30d: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  processed_at: string | null;
  processed_at_iso: string | null;
  processed_at_valid: boolean;
  processed_at_in_future: boolean;
  processed_at_older_than_30d: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    processed_at: args.processedAt,
    processed_at_iso: args.processedAtIso,
    processed_at_valid: args.processedAtValid,
    processed_at_in_future: args.processedAtInFuture,
    processed_at_older_than_30d: args.processedAtOlderThan30d,
  };
}

function webhookAddressAnomalyMeta(args: {
  withdrawalId: string;
  address: string | null;
  addressValid: boolean;
  addressKind: 'bech32' | 'base58' | 'unknown' | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  address_present: boolean;
  address: string | null;
  address_valid: boolean;
  address_kind: 'bech32' | 'base58' | 'unknown' | null;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    address_present: Boolean(args.address),
    address: args.address,
    address_valid: args.addressValid,
    address_kind: args.addressKind,
  };
}

function webhookReferenceAnomalyMeta(args: {
  withdrawalId: string;
  reference: string | null;
  referenceTruncated: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  reference_present: boolean;
  reference: string | null;
  reference_length: number;
  reference_truncated: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    reference_present: Boolean(args.reference),
    reference: args.reference,
    reference_length: args.reference?.length ?? 0,
    reference_truncated: args.referenceTruncated,
  };
}

function webhookValueAnomalyMeta(args: {
  withdrawalId: string;
  amountValid: boolean;
  feeValid: boolean;
  amountNegative: boolean;
  feeNegative: boolean;
  feeGreaterThanAmount: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  amount_valid: boolean;
  fee_valid: boolean;
  amount_negative: boolean;
  fee_negative: boolean;
  fee_greater_than_amount: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    amount_valid: args.amountValid,
    fee_valid: args.feeValid,
    amount_negative: args.amountNegative,
    fee_negative: args.feeNegative,
    fee_greater_than_amount: args.feeGreaterThanAmount,
  };
}

function webhookInputNormalizationMeta(args: {
  withdrawalId: string;
  idHadSurroundingWhitespace: boolean;
  statusHadSurroundingWhitespace: boolean;
  hashedOrderHadSurroundingWhitespace: boolean;
  hashedOrderPrefixed: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  id_had_surrounding_whitespace: boolean;
  status_had_surrounding_whitespace: boolean;
  hashed_order_had_surrounding_whitespace: boolean;
  hashed_order_prefixed: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    id_had_surrounding_whitespace: args.idHadSurroundingWhitespace,
    status_had_surrounding_whitespace: args.statusHadSurroundingWhitespace,
    hashed_order_had_surrounding_whitespace: args.hashedOrderHadSurroundingWhitespace,
    hashed_order_prefixed: args.hashedOrderPrefixed,
  };
}

function webhookIdShapeAnomalyMeta(args: {
  withdrawalId: string;
  idLength: number | null;
  idTruncated: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  id_length: number | null;
  id_truncated: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    id_length: args.idLength,
    id_truncated: args.idTruncated,
  };
}

function webhookStatusNormalizationMeta(args: {
  withdrawalId: string;
  statusRaw: string | null;
  status: string;
  statusKnown: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status_raw: string | null;
  status: string;
  status_known: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status_raw: args.statusRaw,
    status: args.status,
    status_known: args.statusKnown,
  };
}

function webhookConfirmedFeeEqualsAmountMeta(args: {
  withdrawalId: string;
  statusRaw: string | null;
  amountValid: boolean;
  amountNumber: number | null;
  feeValid: boolean;
  feeNumber: number | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'confirmed';
  status_raw: string | null;
  amount_valid: boolean;
  amount_number: number | null;
  fee_valid: boolean;
  fee_number: number | null;
  fee_equal_amount: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: 'confirmed',
    status_raw: args.statusRaw,
    amount_valid: args.amountValid,
    amount_number: args.amountNumber,
    fee_valid: args.feeValid,
    fee_number: args.feeNumber,
    fee_equal_amount: args.amountValid && args.feeValid && args.amountNumber === args.feeNumber,
  };
}

function webhookConfirmedZeroAmountMeta(args: {
  withdrawalId: string;
  statusRaw: string | null;
  amountValid: boolean;
  amountNumber: number | null;
  feeValid: boolean;
  feeNumber: number | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'confirmed';
  status_raw: string | null;
  amount_valid: boolean;
  amount_number: number | null;
  fee_valid: boolean;
  fee_number: number | null;
  amount_zero: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: 'confirmed',
    status_raw: args.statusRaw,
    amount_valid: args.amountValid,
    amount_number: args.amountNumber,
    fee_valid: args.feeValid,
    fee_number: args.feeNumber,
    amount_zero: args.amountValid && args.amountNumber === 0,
  };
}

function webhookConfirmedNegativeFeeMeta(args: {
  withdrawalId: string;
  statusRaw: string | null;
  amountValid: boolean;
  amountNumber: number | null;
  feeValid: boolean;
  feeNumber: number | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'confirmed';
  status_raw: string | null;
  amount_valid: boolean;
  amount_number: number | null;
  fee_valid: boolean;
  fee_number: number | null;
  fee_negative: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: 'confirmed',
    status_raw: args.statusRaw,
    amount_valid: args.amountValid,
    amount_number: args.amountNumber,
    fee_valid: args.feeValid,
    fee_number: args.feeNumber,
    fee_negative: args.feeValid && (args.feeNumber ?? 0) < 0,
  };
}

function webhookConfirmedFeeGreaterThanAmountMeta(args: {
  withdrawalId: string;
  statusRaw: string | null;
  amountValid: boolean;
  amountNumber: number | null;
  feeValid: boolean;
  feeNumber: number | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'confirmed';
  status_raw: string | null;
  amount_valid: boolean;
  amount_number: number | null;
  fee_valid: boolean;
  fee_number: number | null;
  fee_greater_than_amount: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: 'confirmed',
    status_raw: args.statusRaw,
    amount_valid: args.amountValid,
    amount_number: args.amountNumber,
    fee_valid: args.feeValid,
    fee_number: args.feeNumber,
    fee_greater_than_amount: args.amountValid && args.feeValid && (args.feeNumber ?? 0) > (args.amountNumber ?? 0),
  };
}

function webhookUnknownWithdrawalStatusMeta(args: {
  withdrawalId: string;
  status: string;
  statusRaw: string | null;
  statusKnown: boolean;
  type: string | null;
  typeKnown: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: string;
  status_raw: string | null;
  status_known: boolean;
  type: string | null;
  type_known: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    status_known: args.statusKnown,
    type: args.type,
    type_known: args.typeKnown,
  };
}

function webhookFailureFeeEqualsAmountMeta(args: {
  withdrawalId: string;
  status: 'error' | 'failed';
  statusRaw: string | null;
  amountValid: boolean;
  amountNumber: number | null;
  feeValid: boolean;
  feeNumber: number | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'error' | 'failed';
  status_raw: string | null;
  amount_valid: boolean;
  amount_number: number | null;
  fee_valid: boolean;
  fee_number: number | null;
  fee_equal_amount: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    amount_valid: args.amountValid,
    amount_number: args.amountNumber,
    fee_valid: args.feeValid,
    fee_number: args.feeNumber,
    fee_equal_amount: args.amountValid && args.feeValid && args.amountNumber === args.feeNumber,
  };
}

function webhookFailureFeeGreaterThanAmountMeta(args: {
  withdrawalId: string;
  status: 'error' | 'failed';
  statusRaw: string | null;
  amountValid: boolean;
  amountNumber: number | null;
  feeValid: boolean;
  feeNumber: number | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'error' | 'failed';
  status_raw: string | null;
  amount_valid: boolean;
  amount_number: number | null;
  fee_valid: boolean;
  fee_number: number | null;
  fee_greater_than_amount: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    amount_valid: args.amountValid,
    amount_number: args.amountNumber,
    fee_valid: args.feeValid,
    fee_number: args.feeNumber,
    fee_greater_than_amount: args.amountValid && args.feeValid && (args.feeNumber ?? 0) > (args.amountNumber ?? 0),
  };
}

function webhookFailureZeroAmountMeta(args: {
  withdrawalId: string;
  status: 'error' | 'failed';
  statusRaw: string | null;
  amountValid: boolean;
  amountNumber: number | null;
  feeValid: boolean;
  feeNumber: number | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'error' | 'failed';
  status_raw: string | null;
  amount_valid: boolean;
  amount_number: number | null;
  fee_valid: boolean;
  fee_number: number | null;
  amount_zero: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    amount_valid: args.amountValid,
    amount_number: args.amountNumber,
    fee_valid: args.feeValid,
    fee_number: args.feeNumber,
    amount_zero: args.amountValid && args.amountNumber === 0,
  };
}

function webhookFailureNegativeAmountMeta(args: {
  withdrawalId: string;
  status: 'error' | 'failed';
  statusRaw: string | null;
  amountValid: boolean;
  amountNumber: number | null;
  feeValid: boolean;
  feeNumber: number | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'error' | 'failed';
  status_raw: string | null;
  amount_valid: boolean;
  amount_number: number | null;
  fee_valid: boolean;
  fee_number: number | null;
  amount_negative: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    amount_valid: args.amountValid,
    amount_number: args.amountNumber,
    fee_valid: args.feeValid,
    fee_number: args.feeNumber,
    amount_negative: args.amountValid && (args.amountNumber ?? 0) < 0,
  };
}

function webhookFailureNegativeFeeMeta(args: {
  withdrawalId: string;
  status: 'error' | 'failed';
  statusRaw: string | null;
  amountValid: boolean;
  amountNumber: number | null;
  feeValid: boolean;
  feeNumber: number | null;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'error' | 'failed';
  status_raw: string | null;
  amount_valid: boolean;
  amount_number: number | null;
  fee_valid: boolean;
  fee_number: number | null;
  fee_negative: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    amount_valid: args.amountValid,
    amount_number: args.amountNumber,
    fee_valid: args.feeValid,
    fee_number: args.feeNumber,
    fee_negative: args.feeValid && (args.feeNumber ?? 0) < 0,
  };
}

function webhookFailureTimingAnomalyMeta(args: {
  withdrawalId: string;
  status: 'error' | 'failed';
  statusRaw: string | null;
  processedAt: string | null;
  processedAtIso: string | null;
  processedAtValid: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'error' | 'failed';
  status_raw: string | null;
  processed_at: string | null;
  processed_at_iso: string | null;
  processed_at_valid: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    processed_at: args.processedAt,
    processed_at_iso: args.processedAtIso,
    processed_at_valid: args.processedAtValid,
  };
}

function webhookConfirmedTimingAnomalyMeta(args: {
  withdrawalId: string;
  statusRaw: string | null;
  processedAt: string | null;
  processedAtIso: string | null;
  processedAtValid: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'confirmed';
  status_raw: string | null;
  processed_at: string | null;
  processed_at_iso: string | null;
  processed_at_valid: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: 'confirmed',
    status_raw: args.statusRaw,
    processed_at: args.processedAt,
    processed_at_iso: args.processedAtIso,
    processed_at_valid: args.processedAtValid,
  };
}

function webhookStatusTypeMismatchMeta(args: {
  withdrawalId: string;
  status: string;
  statusRaw: string | null;
  statusKnown: boolean;
  type: string | null;
  typeRaw: string | null;
  typeKnown: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: string;
  status_raw: string | null;
  status_known: boolean;
  type: string | null;
  type_raw: string | null;
  type_known: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    status_known: args.statusKnown,
    type: args.type,
    type_raw: args.typeRaw,
    type_known: args.typeKnown,
  };
}

function webhookTypeNormalizationMeta(args: {
  withdrawalId: string;
  typeRaw: string | null;
  type: string | null;
  typeKnown: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  type_raw: string | null;
  type: string | null;
  type_known: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    type_raw: args.typeRaw,
    type: args.type,
    type_known: args.typeKnown,
  };
}

function webhookUnknownStatusErrorMeta(args: {
  withdrawalId: string;
  status: string;
  statusRaw: string | null;
  errorPresent: boolean;
  type: string | null;
  typeKnown: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: string;
  status_raw: string | null;
  error_present: boolean;
  type: string | null;
  type_known: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: args.status,
    status_raw: args.statusRaw,
    error_present: args.errorPresent,
    type: args.type,
    type_known: args.typeKnown,
  };
}

function webhookConfirmedStatusErrorMeta(args: {
  withdrawalId: string;
  statusRaw: string | null;
  errorPresent: boolean;
  type: string | null;
  typeKnown: boolean;
}): {
  withdrawal_id_present: boolean;
  withdrawal_id_length: number;
  status: 'confirmed';
  status_raw: string | null;
  error_present: boolean;
  type: string | null;
  type_known: boolean;
} {
  return {
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status: 'confirmed',
    status_raw: args.statusRaw,
    error_present: args.errorPresent,
    type: args.type,
    type_known: args.typeKnown,
  };
}
function webhookFailureShapeMeta(args: {
  reason: 'hashed_order_mismatch' | 'missing_id_or_hashed_order' | 'missing_status';
  withdrawalId: string;
  status: string;
  statusKnown: boolean;
  hashedOrderPrefixed: boolean;
  hashedOrderValidHex: boolean;
  hashedOrderLength: number;
  hashedOrderExpectedLength: number;
  hashedOrderLengthMatchesExpected: boolean;
  hashedOrderHasNonHexChars: boolean;
  hashedOrderHadSurroundingWhitespace: boolean;
}) {
  return {
    reason: args.reason,
    withdrawal_id_present: Boolean(args.withdrawalId),
    withdrawal_id_length: args.withdrawalId.length,
    status_present: Boolean(args.status),
    status: args.status,
    status_known: args.statusKnown,
    hashed_order_present: args.hashedOrderLength > 0,
    hashed_order_prefixed: args.hashedOrderPrefixed,
    hashed_order_valid_hex: args.hashedOrderValidHex,
    hashed_order_length: args.hashedOrderLength,
    hashed_order_expected_length: args.hashedOrderExpectedLength,
    hashed_order_length_matches_expected: args.hashedOrderLengthMatchesExpected,
    hashed_order_has_non_hex_chars: args.hashedOrderHasNonHexChars,
    hashed_order_had_surrounding_whitespace: args.hashedOrderHadSurroundingWhitespace,
  };
}

// OpenNode withdrawals webhook:
// POST callback_url | application/x-www-form-urlencoded
// { id, type, amount, reference, processed_at, address, fee, status, error, hashed_order }
export async function registerOpenNodeWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/opennode/withdrawals', async (req, reply) => {
    const apiKey = (process.env.OPENNODE_API_KEY ?? '').trim();
    if (!apiKey) {
      req.log.warn({ route: 'opennode.withdrawals' }, 'OPENNODE_API_KEY not set; rejecting webhook');
      // Misconfiguration: do not pretend success; but also avoid 500 which implies an internal crash.
      return reply.code(503).send(fail('opennode webhook misconfigured'));
    }

    const body = (req.body ?? {}) as Record<string, any>;

    const withdrawalId = String(body.id ?? '').trim();
    const statusMeta = normalizeStatus(body.status);
    const statusRaw = statusMeta.status_raw ?? '';
    const status = statusMeta.status;
    const statusKnown = statusMeta.status_known;
    const hashedOrder = normalizeHashedOrder(body.hashed_order);
    const received = hashedOrder.digest;
    const { error, error_truncated } = normalizeError(body.error);
    const processedAtMeta = normalizeProcessedAt(body.processed_at);
    const feeMeta = normalizeNumericAudit(body.fee);
    const amountMeta = normalizeNumericAudit(body.amount);
    const addressMeta = normalizeAddress(body.address);
    const referenceMeta = normalizeReference(body.reference);
    const webhookIdMeta = normalizeWebhookId(body.id);
    const typeMeta = normalizeType(body.type);
    const amountFeeAuditMeta = webhookAmountFeeAuditMeta(amountMeta, feeMeta);
    const numericShapeAuditMeta = webhookNumericShapeAuditMeta(amountMeta.raw, feeMeta.raw);
    const statusErrorAuditMeta = webhookStatusErrorAuditMeta(status, error);
    const hashedOrderAuditMeta = webhookHashedOrderAuditMeta(hashedOrder);
    const processedAtTimingAuditMeta = webhookProcessedAtTimingAuditMeta(processedAtMeta.processed_at_iso);

    if (processedAtMeta.processed_at && (!processedAtMeta.processed_at_valid || processedAtTimingAuditMeta.processed_at_in_future || processedAtTimingAuditMeta.processed_at_older_than_30d)) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          processedAtAnomaly: webhookProcessedAtAnomalyMeta({
            withdrawalId,
            processedAt: processedAtMeta.processed_at,
            processedAtIso: processedAtMeta.processed_at_iso,
            processedAtValid: processedAtMeta.processed_at_valid,
            processedAtInFuture: processedAtTimingAuditMeta.processed_at_in_future,
            processedAtOlderThan30d: processedAtTimingAuditMeta.processed_at_older_than_30d,
          }),
        },
        'opennode withdrawals webhook: processed_at anomaly observed',
      );
    }

    if (addressMeta.address && !addressMeta.valid) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          addressAnomaly: webhookAddressAnomalyMeta({
            withdrawalId,
            address: addressMeta.address,
            addressValid: addressMeta.valid,
            addressKind: addressMeta.kind,
          }),
        },
        'opennode withdrawals webhook: address anomaly observed',
      );
    }

    if (referenceMeta.reference && referenceMeta.reference_truncated) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          referenceAnomaly: webhookReferenceAnomalyMeta({
            withdrawalId,
            reference: referenceMeta.reference,
            referenceTruncated: referenceMeta.reference_truncated,
          }),
        },
        'opennode withdrawals webhook: reference anomaly observed',
      );
    }

    if (amountFeeAuditMeta.amount_negative || amountFeeAuditMeta.fee_negative || amountFeeAuditMeta.fee_greater_than_amount) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          valueAnomaly: webhookValueAnomalyMeta({
            withdrawalId,
            amountValid: amountMeta.valid,
            feeValid: feeMeta.valid,
            amountNegative: amountFeeAuditMeta.amount_negative,
            feeNegative: amountFeeAuditMeta.fee_negative,
            feeGreaterThanAmount: amountFeeAuditMeta.fee_greater_than_amount,
          }),
        },
        'opennode withdrawals webhook: numeric value anomaly observed',
      );
    }

    if (
      webhookIdMeta.id_had_surrounding_whitespace ||
      statusMeta.status_had_surrounding_whitespace ||
      hashedOrder.hadSurroundingWhitespace ||
      hashedOrder.hadPrefix
    ) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          inputNormalization: webhookInputNormalizationMeta({
            withdrawalId,
            idHadSurroundingWhitespace: webhookIdMeta.id_had_surrounding_whitespace,
            statusHadSurroundingWhitespace: statusMeta.status_had_surrounding_whitespace,
            hashedOrderHadSurroundingWhitespace: hashedOrder.hadSurroundingWhitespace,
            hashedOrderPrefixed: hashedOrder.hadPrefix,
          }),
        },
        'opennode withdrawals webhook: input normalization observed',
      );
    }

    if (statusMeta.status_raw && statusMeta.status_raw !== status) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          statusNormalization: webhookStatusNormalizationMeta({
            withdrawalId,
            statusRaw: statusMeta.status_raw,
            status,
            statusKnown,
          }),
        },
        'opennode withdrawals webhook: status normalization observed',
      );
    }

    if (typeMeta.type_raw && typeMeta.type_raw !== typeMeta.type) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          typeNormalization: webhookTypeNormalizationMeta({
            withdrawalId,
            typeRaw: typeMeta.type_raw,
            type: typeMeta.type,
            typeKnown: typeMeta.type_known,
          }),
        },
        'opennode withdrawals webhook: type normalization observed',
      );
    }

    if (statusKnown && typeMeta.type && !typeMeta.type_known) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          statusTypeMismatch: webhookStatusTypeMismatchMeta({
            withdrawalId,
            status,
            statusRaw: statusMeta.status_raw,
            statusKnown,
            type: typeMeta.type,
            typeRaw: typeMeta.type_raw,
            typeKnown: typeMeta.type_known,
          }),
        },
        'opennode withdrawals webhook: status/type mismatch observed',
      );
    }

    if (webhookIdMeta.id_truncated) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          idShapeAnomaly: webhookIdShapeAnomalyMeta({
            withdrawalId,
            idLength: webhookIdMeta.id_length,
            idTruncated: webhookIdMeta.id_truncated,
          }),
        },
        'opennode withdrawals webhook: id shape anomaly observed',
      );
    }

    // Persist a subset of the webhook payload for auditability.
    // NOTE: keep this strictly additive / behavior-neutral.
    const webhookMeta = {
      receivedAt: new Date().toISOString(),
      status,
      status_raw: statusRaw || null,
      status_known: statusKnown,
      status_kind: statusMeta.status_kind,
      status_had_surrounding_whitespace: statusMeta.status_had_surrounding_whitespace,
      id: webhookIdMeta.id,
      id_raw: webhookIdMeta.id_raw,
      id_length: webhookIdMeta.id_length,
      id_truncated: webhookIdMeta.id_truncated,
      id_had_surrounding_whitespace: webhookIdMeta.id_had_surrounding_whitespace,
      ...processedAtMeta,
      ...processedAtTimingAuditMeta,
      fee: body.fee ?? null,
      fee_number: feeMeta.number,
      fee_valid: feeMeta.valid,
      amount: amountMeta.raw,
      amount_number: amountMeta.number,
      amount_valid: amountMeta.valid,
      ...amountFeeAuditMeta,
      ...numericShapeAuditMeta,
      address: addressMeta.address,
      address_valid: addressMeta.valid,
      address_kind: addressMeta.kind,
      reference: referenceMeta.reference,
      reference_truncated: referenceMeta.reference_truncated,
      type: typeMeta.type,
      type_raw: typeMeta.type_raw,
      type_known: typeMeta.type_known,
      hashed_order_prefixed: hashedOrder.hadPrefix,
      hashed_order_valid_hex: hashedOrder.validHex,
      ...hashedOrderAuditMeta,
      error,
      error_truncated,
      ...statusErrorAuditMeta,
    };

    if (!withdrawalId || !received) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          validationFailure: webhookFailureShapeMeta({
            reason: 'missing_id_or_hashed_order',
            withdrawalId,
            status,
            statusKnown,
            hashedOrderPrefixed: hashedOrder.hadPrefix,
            hashedOrderValidHex: hashedOrder.validHex,
            hashedOrderLength: hashedOrder.digestLength,
            hashedOrderExpectedLength: hashedOrderAuditMeta.hashed_order_expected_length,
            hashedOrderLengthMatchesExpected: hashedOrderAuditMeta.hashed_order_length_matches_expected,
            hashedOrderHasNonHexChars: hashedOrder.digestHasNonHexChars,
            hashedOrderHadSurroundingWhitespace: hashedOrder.hadSurroundingWhitespace,
          }),
        },
        'opennode withdrawals webhook: missing id/hashed_order',
      );
      return reply.code(400).send(fail('missing id/hashed_order'));
    }

    if (!status) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          validationFailure: webhookFailureShapeMeta({
            reason: 'missing_status',
            withdrawalId,
            status,
            statusKnown,
            hashedOrderPrefixed: hashedOrder.hadPrefix,
            hashedOrderValidHex: hashedOrder.validHex,
            hashedOrderLength: hashedOrder.digestLength,
            hashedOrderExpectedLength: hashedOrderAuditMeta.hashed_order_expected_length,
            hashedOrderLengthMatchesExpected: hashedOrderAuditMeta.hashed_order_length_matches_expected,
            hashedOrderHasNonHexChars: hashedOrder.digestHasNonHexChars,
            hashedOrderHadSurroundingWhitespace: hashedOrder.hadSurroundingWhitespace,
          }),
        },
        'opennode withdrawals webhook: missing status',
      );
      return reply.code(400).send(fail('missing status'));
    }

    const calculated = hmacHex(apiKey, withdrawalId);
    if (!safeHexEquals(calculated, received)) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          authFailure: webhookFailureShapeMeta({
            reason: 'hashed_order_mismatch',
            withdrawalId,
            status,
            statusKnown,
            hashedOrderPrefixed: hashedOrder.hadPrefix,
            hashedOrderValidHex: hashedOrder.validHex,
            hashedOrderLength: hashedOrder.digestLength,
            hashedOrderExpectedLength: hashedOrderAuditMeta.hashed_order_expected_length,
            hashedOrderLengthMatchesExpected: hashedOrderAuditMeta.hashed_order_length_matches_expected,
            hashedOrderHasNonHexChars: hashedOrder.digestHasNonHexChars,
            hashedOrderHadSurroundingWhitespace: hashedOrder.hadSurroundingWhitespace,
          }),
        },
        'opennode withdrawals webhook: invalid hashed_order',
      );
      return reply.code(401).send(fail('Unauthorized'));
    }

    if (typeMeta.type && !typeMeta.type_known) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          typeDrift: webhookTypeDriftMeta({
            withdrawalId,
            type: typeMeta.type,
            typeRaw: typeMeta.type_raw,
            typeKnown: typeMeta.type_known,
          }),
        },
        'opennode withdrawals webhook: unknown type received',
      );
    }

    const payout = await prisma.payout.findFirst({ where: { provider: 'opennode', providerWithdrawalId: withdrawalId } });
    if (!payout) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          lookupMiss: webhookLookupMissMeta({
            withdrawalId,
            status,
            statusKnown,
            type: typeMeta.type,
            typeKnown: typeMeta.type_known,
          }),
        },
        'opennode withdrawals webhook: payout not found',
      );
      // 200 to prevent webhook retries from hammering us forever.
      return reply.code(200).send(ok({}));
    }

    const payoutIdAuditMeta = webhookPayoutIdAuditMeta(withdrawalId, payout.providerWithdrawalId);

    if (!payoutIdAuditMeta.provider_withdrawal_id_matches) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          providerIdMismatch: webhookProviderIdMismatchMeta({
            withdrawalId,
            providerWithdrawalId: payoutIdAuditMeta.provider_withdrawal_id,
            providerWithdrawalIdLength: payoutIdAuditMeta.provider_withdrawal_id_length,
            providerWithdrawalIdMatches: payoutIdAuditMeta.provider_withdrawal_id_matches,
            providerWithdrawalIdCasefoldMatches: payoutIdAuditMeta.provider_withdrawal_id_casefold_matches,
          }),
        },
        'opennode withdrawals webhook: provider withdrawal id mismatch',
      );
    }

    const webhookMetaWithPayoutId = {
      ...webhookMeta,
      ...payoutIdAuditMeta,
    };

    if (status === 'confirmed') {
      if (!processedAtMeta.processed_at_valid) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            confirmedTimingAnomaly: webhookConfirmedTimingAnomalyMeta({
              withdrawalId,
              statusRaw: statusMeta.status_raw,
              processedAt: processedAtMeta.processed_at,
              processedAtIso: processedAtMeta.processed_at_iso,
              processedAtValid: processedAtMeta.processed_at_valid,
            }),
          },
          'opennode withdrawals webhook: confirmed status missing/invalid processed_at',
        );
      }

      if (amountFeeAuditMeta.fee_equal_amount) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            confirmedFeeEqualsAmount: webhookConfirmedFeeEqualsAmountMeta({
              withdrawalId,
              statusRaw: statusMeta.status_raw,
              amountValid: amountMeta.valid,
              amountNumber: amountMeta.number,
              feeValid: feeMeta.valid,
              feeNumber: feeMeta.number,
            }),
          },
          'opennode withdrawals webhook: confirmed fee equals amount',
        );
      }

      if (amountFeeAuditMeta.fee_greater_than_amount) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            confirmedFeeGreaterThanAmount: webhookConfirmedFeeGreaterThanAmountMeta({
              withdrawalId,
              statusRaw: statusMeta.status_raw,
              amountValid: amountMeta.valid,
              amountNumber: amountMeta.number,
              feeValid: feeMeta.valid,
              feeNumber: feeMeta.number,
            }),
          },
          'opennode withdrawals webhook: confirmed fee greater than amount',
        );
      }

      if (amountFeeAuditMeta.amount_zero) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            confirmedZeroAmount: webhookConfirmedZeroAmountMeta({
              withdrawalId,
              statusRaw: statusMeta.status_raw,
              amountValid: amountMeta.valid,
              amountNumber: amountMeta.number,
              feeValid: feeMeta.valid,
              feeNumber: feeMeta.number,
            }),
          },
          'opennode withdrawals webhook: confirmed amount is zero',
        );
      }

      if (amountFeeAuditMeta.fee_negative) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            confirmedNegativeFee: webhookConfirmedNegativeFeeMeta({
              withdrawalId,
              statusRaw: statusMeta.status_raw,
              amountValid: amountMeta.valid,
              amountNumber: amountMeta.number,
              feeValid: feeMeta.valid,
              feeNumber: feeMeta.number,
            }),
          },
          'opennode withdrawals webhook: confirmed fee is negative',
        );
      }

      if (statusErrorAuditMeta.error_present_on_confirmed) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            confirmedStatusError: webhookConfirmedStatusErrorMeta({
              withdrawalId,
              statusRaw: statusMeta.status_raw,
              errorPresent: statusErrorAuditMeta.error_present,
              type: typeMeta.type,
              typeKnown: typeMeta.type_known,
            }),
          },
          'opennode withdrawals webhook: confirmed status included error payload',
        );
      }

      // Mark SENT only on confirmation + write idempotent ledger entry.
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.payout.findUnique({ where: { id: payout.id } });
        if (!fresh) return;

        if (fresh.status !== 'SENT') {
          await tx.payout.update({
            where: { id: fresh.id },
            data: {
              status: 'SENT',
              confirmedAt: new Date(),
              lastError: null,
              providerMetaJson: {
                ...(typeof fresh.providerMetaJson === 'object' && fresh.providerMetaJson ? (fresh.providerMetaJson as any) : {}),
                webhook: {
                  ...webhookMetaWithPayoutId,
                  error: null,
                },
              },
            },
          });
        } else {
          // Even if we're already SENT (e.g., webhook retry), persist webhook meta for auditability.
          // Keep this behavior-neutral: no status/confirmedAt changes, just providerMetaJson.
          await tx.payout.update({
            where: { id: fresh.id },
            data: {
              providerMetaJson: {
                ...(typeof fresh.providerMetaJson === 'object' && fresh.providerMetaJson ? (fresh.providerMetaJson as any) : {}),
                webhook: {
                  ...webhookMetaWithPayoutId,
                  error: null,
                },
              },
            },
          });
        }

        const existing = await tx.ledgerEntry.findFirst({ where: { purchaseId: fresh.purchaseId, type: 'PAYOUT_SENT' } });
        if (!existing) {
          try {
            await tx.ledgerEntry.create({
              data: {
                purchaseId: fresh.purchaseId,
                type: 'PAYOUT_SENT',
                amountMsat: fresh.amountMsat,
                dedupeKey: `payout_sent:${fresh.purchaseId}`,
                metaJson: {
                  payoutId: fresh.id,
                  provider: fresh.provider,
                  providerWithdrawalId: fresh.providerWithdrawalId,
                },
              },
            });
          } catch (e) {
            const code = (e as any)?.code;
            if (code !== 'P2002') throw e;
          }
        }
      });

      return reply.code(200).send(ok({}));
    }

    if (status === 'error' || status === 'failed') {
      if (!processedAtMeta.processed_at_valid) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            failureTimingAnomaly: webhookFailureTimingAnomalyMeta({
              withdrawalId,
              status,
              statusRaw: statusMeta.status_raw,
              processedAt: processedAtMeta.processed_at,
              processedAtIso: processedAtMeta.processed_at_iso,
              processedAtValid: processedAtMeta.processed_at_valid,
            }),
          },
          'opennode withdrawals webhook: failure status missing/invalid processed_at',
        );
      }

      if (amountFeeAuditMeta.fee_equal_amount) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            failureFeeEqualsAmount: webhookFailureFeeEqualsAmountMeta({
              withdrawalId,
              status,
              statusRaw: statusMeta.status_raw,
              amountValid: amountMeta.valid,
              amountNumber: amountMeta.number,
              feeValid: feeMeta.valid,
              feeNumber: feeMeta.number,
            }),
          },
          'opennode withdrawals webhook: failure fee equals amount',
        );
      }

      if (amountFeeAuditMeta.fee_greater_than_amount) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            failureFeeGreaterThanAmount: webhookFailureFeeGreaterThanAmountMeta({
              withdrawalId,
              status,
              statusRaw: statusMeta.status_raw,
              amountValid: amountMeta.valid,
              amountNumber: amountMeta.number,
              feeValid: feeMeta.valid,
              feeNumber: feeMeta.number,
            }),
          },
          'opennode withdrawals webhook: failure fee greater than amount',
        );
      }

      if (amountFeeAuditMeta.amount_zero) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            failureZeroAmount: webhookFailureZeroAmountMeta({
              withdrawalId,
              status,
              statusRaw: statusMeta.status_raw,
              amountValid: amountMeta.valid,
              amountNumber: amountMeta.number,
              feeValid: feeMeta.valid,
              feeNumber: feeMeta.number,
            }),
          },
          'opennode withdrawals webhook: failure amount is zero',
        );
      }

      if (amountFeeAuditMeta.amount_negative) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            failureNegativeAmount: webhookFailureNegativeAmountMeta({
              withdrawalId,
              status,
              statusRaw: statusMeta.status_raw,
              amountValid: amountMeta.valid,
              amountNumber: amountMeta.number,
              feeValid: feeMeta.valid,
              feeNumber: feeMeta.number,
            }),
          },
          'opennode withdrawals webhook: failure amount is negative',
        );
      }

      if (amountFeeAuditMeta.fee_negative) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            failureNegativeFee: webhookFailureNegativeFeeMeta({
              withdrawalId,
              status,
              statusRaw: statusMeta.status_raw,
              amountValid: amountMeta.valid,
              amountNumber: amountMeta.number,
              feeValid: feeMeta.valid,
              feeNumber: feeMeta.number,
            }),
          },
          'opennode withdrawals webhook: failure fee is negative',
        );
      }

      if (!error) {
        req.log.warn(
          {
            route: 'opennode.withdrawals',
            failureStatusAnomaly: webhookFailureStatusMeta({
              withdrawalId,
              status,
              statusKnown,
              errorPresent: false,
              errorTruncated: error_truncated,
            }),
          },
          'opennode withdrawals webhook: failure status missing error',
        );
      }

      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'FAILED',
          lastError: error ?? `opennode withdrawal ${withdrawalId} status=${status}`,
          providerMetaJson: {
            ...(typeof payout.providerMetaJson === 'object' && payout.providerMetaJson ? (payout.providerMetaJson as any) : {}),
            webhook: webhookMetaWithPayoutId,
          },
        },
      });

      return reply.code(200).send(ok({}));
    }

    // Unknown status; keep payout in SUBMITTED, but record receipt.
    req.log.warn(
      {
        route: 'opennode.withdrawals',
        unknownStatus: webhookUnknownStatusMeta({
          withdrawalId,
          status,
          statusKnown,
          statusRaw: statusMeta.status_raw,
          type: typeMeta.type,
          typeKnown: typeMeta.type_known,
        }),
      },
      'opennode withdrawals webhook: unknown status acked',
    );

    if (statusErrorAuditMeta.error_present_on_unknown_status) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          unknownStatusError: webhookUnknownStatusErrorMeta({
            withdrawalId,
            status,
            statusRaw: statusMeta.status_raw,
            errorPresent: statusErrorAuditMeta.error_present,
            type: typeMeta.type,
            typeKnown: typeMeta.type_known,
          }),
        },
        'opennode withdrawals webhook: unknown status included error payload',
      );
    }

    if (!statusKnown && typeMeta.type_known) {
      req.log.warn(
        {
          route: 'opennode.withdrawals',
          unknownWithdrawalStatus: webhookUnknownWithdrawalStatusMeta({
            withdrawalId,
            status,
            statusRaw: statusMeta.status_raw,
            statusKnown,
            type: typeMeta.type,
            typeKnown: typeMeta.type_known,
          }),
        },
        'opennode withdrawals webhook: unknown status on withdrawal type observed',
      );
    }

    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        providerMetaJson: {
          ...(typeof payout.providerMetaJson === 'object' && payout.providerMetaJson ? (payout.providerMetaJson as any) : {}),
          webhook: webhookMetaWithPayoutId,
        },
      },
    });

    return reply.code(200).send(ok({}));
  });
}
