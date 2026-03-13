'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * journalManager.js
 * Manages permanent storage of closed trades for performance tracking.
 */

// ── Schema Definition ─────────────────────────────────────────

const TradeJournalSchema = new mongoose.Schema({
  tradeKey: { type: String, required: true, index: true },
  symbol: { type: String, required: true, index: true },
  instrument_type: String,
  strike_price: Number,
  option_type: String,
  direction: String,
  entry_price: { type: Number, required: true },
  exit_price: { type: Number, required: true },
  quantity: Number,
  pnl: { type: Number, required: true },
  exit_reason: String,
  openedAt: Date,
  closedAt: { type: Date, default: Date.now, index: true },
  instrumentToken: String,
  orderId: String,
  slOrderId: String,
  targetOrderId: String,
}, { 
  timestamps: true 
});

const TradeJournal = mongoose.models.TradeJournal || mongoose.model('TradeJournal', TradeJournalSchema);

/**
 * Saves a closed trade to the journal.
 * @param {object} trade - The closed trade object from tradeStateManager
 */
async function saveTrade(trade) {
  try {
    const entry = new TradeJournal({
      tradeKey: trade.tradeKey,
      symbol: trade.symbol,
      instrument_type: trade.instrument_type,
      strike_price: trade.strike_price,
      option_type: trade.option_type,
      direction: trade.direction,
      entry_price: trade.entry_price,
      exit_price: trade.exitPrice, // tradeStateManager uses exitPrice for closed trades
      quantity: trade.quantity,
      pnl: trade.pnl,
      exit_reason: trade.exitReason,
      openedAt: new Date(trade.openedAt),
      closedAt: new Date(trade.closedAt),
      instrumentToken: trade.instrumentToken,
      orderId: trade.orderId,
      slOrderId: trade.slOrderId,
      targetOrderId: trade.targetOrderId,
    });

    await entry.save();
    logger.info(`[Journal] Trade saved: ${trade.tradeKey} | PnL: ₹${trade.pnl.toFixed(2)}`);
    return entry;
  } catch (err) {
    logger.error(`[Journal] Failed to save trade ${trade.tradeKey}: ${err.message}`);
    throw err;
  }
}

/**
 * Returns historical trades from the journal.
 */
async function getHistory(limit = 50, skip = 0) {
  try {
    return await TradeJournal.find()
      .sort({ closedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  } catch (err) {
    logger.error(`[Journal] Failed to fetch history: ${err.message}`);
    throw err;
  }
}

/**
 * Calculates high-level performance metrics.
 */
async function getPerformanceStats() {
  try {
    const stats = await TradeJournal.aggregate([
      {
        $group: {
          _id: null,
          totalTrades: { $sum: 1 },
          totalPnL: { $sum: '$pnl' },
          winningTrades: { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
          losingTrades: { $sum: { $cond: [{ $lt: ['$pnl', 0] }, 1, 0] } },
          maxPnL: { $max: '$pnl' },
          minPnL: { $min: '$pnl' },
        }
      }
    ]);

    if (stats.length === 0) return null;

    const summary = stats[0];
    summary.winRate = (summary.winningTrades / summary.totalTrades) * 100;
    
    return summary;
  } catch (err) {
    logger.error(`[Journal] Failed to fetch stats: ${err.message}`);
    throw err;
  }
}

module.exports = {
  saveTrade,
  getHistory,
  getPerformanceStats,
  TradeJournal,
};
