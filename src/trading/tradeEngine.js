'use strict';

const config = require('../config/config');
const logger = require('../utils/logger');
const { tradeStateManager } = require('../memory/tradeStateManager');
const { checkRisk } = require('./riskManager');
const { generateTradeKey } = require('../llm/signalParser');
const upstox = require('./upstoxClient');

/**
 * tradeEngine.js
 * Orchestrates all trading actions based on parsed signals.
 * Dispatches to the correct Upstox function and updates trade state.
 */

/**
 * Main dispatcher — routes a signal to the correct handler.
 * @param {object} signal - Validated signal from parseSignal()
 */
async function executeSignal(signal) {
  const tradeKey = generateTradeKey(signal);

  logger.info(`[TradeEngine] Executing action: ${signal.action} | Key: ${tradeKey}`);

  // Risk gate
  const riskResult = checkRisk(signal, tradeKey);
  if (!riskResult.allowed) {
    logger.warn(`[TradeEngine] ❌ Risk check FAILED: ${riskResult.reason}`);
    return { success: false, reason: riskResult.reason };
  }

  try {
    switch (signal.action) {
      case 'NEW_TRADE':
        return await handleNewTrade(signal, tradeKey);

      case 'EXIT_POSITION':
        return await handleExitPosition(signal, tradeKey, 'EXIT_POSITION');

      case 'EARLY_EXIT':
        return await handleExitPosition(signal, tradeKey, 'EARLY_EXIT');

      case 'UPDATE_STOP_LOSS':
        return await handleUpdateStopLoss(signal, tradeKey);

      case 'UPDATE_TRAILING_SL':
        return await handleUpdateTrailingSL(signal, tradeKey);

      case 'UPDATE_TARGET':
        return await handleUpdateTarget(signal, tradeKey);

      case 'PARTIAL_BOOK':
        return await handlePartialBook(signal, tradeKey);

      case 'CANCEL_PENDING_ORDER':
        return await handleCancelPending(signal);

      default:
        logger.warn(`[TradeEngine] Unhandled action: ${signal.action}`);
        return { success: false, reason: 'Unhandled action' };
    }
  } catch (error) {
    logger.error(`[TradeEngine] Error executing ${signal.action}: ${error.message}`);
    return { success: false, reason: error.message, error };
  }
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Returns the lot size for a given symbol/index.
 * (Adjust values according to current NSE rules).
 */
function getLotSize(symbol) {
  const sym = (symbol || '').toUpperCase().trim();
  if (sym.includes('NIFTY') && !sym.includes('BANKNIFTY')) return 50;
  if (sym.includes('BANKNIFTY')) return 15;
  if (sym.includes('FINNIFTY')) return 40;
  if (sym.includes('MIDCPNIFTY')) return 75;
  if (sym.includes('SENSEX')) return 10;
  
  // Default to config quantity for unknown indices or equity
  return config.TRADE_QUANTITY_PER_LOT;
}

// ── Handlers ──────────────────────────────────────────────────

async function handleNewTrade(signal, tradeKey) {
  const instrumentToken = upstox.buildInstrumentToken(signal);
  const lotSize = getLotSize(signal.symbol);
  
  // Quantity is determined by: Configured Lots * Lot Size
  const quantity = config.TRADE_LOTS * lotSize;

  const orderResult = await upstox.placeOrder({
    instrumentToken,
    transactionType: signal.direction,
    quantity,
    price: signal.entry_price,
    orderType: 'LIMIT',
  });

  const orderId = orderResult?.data?.order_id;

  // Persist trade state
  const trade = tradeStateManager.addTrade(tradeKey, {
    tradeKey,
    symbol: signal.symbol,
    instrument_type: signal.instrument_type,
    strike_price: signal.strike_price || null,
    option_type: signal.option_type || null,
    direction: signal.direction,
    entry_price: signal.entry_price,
    stop_loss: signal.stop_loss,
    trailing_sl: signal.trailing_sl,
    targets: signal.targets,
    quantity,
    instrumentToken,
    orderId,
  });

  // Place stop loss order if configured
  if (config.ENABLE_STOP_LOSS && signal.stop_loss) {
    try {
      const slResult = await upstox.updateStopLoss(trade, signal.stop_loss);
      tradeStateManager.updateTrade(tradeKey, { slOrderId: slResult?.data?.order_id });
    } catch (err) {
      logger.warn(`[TradeEngine] SL order placement failed: ${err.message}`);
    }
  }

  // Place first target order if configured
  if (config.ENABLE_TARGETS && signal.targets?.length > 0) {
    try {
      const targetResult = await upstox.updateTarget(trade, signal.targets[0]);
      tradeStateManager.updateTrade(tradeKey, { targetOrderId: targetResult?.data?.order_id });
    } catch (err) {
      logger.warn(`[TradeEngine] Target order placement failed: ${err.message}`);
    }
  }

  logger.info(`[TradeEngine] ✅ NEW_TRADE opened → ${tradeKey} | orderId: ${orderId}`);
  return { success: true, tradeKey, orderId, trade };
}

async function handleExitPosition(signal, tradeKey, reason) {
  const trade = tradeStateManager.getTrade(tradeKey);
  if (!trade) {
    logger.warn(`[TradeEngine] No active trade to exit: ${tradeKey}`);
    return { success: false, reason: 'No active trade found' };
  }

  const orderResult = await upstox.exitPosition(trade);
  const orderId = orderResult?.data?.order_id;

  const closedTrade = tradeStateManager.closeTrade(tradeKey, signal.entry_price || trade.entry_price, reason);

  logger.info(`[TradeEngine] ✅ ${reason} → ${tradeKey} | PnL: ₹${closedTrade?.pnl?.toFixed(2)}`);
  return { success: true, tradeKey, orderId, closedTrade };
}

async function handleUpdateStopLoss(signal, tradeKey) {
  if (!config.ENABLE_STOP_LOSS) {
    return { success: false, reason: 'Stop loss updates are disabled' };
  }

  const trade = tradeStateManager.getTrade(tradeKey);
  if (!trade) return { success: false, reason: 'No active trade found' };

  const result = await upstox.updateStopLoss(trade, signal.stop_loss);
  tradeStateManager.updateTrade(tradeKey, {
    stop_loss: signal.stop_loss,
    slOrderId: result?.data?.order_id,
  });

  logger.info(`[TradeEngine] ✅ SL updated → ${tradeKey} | New SL: ${signal.stop_loss}`);
  return { success: true, tradeKey, newStopLoss: signal.stop_loss };
}

async function handleUpdateTrailingSL(signal, tradeKey) {
  if (!config.ENABLE_TRAILING_SL) {
    return { success: false, reason: 'Trailing SL is disabled' };
  }

  const trade = tradeStateManager.getTrade(tradeKey);
  if (!trade) return { success: false, reason: 'No active trade found' };

  // Compute actual trailing SL price from the current trailing_sl offset
  const newSL = signal.trailing_sl;

  const result = await upstox.updateStopLoss(trade, newSL);
  tradeStateManager.updateTrade(tradeKey, {
    trailing_sl: newSL,
    stop_loss: newSL,
    slOrderId: result?.data?.order_id,
  });

  logger.info(`[TradeEngine] ✅ Trailing SL updated → ${tradeKey} | New Trailing SL: ${newSL}`);
  return { success: true, tradeKey, newTrailingSL: newSL };
}

async function handleUpdateTarget(signal, tradeKey) {
  if (!config.ENABLE_TARGETS) {
    return { success: false, reason: 'Target updates are disabled' };
  }

  const trade = tradeStateManager.getTrade(tradeKey);
  if (!trade) return { success: false, reason: 'No active trade found' };

  const newTargets = signal.targets;
  if (!newTargets || newTargets.length === 0) {
    return { success: false, reason: 'No targets provided' };
  }

  const result = await upstox.updateTarget(trade, newTargets[0]);
  tradeStateManager.updateTrade(tradeKey, {
    targets: newTargets,
    targetOrderId: result?.data?.order_id,
  });

  logger.info(`[TradeEngine] ✅ Target updated → ${tradeKey} | Targets: ${newTargets.join(', ')}`);
  return { success: true, tradeKey, newTargets };
}

async function handlePartialBook(signal, tradeKey) {
  const trade = tradeStateManager.getTrade(tradeKey);
  if (!trade) return { success: false, reason: 'No active trade found' };

  const percent = signal.partial_percent || 50;
  const result = await upstox.partialBook(trade, percent);

  if (!result) {
    return { success: false, reason: 'Partial qty resolved to 0' };
  }

  const newQty = trade.quantity - Math.floor((trade.quantity * percent) / 100);
  tradeStateManager.updateTrade(tradeKey, { quantity: newQty });

  logger.info(`[TradeEngine] ✅ PARTIAL_BOOK → ${tradeKey} | Booked ${percent}% | Remaining qty: ${newQty}`);
  return { success: true, tradeKey, bookedPercent: percent };
}

async function handleCancelPending(signal) {
  // The signal should carry an orderId or we look it up from pending orders
  const pendingOrders = tradeStateManager.getPendingOrders();
  const target = pendingOrders.find(
    (o) => o.symbol === signal.symbol && o.status === 'PENDING'
  );

  if (!target) {
    logger.warn('[TradeEngine] No matching pending order found to cancel');
    return { success: false, reason: 'No matching pending order' };
  }

  await upstox.cancelOrder(target.orderId);
  tradeStateManager.removePendingOrder(target.orderId);

  logger.info(`[TradeEngine] ✅ CANCEL_PENDING_ORDER → orderId: ${target.orderId}`);
  return { success: true, cancelledOrderId: target.orderId };
}

module.exports = { executeSignal };
