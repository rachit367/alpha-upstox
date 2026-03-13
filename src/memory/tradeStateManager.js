'use strict';

/**
 * tradeStateManager.js
 * Store for all active trades, pending orders, and daily stats.
 * Uses a local JSON file to persist state across restarts.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const STATE_FILE = path.join(__dirname, '../../data', 'state.json');

class TradeStateManager {
  constructor() {
    this._activeTrades = {};       // tradeKey → tradeObject
    this._pendingOrders = {};      // orderId → orderObject
    this._tradesToday = 0;
    this._dailyPnL = 0;
    this._startedAt = new Date().toDateString();
    
    this._loadState();
  }

  // ── Persistence ─────────────────────────────────────────────
  
  _loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(data);
        
        this._activeTrades = parsed.activeTrades || {};
        this._pendingOrders = parsed.pendingOrders || {};
        this._tradesToday = parsed.tradesToday || 0;
        this._dailyPnL = parsed.dailyPnL || 0;
        this._startedAt = parsed.startedAt || new Date().toDateString();
        
        // Ensure day reset runs on load if dates mismatch
        this._checkDayReset();
        
        logger.info(`[TradeState] Loaded state from disk. Active trades: ${Object.keys(this._activeTrades).length}`);
      }
    } catch (err) {
      logger.error(`[TradeState] Failed to load state: ${err.message}`);
    }
  }

  _saveState() {
    try {
      const state = {
        activeTrades: this._activeTrades,
        pendingOrders: this._pendingOrders,
        tradesToday: this._tradesToday,
        dailyPnL: this._dailyPnL,
        startedAt: this._startedAt,
      };
      
      // Ensure directory exists
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      logger.error(`[TradeState] Failed to save state to disk: ${err.message}`);
    }
  }

  // ── Daily Reset ─────────────────────────────────────────────
  
  _checkDayReset() {
    const today = new Date().toDateString();
    if (today !== this._startedAt) {
      this._tradesToday = 0;
      this._dailyPnL = 0;
      this._startedAt = today;
      this._saveState();
    }
  }

  // ── Active Trades ───────────────────────────────────────────

  /**
   * Adds a new trade to the active trades map.
   * @param {string} tradeKey - Unique identifier for the trade
   * @param {object} trade    - Trade details
   */
  addTrade(tradeKey, trade) {
    this._activeTrades[tradeKey] = {
      ...trade,
      openedAt: new Date().toISOString(),
      status: 'OPEN',
    };
    this._tradesToday++;
    this._saveState();
    return this._activeTrades[tradeKey];
  }

  /**
   * Returns a trade by key, or undefined if not found.
   */
  getTrade(tradeKey) {
    return this._activeTrades[tradeKey];
  }

  /**
   * Returns all active trades as an array.
   */
  getActiveTrades() {
    return Object.values(this._activeTrades);
  }

  /**
   * Checks whether an identical trade is already open.
   */
  hasTrade(tradeKey) {
    return !!this._activeTrades[tradeKey];
  }

  /**
   * Updates fields on an existing trade.
   */
  updateTrade(tradeKey, updates) {
    if (!this._activeTrades[tradeKey]) return null;
    this._activeTrades[tradeKey] = {
      ...this._activeTrades[tradeKey],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this._saveState();
    return this._activeTrades[tradeKey];
  }

  /**
   * Updates the live price for all active trades matching the symbol/token.
   * @param {string} instrumentToken 
   * @param {number} ltp 
   */
  updateLivePrice(instrumentToken, ltp) {
    let updated = false;

    for (const tradeKey in this._activeTrades) {
      const trade = this._activeTrades[tradeKey];
      
      if (trade.instrumentToken === instrumentToken) {
        trade.liveLTP = ltp;
        
        // Recalculate floating PnL
        const qty = trade.quantity || 1;
        const multiplier = trade.direction === 'BUY' ? 1 : -1;
        trade.livePnL = (ltp - trade.entry_price) * qty * multiplier;
        
        trade.lastPriceUpdate = new Date().toISOString();
        updated = true;
      }
    }

    // We don't save to disk on EVERY price tick (too many writes), 
    // but the in-memory state remains fresh.
    return updated;
  }

  /**
   * Closes a trade and realises PnL.
   * @param {string} tradeKey
   * @param {number} exitPrice
   * @param {string} exitReason
   */
  async closeTrade(tradeKey, exitPrice, exitReason = 'MANUAL') {
    const trade = this._activeTrades[tradeKey];
    if (!trade) return null;

    const qty = trade.quantity || 1;
    const multiplier = trade.direction === 'BUY' ? 1 : -1;
    const pnl = (exitPrice - trade.entry_price) * qty * multiplier;

    this._dailyPnL += pnl;

    const closed = {
      ...trade,
      exitPrice,
      exitReason,
      pnl,
      closedAt: new Date().toISOString(),
      status: 'CLOSED',
    };

    delete this._activeTrades[tradeKey];
    this._saveState();

    // Persist to MongoDB Journal (Fire and forget or await)
    try {
      const { saveTrade } = require('../trading/journalManager');
      saveTrade(closed).catch(err => logger.error(`[TradeState] Async journal save failed: ${err.message}`));
    } catch (err) {
      logger.error(`[TradeState] Journaling module error: ${err.message}`);
    }

    return closed;
  }

  // ── Pending Orders ──────────────────────────────────────────

  addPendingOrder(orderId, order) {
    this._pendingOrders[orderId] = {
      ...order,
      createdAt: new Date().toISOString(),
    };
    this._saveState();
  }

  getPendingOrder(orderId) {
    return this._pendingOrders[orderId];
  }

  removePendingOrder(orderId) {
    const order = this._pendingOrders[orderId];
    delete this._pendingOrders[orderId];
    this._saveState();
    return order;
  }

  getPendingOrders() {
    return Object.values(this._pendingOrders);
  }

  // ── Stats ───────────────────────────────────────────────────

  getTradesToday() {
    this._checkDayReset();
    return this._tradesToday;
  }

  getDailyPnL() {
    return this._dailyPnL;
  }

  getSnapshot() {
    const activeTrades = this.getActiveTrades();
    const livePnL = activeTrades.reduce((sum, t) => sum + (t.livePnL || 0), 0);

    return {
      activeTrades,
      pendingOrders: this.getPendingOrders(),
      tradesToday: this._tradesToday,
      realizedPnL: this._dailyPnL,
      unrealizedPnL: livePnL,
      totalPnL: this._dailyPnL + livePnL,
    };
  }
}

// Singleton export
const tradeStateManager = new TradeStateManager();

module.exports = { tradeStateManager };
