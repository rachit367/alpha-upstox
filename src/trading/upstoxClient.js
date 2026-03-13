'use strict';

const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * upstoxClient.js
 * Full Upstox API client built against the real v2/v3 API docs.
 *
 * Endpoints used:
 *  POST   /v3/order/place            → placeOrder
 *  PUT    /v3/order/modify           → modifyOrder
 *  DELETE /v3/order/cancel           → cancelOrder
 *  POST   /v2/order/positions/exit   → exitAllPositions
 *  GET    /v2/portfolio/short-term-positions → getPositions
 *  GET    /v2/order/retrieve-all     → getOrderBook
 *  GET    /v2/order/details          → getOrderDetails
 *  GET    /v2/order/trades           → getTradesByOrder
 *
 * Two base URLs used per Upstox docs:
 *  - HFT (High Frequency Trading) base for order placement: https://api-hft.upstox.com
 *  - Standard base for portfolio/query:                     https://api.upstox.com
 */

const UPSTOX_HFT_BASE  = 'https://api-hft.upstox.com';
const UPSTOX_STD_BASE  = process.env.UPSTOX_BASE_URL || 'https://api.upstox.com';

// ── Shared header builder ─────────────────────────────────────
function buildHeaders() {
  return {
    Authorization: `Bearer ${config.UPSTOX_ACCESS_TOKEN}`,
    'Api-Version': '2.0',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

// ── Axios clients ─────────────────────────────────────────────
function makeClient(baseURL) {
  const client = axios.create({
    baseURL,
    timeout: 15000,
    headers: buildHeaders(),
  });

  client.interceptors.response.use(
    (res) => {
      logger.debug(`[Upstox] ${res.config.method.toUpperCase()} ${res.config.url} → ${res.status}`);
      return res;
    },
    (err) => {
      const status = err.response?.status;
      const body   = JSON.stringify(err.response?.data || {});
      logger.error(`[Upstox] ❌ API Error ${status}: ${body}`);
      throw err;
    }
  );

  return client;
}

// HFT client for order writes; standard client for reads & positions
const hftClient = makeClient(UPSTOX_HFT_BASE);
const stdClient = makeClient(UPSTOX_STD_BASE);

// ─────────────────────────────────────────────────────────────
// INSTRUMENT TOKEN BUILDER
// Upstox instrument tokens: "EXCHANGE|NUMERIC_KEY"
// The numeric key must be looked up from the instrument master CSV.
// These helpers build a best-effort token; override with the
// real key once you download the master CSV from:
// https://assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz
// ─────────────────────────────────────────────────────────────

/**
 * Builds an Upstox instrument token string from a signal.
 * Format:  EXCHANGE|TOKEN  e.g. NSE_FO|43919
 *
 * @param {object} signal - Parsed signal object
 * @returns {string}
 */
function buildInstrumentToken(signal) {
  const sym = (signal.symbol || '').toUpperCase().trim();

  if (signal.instrument_type === 'OPTION') {
    // e.g. NSE_FO|NIFTY24500CE  — replace with real numeric key in production
    return `NSE_FO|${sym}${signal.strike_price}${signal.option_type}`;
  }

  if (signal.instrument_type === 'FUTURE') {
    return `NSE_FO|${sym}FUT`;
  }

  // EQ — equity
  return `NSE_EQ|${sym}`;
}

// ─────────────────────────────────────────────────────────────
// 1. PLACE ORDER  — POST /v3/order/place
// ─────────────────────────────────────────────────────────────
/**
 * Places a single order.
 * Docs: https://upstox.com/developer/api-documentation/v3/place-order
 *
 * @param {object} params
 * @param {string} params.instrumentToken  - e.g. "NSE_FO|43919"
 * @param {string} params.transactionType  - "BUY" | "SELL"
 * @param {number} params.quantity
 * @param {number} [params.price]          - Required for LIMIT/SL; 0 for MARKET
 * @param {number} [params.triggerPrice]   - Required for SL / SL-M
 * @param {string} [params.orderType]      - MARKET | LIMIT | SL | SL-M
 * @param {string} [params.product]        - "I" (intraday) | "D" (delivery) | "MTF"
 * @param {string} [params.validity]       - "DAY" | "IOC"
 * @param {string} [params.tag]            - Optional order tag (max 20 chars)
 * @param {boolean}[params.slice]          - Enable auto-slicing for large quantities
 * @param {number} [params.marketProtection] - Market protection % (0 = off)
 * @returns {Promise<object>} data.order_ids[]
 */
async function placeOrder({
  instrumentToken,
  transactionType,
  quantity,
  price          = 0,
  triggerPrice   = 0,
  orderType      = 'MARKET',
  product        = 'I',
  validity       = 'DAY',
  tag            = 'tele-signal',
  slice          = false,
  marketProtection = 0,
}) {
  const payload = {
    instrument_token:   instrumentToken,
    transaction_type:   transactionType,
    quantity,
    price,
    trigger_price:      triggerPrice,
    order_type:         orderType,
    product,
    validity,
    tag,
    disclosed_quantity: 0,
    is_amo:             false,      // auto-inferred by Upstox from market session
    slice,
    market_protection:  marketProtection,
  };

  logger.info(`[Upstox] placeOrder → ${transactionType} ${quantity}x ${instrumentToken} @ ${orderType} ${price}`);

  const res = await hftClient.post('/v3/order/place', payload);
  const orderIds = res.data?.data?.order_ids || [];
  logger.info(`[Upstox] ✅ Order(s) placed → order_ids: ${orderIds.join(', ')}`);
  return res.data;
}

// ─────────────────────────────────────────────────────────────
// 2. MODIFY ORDER  — PUT /v3/order/modify
// ─────────────────────────────────────────────────────────────
/**
 * Modifies a pending or open order.
 * Docs: https://upstox.com/developer/api-documentation/v3/modify-order
 *
 * @param {string} orderId
 * @param {object} updates
 * @param {number} [updates.price]
 * @param {number} [updates.triggerPrice]
 * @param {number} [updates.quantity]
 * @param {string} [updates.orderType]    - MARKET | LIMIT | SL | SL-M
 * @param {string} [updates.validity]     - DAY | IOC
 * @param {number} [updates.marketProtection]
 * @returns {Promise<object>} data.order_id
 */
async function modifyOrder(orderId, {
  price            = 0,
  triggerPrice     = 0,
  quantity,
  orderType        = 'LIMIT',
  validity         = 'DAY',
  marketProtection = 0,
} = {}) {
  const payload = {
    order_id:           orderId,
    price,
    trigger_price:      triggerPrice,
    quantity,
    order_type:         orderType,
    validity,
    disclosed_quantity: 0,
    market_protection:  marketProtection,
  };

  logger.info(`[Upstox] modifyOrder → orderId: ${orderId} | price: ${price} | SL: ${triggerPrice}`);

  const res = await hftClient.put('/v3/order/modify', payload);
  logger.info(`[Upstox] ✅ Order modified → order_id: ${res.data?.data?.order_id}`);
  return res.data;
}

// ─────────────────────────────────────────────────────────────
// 3. CANCEL ORDER  — DELETE /v3/order/cancel?order_id=...
// ─────────────────────────────────────────────────────────────
/**
 * Cancels a pending or open order.
 * Docs: https://upstox.com/developer/api-documentation/v3/cancel-order
 *
 * @param {string} orderId
 * @returns {Promise<object>} data.order_id
 */
async function cancelOrder(orderId) {
  logger.info(`[Upstox] cancelOrder → orderId: ${orderId}`);

  const res = await hftClient.delete('/v3/order/cancel', {
    params: { order_id: orderId },
  });

  logger.info(`[Upstox] ✅ Order cancelled → order_id: ${res.data?.data?.order_id}`);
  return res.data;
}

// ─────────────────────────────────────────────────────────────
// 4. EXIT ALL POSITIONS  — POST /v2/order/positions/exit
// ─────────────────────────────────────────────────────────────
/**
 * Exits ALL open positions (or filtered by segment/tag).
 * Docs: https://upstox.com/developer/api-documentation/exit-all-positions
 *
 * Execution order per Upstox: BUY positions first, then SELL.
 *
 * @param {object} [filters]
 * @param {string} [filters.segment]  - e.g. "NSE_FO", "NSE_EQ"
 * @param {string} [filters.tag]      - Order tag filter (intraday only)
 * @returns {Promise<object>}
 */
async function exitAllPositions({ segment, tag } = {}) {
  const params = {};
  if (segment) params.segment = segment;
  if (tag)     params.tag     = tag;

  logger.info(`[Upstox] exitAllPositions → segment: ${segment || 'ALL'} | tag: ${tag || 'none'}`);

  const res = await stdClient.post('/v2/order/positions/exit', {}, { params });
  logger.info(`[Upstox] ✅ All positions exit triggered`);
  return res.data;
}

// ─────────────────────────────────────────────────────────────
// 5. EXIT SINGLE POSITION (opposite market order)
// ─────────────────────────────────────────────────────────────
/**
 * Exits a single tracked trade by placing an opposite MARKET order.
 * Preferred approach for per-trade control vs exitAllPositions.
 *
 * @param {object} trade - Active trade from tradeStateManager
 * @returns {Promise<object>}
 */
async function exitPosition(trade) {
  const exitSide = trade.direction === 'BUY' ? 'SELL' : 'BUY';

  logger.info(`[Upstox] exitPosition → ${exitSide} ${trade.quantity}x ${trade.instrumentToken}`);

  return await placeOrder({
    instrumentToken: trade.instrumentToken,
    transactionType: exitSide,
    quantity:        trade.quantity,
    orderType:       'MARKET',
    tag:             `exit-${trade.tradeKey || 'pos'}`.slice(0, 20),
  });
}

// ─────────────────────────────────────────────────────────────
// 6. UPDATE STOP LOSS  — cancel existing SL, place new SL-M
// ─────────────────────────────────────────────────────────────
/**
 * Cancels any existing SL order on the trade and places a fresh SL-M order.
 *
 * @param {object} trade         - Active trade object
 * @param {number} stopLossPrice - New trigger price for SL-M
 * @returns {Promise<object>}
 */
async function updateStopLoss(trade, stopLossPrice) {
  const exitSide = trade.direction === 'BUY' ? 'SELL' : 'BUY';

  // Cancel the old SL order if one exists
  if (trade.slOrderId) {
    try {
      await cancelOrder(trade.slOrderId);
      logger.info(`[Upstox] Old SL order cancelled: ${trade.slOrderId}`);
    } catch (err) {
      logger.warn(`[Upstox] Could not cancel old SL order (${trade.slOrderId}): ${err.message}`);
    }
  }

  logger.info(`[Upstox] updateStopLoss → SL-M trigger: ${stopLossPrice}`);

  return await placeOrder({
    instrumentToken: trade.instrumentToken,
    transactionType: exitSide,
    quantity:        trade.quantity,
    price:           0,
    triggerPrice:    stopLossPrice,
    orderType:       'SL-M',
    tag:             'sl-update'.slice(0, 20),
  });
}

// ─────────────────────────────────────────────────────────────
// 7. UPDATE TARGET  — cancel existing target, place new LIMIT order
// ─────────────────────────────────────────────────────────────
/**
 * Cancels any existing target order and places a new LIMIT exit order.
 *
 * @param {object} trade       - Active trade object
 * @param {number} targetPrice - New limit price for profit-taking
 * @returns {Promise<object>}
 */
async function updateTarget(trade, targetPrice) {
  const exitSide = trade.direction === 'BUY' ? 'SELL' : 'BUY';

  // Cancel old target order if present
  if (trade.targetOrderId) {
    try {
      await cancelOrder(trade.targetOrderId);
      logger.info(`[Upstox] Old target order cancelled: ${trade.targetOrderId}`);
    } catch (err) {
      logger.warn(`[Upstox] Could not cancel old target order (${trade.targetOrderId}): ${err.message}`);
    }
  }

  logger.info(`[Upstox] updateTarget → LIMIT @ ${targetPrice}`);

  return await placeOrder({
    instrumentToken: trade.instrumentToken,
    transactionType: exitSide,
    quantity:        trade.quantity,
    price:           targetPrice,
    orderType:       'LIMIT',
    tag:             'target-update'.slice(0, 20),
  });
}

// ─────────────────────────────────────────────────────────────
// 8. PARTIAL BOOK  — exit a % of the position at market
// ─────────────────────────────────────────────────────────────
/**
 * Exits a percentage of the position at market price.
 *
 * @param {object} trade
 * @param {number} percentToBook - e.g. 50 for 50%
 * @returns {Promise<object|null>}
 */
async function partialBook(trade, percentToBook = 50) {
  const partialQty = Math.floor((trade.quantity * percentToBook) / 100);

  if (partialQty < 1) {
    logger.warn(`[Upstox] partialBook: qty resolved to 0 (${trade.quantity} × ${percentToBook}%)`);
    return null;
  }

  const exitSide = trade.direction === 'BUY' ? 'SELL' : 'BUY';

  logger.info(`[Upstox] partialBook → ${exitSide} ${partialQty}x (${percentToBook}% of ${trade.quantity})`);

  return await placeOrder({
    instrumentToken: trade.instrumentToken,
    transactionType: exitSide,
    quantity:        partialQty,
    orderType:       'MARKET',
    tag:             'partial-book'.slice(0, 20),
  });
}

// ─────────────────────────────────────────────────────────────
// 9. GET POSITIONS  — GET /v2/portfolio/short-term-positions
// ─────────────────────────────────────────────────────────────
/**
 * Returns the current intraday/short-term positions.
 * Docs: https://upstox.com/developer/api-documentation/get-positions
 *
 * @returns {Promise<Array>}
 */
async function getPositions() {
  const res = await stdClient.get('/v2/portfolio/short-term-positions');
  return res.data?.data || [];
}

// ─────────────────────────────────────────────────────────────
// 10. GET HOLDINGS  — GET /v2/portfolio/long-term-holdings
// ─────────────────────────────────────────────────────────────
/**
 * Returns long-term holdings (delivery).
 *
 * @returns {Promise<Array>}
 */
async function getHoldings() {
  const res = await stdClient.get('/v2/portfolio/long-term-holdings');
  return res.data?.data || [];
}

// ─────────────────────────────────────────────────────────────
// 11. GET ORDER BOOK  — GET /v2/order/retrieve-all
// ─────────────────────────────────────────────────────────────
/**
 * Returns all orders placed during the current trading day.
 * Docs: https://upstox.com/developer/api-documentation/get-order-book
 *
 * @returns {Promise<Array>}
 */
async function getOrderBook() {
  const res = await stdClient.get('/v2/order/retrieve-all');
  return res.data?.data || [];
}

// ─────────────────────────────────────────────────────────────
// 12. GET ORDER DETAILS  — GET /v2/order/details?order_id=...
// ─────────────────────────────────────────────────────────────
/**
 * Returns the latest status and details for a single order.
 * Docs: https://upstox.com/developer/api-documentation/get-order-details
 *
 * @param {string} orderId
 * @returns {Promise<object>}
 */
async function getOrderDetails(orderId) {
  const res = await stdClient.get('/v2/order/details', {
    params: { order_id: orderId },
  });
  return res.data?.data || null;
}

// ─────────────────────────────────────────────────────────────
// 13. GET TRADES BY ORDER  — GET /v2/order/trades?order_id=...
// ─────────────────────────────────────────────────────────────
/**
 * Returns the trades executed under a specific order.
 * Docs: https://upstox.com/developer/api-documentation/get-trades-by-order
 *
 * @param {string} orderId
 * @returns {Promise<Array>}
 */
async function getTradesByOrder(orderId) {
  const res = await stdClient.get('/v2/order/trades', {
    params: { order_id: orderId },
  });
  return res.data?.data || [];
}

// ─────────────────────────────────────────────────────────────
// 14. GET ALL TRADES FOR THE DAY  — GET /v2/order/trades/get-trades-for-day
// ─────────────────────────────────────────────────────────────
/**
 * Returns all trades executed during the current day.
 * Docs: https://upstox.com/developer/api-documentation/get-trade-history
 *
 * @returns {Promise<Array>}
 */
async function getAllTrades() {
  const res = await stdClient.get('/v2/order/trades/get-trades-for-day');
  return res.data?.data || [];
}

// ─────────────────────────────────────────────────────────────
// 15. GET FUNDS / MARGINS  — GET /v2/user/get-funds-and-margin
// ─────────────────────────────────────────────────────────────
/**
 * Returns available margin/funds for the user.
 * Useful for pre-trade margin checks.
 *
 * @param {string} [segment] - e.g. "SEC" (equity) | "COM" (commodity) | "FO" (F&O)
 * @returns {Promise<object>}
 */
async function getFundsAndMargin(segment = 'SEC') {
  const res = await stdClient.get('/v2/user/get-funds-and-margin', {
    params: { segment },
  });
  return res.data?.data || {};
}

// ─────────────────────────────────────────────────────────────
// 16. CONVERT POSITION  — PUT /v2/portfolio/convert-position
// ─────────────────────────────────────────────────────────────
/**
 * Converts a position from intraday to delivery or vice versa.
 * Docs: https://upstox.com/developer/api-documentation/convert-positions
 *
 * @param {object} params
 * @param {string} params.instrumentToken
 * @param {string} params.transactionType  - BUY | SELL
 * @param {string} params.oldProduct       - Current product type "I" | "D"
 * @param {string} params.newProduct       - Target product type  "I" | "D"
 * @param {number} params.quantity
 * @param {string} params.positionType     - "DAY" | "CN"
 * @returns {Promise<object>}
 */
async function convertPosition({ instrumentToken, transactionType, oldProduct, newProduct, quantity, positionType = 'DAY' }) {
  const payload = {
    instrument_token: instrumentToken,
    transaction_type: transactionType,
    old_product:      oldProduct,
    new_product:      newProduct,
    quantity,
    position_type:    positionType,
  };

  logger.info(`[Upstox] convertPosition → ${oldProduct}→${newProduct} | ${transactionType} ${quantity}x`);

  const res = await stdClient.put('/v2/portfolio/convert-position', payload);
  return res.data;
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────
module.exports = {
  // Token utils
  buildInstrumentToken,

  // Order management
  placeOrder,
  modifyOrder,
  cancelOrder,

  // Position management
  exitAllPositions,
  exitPosition,
  updateStopLoss,
  updateTarget,
  partialBook,
  convertPosition,

  // Queries
  getPositions,
  getHoldings,
  getOrderBook,
  getOrderDetails,
  getTradesByOrder,
  getAllTrades,
  getFundsAndMargin,
};
