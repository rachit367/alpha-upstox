'use strict';

const logger = require('../utils/logger');

// All valid actions
const VALID_ACTIONS = [
  'NEW_TRADE',
  'EXIT_POSITION',
  'EARLY_EXIT',
  'UPDATE_STOP_LOSS',
  'UPDATE_TRAILING_SL',
  'UPDATE_TARGET',
  'PARTIAL_BOOK',
  'CANCEL_PENDING_ORDER',
  'NO_ACTION',
];

const VALID_INSTRUMENT_TYPES = ['OPTION', 'FUTURE', 'EQ'];
const VALID_OPTION_TYPES = ['CE', 'PE'];
const VALID_DIRECTIONS = ['BUY', 'SELL'];

/**
 * Parses and validates the raw JSON string from the LLM.
 * Returns null if the signal is invalid or is NO_ACTION.
 * @param {string} rawJson
 * @returns {{ signal: object, isActionable: boolean } | null}
 */
function parseSignal(rawJson) {
  let signal;

  // ── 1. Parse JSON ────────────────────────────────────────────
  try {
    signal = JSON.parse(rawJson);
  } catch (err) {
    logger.error(`[SignalParser] Failed to parse LLM JSON: ${err.message}`);
    logger.debug(`[SignalParser] Raw response was: ${rawJson}`);
    return null;
  }

  logger.debug(`[SignalParser] Parsed signal: ${JSON.stringify(signal)}`);

  // ── 2. Validate action ───────────────────────────────────────
  if (!signal.action || !VALID_ACTIONS.includes(signal.action)) {
    logger.warn(`[SignalParser] Invalid or missing action: ${signal.action}`);
    return null;
  }

  // ── 3. Early exit for NO_ACTION ──────────────────────────────
  if (signal.action === 'NO_ACTION') {
    logger.info(`[SignalParser] No action required. Reason: ${signal.reason || 'N/A'}`);
    return { signal, isActionable: false };
  }

  // ── 4. Validate required fields for actionable signals ───────
  if (!signal.symbol || typeof signal.symbol !== 'string') {
    logger.warn('[SignalParser] Missing or invalid symbol');
    return null;
  }

  signal.symbol = signal.symbol.toUpperCase().trim();

  // Instrument type
  if (!VALID_INSTRUMENT_TYPES.includes(signal.instrument_type)) {
    logger.warn(`[SignalParser] Invalid instrument_type: ${signal.instrument_type}`);
    return null;
  }

  // For NEW_TRADE, more fields are required
  if (signal.action === 'NEW_TRADE') {
    if (!VALID_DIRECTIONS.includes(signal.direction)) {
      logger.warn(`[SignalParser] Invalid direction: ${signal.direction}`);
      return null;
    }

    if (signal.instrument_type === 'OPTION') {
      if (!VALID_OPTION_TYPES.includes(signal.option_type)) {
        logger.warn(`[SignalParser] Missing option_type for OPTION trade`);
        return null;
      }
      if (!signal.strike_price || typeof signal.strike_price !== 'number') {
        logger.warn(`[SignalParser] Missing strike_price for OPTION trade`);
        return null;
      }
    }

    if (!signal.entry_price || typeof signal.entry_price !== 'number') {
      logger.warn('[SignalParser] Missing entry_price for NEW_TRADE');
      return null;
    }
  }

  // Sanitize numeric fields
  signal.stop_loss = signal.stop_loss || null;
  signal.trailing_sl = signal.trailing_sl || null;
  signal.targets = Array.isArray(signal.targets) ? signal.targets.filter((t) => typeof t === 'number') : [];
  signal.partial_percent = signal.partial_percent || null;

  logger.info(
    `[SignalParser] ✅ Valid signal — Action: ${signal.action} | Symbol: ${signal.symbol} | Direction: ${signal.direction || 'N/A'}`
  );

  return { signal, isActionable: true };
}

/**
 * Generates a unique trade key for deduplication.
 * @param {object} signal
 * @returns {string}
 */
function generateTradeKey(signal) {
  const parts = [
    signal.symbol,
    signal.instrument_type,
    signal.option_type || '',
    signal.strike_price || '',
    signal.direction,
  ];
  return parts.join('_').toUpperCase();
}

module.exports = {
  parseSignal,
  generateTradeKey,
  VALID_ACTIONS,
};
