'use strict';

/**
 * tradeStateManager.js
 * In-memory store for all active trades, pending orders, and daily stats.
 * All state is lost on restart — use a DB for persistence in production.
 */

class TradeStateManager {
  constructor() {
    this._activeTrades = {};       // tradeKey → tradeObject
    this._pendingOrders = {};      // orderId → orderObject
    this._tradesToday = 0;
    this._dailyPnL = 0;
    this._startedAt = new Date().toDateString();
  }

  // ── Daily Reset ─────────────────────────────────────────────
  _checkDayReset() {
    const today = new Date().toDateString();
    if (today !== this._startedAt) {
      this._tradesToday = 0;
      this._dailyPnL = 0;
      this._startedAt = today;
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
    return this._activeTrades[tradeKey];
  }

  /**
   * Closes a trade and realises PnL.
   * @param {string} tradeKey
   * @param {number} exitPrice
   * @param {string} exitReason
   */
  closeTrade(tradeKey, exitPrice, exitReason = 'MANUAL') {
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

    return closed;
  }

  // ── Pending Orders ──────────────────────────────────────────

  addPendingOrder(orderId, order) {
    this._pendingOrders[orderId] = {
      ...order,
      createdAt: new Date().toISOString(),
    };
  }

  getPendingOrder(orderId) {
    return this._pendingOrders[orderId];
  }

  removePendingOrder(orderId) {
    const order = this._pendingOrders[orderId];
    delete this._pendingOrders[orderId];
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
    return {
      activeTrades: this.getActiveTrades(),
      pendingOrders: this.getPendingOrders(),
      tradesToday: this._tradesToday,
      dailyPnL: this._dailyPnL,
    };
  }
}

// Singleton export
const tradeStateManager = new TradeStateManager();

module.exports = { tradeStateManager };
