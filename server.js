'use strict';

require('dotenv').config();

const express = require('express');
const { startCronJobs } = require('./src/scheduler/cronRunner');
const logger = require('./src/utils/logger');
const config = require('./src/config/config');

const app = express();
app.use(express.json());

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

// ── Start Server ──────────────────────────────────────────────
const PORT = config.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📡 LLM Provider: ${config.LLM_PROVIDER}`);
  logger.info(`⚡ Starting cron scheduler...`);
  startCronJobs();
});

module.exports = app;
