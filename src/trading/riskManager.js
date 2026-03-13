'use strict';

const config = require('../config/config');
const logger = require('../utils/logger');
const { tradeStateManager } = require('../memory/tradeStateManager');

/**
 * riskManager.js
 * Validates whether a proposed trade action is allowed based on risk rules.
 * Returns { allowed: boolean, reason: string }
 */

/**
 * Index symbols that can NEVER be traded as EQ (cash segment).
 * They can only be traded as OPTIONs or FUTUREs.
 */
const INDEX_SYMBOLS = new Set([
  'NIFTY',
  'BANKNIFTY',
  'FINNIFTY',
  'MIDCPNIFTY',
  'NIFTYNXT50',
  'SENSEX',
  'BANKEX',
  'NIFTYIT',
  'NIFTYPSE',
  'NIFTYMETAL',
  'NIFTYPHARMA',
  'NIFTYFMCG',
  'NIFTYAUTO',
  'NIFTYREALTY',
  'NIFTYENERGY',
  'NIFTYINFRA',
  'NIFTYSMALLCAP',
  'NIFTYMIDCAP',
]);

/**
 * Checks all risk rules for a new trade signal.
 * @param {object} signal - Parsed & validated signal from signalParser
 * @returns {{ allowed: boolean, reason: string }}
 */
function validateNewTrade(signal) {
  // ── 0. Block direct index EQ trades ──────────────────────────
  const sym = (signal.symbol || '').toUpperCase().trim();
  if (INDEX_SYMBOLS.has(sym) && signal.instrument_type === 'EQ') {
    return {
      allowed: false,
      reason: `Direct index EQ trade blocked: "${sym}" is a market index and cannot be traded as an equity. Use OPTION or FUTURE instead.`,
    };
  }
  // ── 1. Max trades per day check ───────────────────────────────
  const tradesToday = tradeStateManager.getTradesToday();
  if (tradesToday >= config.MAX_TRADES_PER_DAY) {
    return {
      allowed: false,
      reason: `Max trades per day reached (${tradesToday}/${config.MAX_TRADES_PER_DAY})`,
    };
  }

  // ── 2. Max daily loss check ───────────────────────────────────
  const dailyPnL = tradeStateManager.getDailyPnL();
  if (dailyPnL <= -Math.abs(config.MAX_DAILY_LOSS)) {
    return {
      allowed: false,
      reason: `Daily loss limit breached (PnL: ₹${dailyPnL.toFixed(2)})`,
    };
  }

  // ── 3. Duplicate trade check ──────────────────────────────────
  const { generateTradeKey } = require('../llm/signalParser');
  const tradeKey = generateTradeKey(signal);
  if (tradeStateManager.hasTrade(tradeKey)) {
    return {
      allowed: false,
      reason: `Duplicate trade detected for key: ${tradeKey}`,
    };
  }

  // ── 4. Entry price sanity check ───────────────────────────────
  if (signal.entry_price <= 0) {
    return { allowed: false, reason: 'Entry price must be > 0' };
  }

  // ── 5. Stop loss sanity check ─────────────────────────────────
  if (config.ENABLE_STOP_LOSS && signal.stop_loss) {
    if (signal.direction === 'BUY' && signal.stop_loss >= signal.entry_price) {
      return {
        allowed: false,
        reason: `SL (${signal.stop_loss}) must be below entry (${signal.entry_price}) for BUY`,
      };
    }
    if (signal.direction === 'SELL' && signal.stop_loss <= signal.entry_price) {
      return {
        allowed: false,
        reason: `SL (${signal.stop_loss}) must be above entry (${signal.entry_price}) for SELL`,
      };
    }
  }

  // ── 6. Target sanity check ────────────────────────────────────
  if (config.ENABLE_TARGETS && signal.targets && signal.targets.length > 0) {
    for (const target of signal.targets) {
      if (signal.direction === 'BUY' && target <= signal.entry_price) {
        return {
          allowed: false,
          reason: `Target (${target}) must be above entry (${signal.entry_price}) for BUY`,
        };
      }
      if (signal.direction === 'SELL' && target >= signal.entry_price) {
        return {
          allowed: false,
          reason: `Target (${target}) must be below entry (${signal.entry_price}) for SELL`,
        };
      }
    }
  }

  return { allowed: true, reason: 'All risk checks passed' };
}

/**
 * Validates modification actions (UPDATE_STOP_LOSS, UPDATE_TRAILING_SL, UPDATE_TARGET etc.)
 * @param {string} tradeKey
 * @param {object} signal
 * @returns {{ allowed: boolean, reason: string }}
 */
function validateModification(tradeKey, signal) {
  const trade = tradeStateManager.getTrade(tradeKey);
  if (!trade) {
    return {
      allowed: false,
      reason: `No active trade found for key: ${tradeKey} — cannot modify`,
    };
  }
  return { allowed: true, reason: 'Modification allowed' };
}

/**
 * Checks if the combined real-time loss (realized + unrealized)
 * has breached the daily limit.
 * 
 * @returns {{ breach: boolean, totalPnL: number, limit: number }}
 */
function checkLiveHardStop() {
  const snapshot = tradeStateManager.getSnapshot();
  const limit = -Math.abs(config.MAX_DAILY_LOSS);

  if (snapshot.totalPnL <= limit) {
    return {
      breach: true,
      totalPnL: snapshot.totalPnL,
      limit,
    };
  }

  return { breach: false, totalPnL: snapshot.totalPnL, limit };
}

/**
 * General risk gate — dispatches to the right validator based on action.
 * @param {object} signal
 * @param {string} tradeKey
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkRisk(signal, tradeKey) {
  switch (signal.action) {
    case 'NEW_TRADE':
      return validateNewTrade(signal);

    case 'EXIT_POSITION':
    case 'EARLY_EXIT':
    case 'UPDATE_STOP_LOSS':
    case 'UPDATE_TRAILING_SL':
    case 'UPDATE_TARGET':
    case 'PARTIAL_BOOK':
    case 'CANCEL_PENDING_ORDER':
      return validateModification(tradeKey, signal);

    default:
      return { allowed: false, reason: `Unknown action: ${signal.action}` };
  }
}

module.exports = {
  checkRisk,
  validateNewTrade,
  validateModification,
  checkLiveHardStop,
};
