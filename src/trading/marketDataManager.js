'use strict';

const WebSocket = require('ws');
const protobuf = require('protobufjs');
const path = require('path');
const upstox = require('./upstoxClient');
const logger = require('../utils/logger');
const { tradeStateManager } = require('../memory/tradeStateManager');

/**
 * marketDataManager.js
 * Manages the Upstox Market Data Feed WebSocket (V3).
 * Decodes Protobuf binary data and updates the trade state.
 */

let ws = null;
let protobufRoot = null;
let FeedMessage = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Load Protobuf schema on module load
async function loadProtobuf() {
  if (protobufRoot) return;
  try {
    const protoPath = path.join(__dirname, 'MarketDataFeedV3.proto');
    protobufRoot = await protobuf.load(protoPath);
    FeedMessage = protobufRoot.lookupType('com.upstox.marketdata.v3.MarketDataFeedV3');
    logger.info('[MarketData] Protobuf schema loaded successfully');
  } catch (err) {
    logger.error(`[MarketData] Failed to load Protobuf schema: ${err.message}`);
  }
}

/**
 * Connects to the Upstox Market Data Feed.
 */
async function connect() {
  await loadProtobuf();

  try {
    const authUrl = await upstox.getMarketDataAuthUrl();
    if (!authUrl) {
      throw new Error('Failed to get authorized WebSocket URL');
    }

    ws = new WebSocket(authUrl);

    ws.on('open', () => {
      logger.info('[MarketData] WebSocket connection opened');
      reconnectAttempts = 0;
      
      // Subscribe to active trades after connection
      subscribeToActiveTrades();
    });

    ws.on('message', (data) => {
      // Data is a binary buffer for V3 feed
      handleMessage(data);
    });

    ws.on('error', (err) => {
      logger.error(`[MarketData] WebSocket error: ${err.message}`);
    });

    ws.on('close', (code, reason) => {
      logger.warn(`[MarketData] WebSocket closed (code: ${code}, reason: ${reason})`);
      attemptReconnect();
    });

  } catch (err) {
    logger.error(`[MarketData] Connection failed: ${err.message}`);
    attemptReconnect();
  }
}

/**
 * Decodes and processes incoming Protobuf messages.
 */
function handleMessage(buffer) {
  if (!FeedMessage) return;

  try {
    const message = FeedMessage.decode(buffer);
    const result = FeedMessage.toObject(message, {
      longs: String,
      enums: String,
      bytes: String,
    });

    if (result.status === 'SUCCESS' && result.data && result.data.ltp) {
      for (const [instrumentKey, data] of Object.entries(result.data.ltp)) {
        if (data.quote && data.quote.ltp) {
          tradeStateManager.updateLivePrice(instrumentKey, data.quote.ltp);
        }
      }
    }
  } catch (err) {
    logger.error(`[MarketData] Failed to decode message: ${err.message}`);
  }
}

/**
 * Attempts to reconnect with exponential backoff.
 */
function attemptReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error('[MarketData] Max reconnection attempts reached. Stopping.');
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  logger.info(`[MarketData] Reconnecting in ${delay/1000}s (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
  
  setTimeout(connect, delay);
}

/**
 * Subscribes to the live feed for specific instruments.
 * @param {string[]} instrumentKeys 
 */
function subscribe(instrumentKeys) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.warn('[MarketData] Cannot subscribe: WebSocket not open');
    return;
  }

  const payload = {
    guid: `sub_${Date.now()}`,
    method: 'sub',
    data: {
      mode: 'ltp',
      instrumentKeys: instrumentKeys,
    },
  };

  ws.send(JSON.stringify(payload));
  logger.info(`[MarketData] Subscribed to: ${instrumentKeys.join(', ')}`);
}

/**
 * Fetches all active trade instruments and subscribes to them.
 */
function subscribeToActiveTrades() {
  const activeTrades = tradeStateManager.getActiveTrades();
  const keys = Object.values(activeTrades).map(t => t.instrumentToken).filter(Boolean);
  
  if (keys.length > 0) {
    // Unique keys
    const uniqueKeys = [...new Set(keys)];
    subscribe(uniqueKeys);
  }
}

/**
 * Disconnects the WebSocket.
 */
function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
    logger.info('[MarketData] Disconnected');
  }
}

module.exports = {
  connect,
  disconnect,
  subscribe,
  subscribeToActiveTrades,
};
