'use strict';

require('dotenv').config();

const express = require('express');
const { startCronJobs } = require('./src/scheduler/cronRunner');
const logger = require('./src/utils/logger');
const config = require('./src/config/config');
const instrumentManager = require('./src/trading/instrumentManager');

const app = express();
app.use(express.json());

// ── Startup Initialization ────────────────────────────────────
async function initializeApp() {
  try {
    logger.info('📂 Initializing Master Data Sync...');
    await instrumentManager.syncMasterData();
    logger.info('✅ Master Data Sync Complete');

    const PORT = config.PORT || 3000;
    app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📡 LLM Provider: ${config.LLM_PROVIDER}`);
      logger.info(`⚡ Starting cron scheduler...`);
      startCronJobs();
    });
  } catch (err) {
    logger.error(`❌ Startup failed: ${err.message}`);
    process.exit(1);
  }
}

// ── Health Check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Status Endpoint — in-memory state ────────────────────────
app.get('/status', (_req, res) => {
  const { tradeStateManager } = require('./src/memory/tradeStateManager');
  res.json(tradeStateManager.getSnapshot());
});

// ── Live Positions from Upstox ────────────────────────────────
app.get('/positions', async (_req, res) => {
  try {
    const { getPositions } = require('./src/trading/upstoxClient');
    const data = await getPositions();
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Live Order Book from Upstox ───────────────────────────────
app.get('/orders', async (_req, res) => {
  try {
    const { getOrderBook } = require('./src/trading/upstoxClient');
    const data = await getOrderBook();
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Funds & Margin from Upstox ────────────────────────────────
app.get('/margin', async (req, res) => {
  try {
    const { getFundsAndMargin } = require('./src/trading/upstoxClient');
    const data = await getFundsAndMargin(req.query.segment || 'SEC');
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Trade Journal & Stats ────────────────────────────────────
app.get('/journal', async (req, res) => {
  try {
    const journalManager = require('./src/trading/journalManager');
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = parseInt(req.query.skip, 10) || 0;
    const history = await journalManager.getHistory(limit, skip);
    res.json({ status: 'success', data: history });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/stats', async (_req, res) => {
  try {
    const journalManager = require('./src/trading/journalManager');
    const stats = await journalManager.getPerformanceStats();
    res.json({ status: 'success', data: stats });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Global Error Handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`[Express] Unhandled error: ${err.message}`);
  res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

// ── Graceful Shutdown ─────────────────────────────────────────
const shutdown = async (signal) => {
  logger.info(`[Server] ${signal} received. Shutting down gracefully...`);
  
  try {
    const { disconnectTelegram } = require('./src/telegram/telegramClient');
    const { disconnect: disconnectMarketData } = require('./src/trading/marketDataManager');
    
    await disconnectTelegram();
    disconnectMarketData();
    
    logger.info('[Server] All connections closed. Goodbye!');
    process.exit(0);
  } catch (err) {
    logger.error(`[Server] Shutdown error: ${err.message}`);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Start Server ──────────────────────────────────────────────
initializeApp();

module.exports = app;
