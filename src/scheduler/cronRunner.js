'use strict';

const cron = require('node-cron');
const config = require('../config/config');
const logger = require('../utils/logger');
const { fetchLatestMessages, getMessageHistory } = require('../telegram/telegramClient');
const { analyzeTradingSignal } = require('../llm/llmClient');
const { parseSignal } = require('../llm/signalParser');
const { executeSignal } = require('../trading/tradeEngine');
const { tradeStateManager } = require('../memory/tradeStateManager');

/**
 * cronRunner.js
 * Orchestrates the full signal-to-trade pipeline on a scheduled interval.
 *
 * Pipeline:
 *  1. Fetch latest Telegram messages
 *  2. Send context to LLM
 *  3. Parse LLM response
 *  4. Validate via risk manager (inside tradeEngine)
 *  5. Execute trade action via Upstox
 *  6. Update trade state
 */

let isRunning = false; // Guard against overlapping runs

async function runPipeline() {
  if (isRunning) {
    logger.warn('[Cron] Previous run still in progress, skipping this tick.');
    return;
  }

  isRunning = true;
  const runId = Date.now();
  logger.info(`[Cron] ▶ Pipeline run started (runId: ${runId})`);

  try {
    // ── Step 1: Fetch Telegram messages ──────────────────────────
    const { newMessages, allMessages } = await fetchLatestMessages(20);

    if (!newMessages || newMessages.length === 0) {
      logger.info('[Cron] No new messages since last fetch. Skipping LLM call.');
      return;
    }

    logger.info(`[Cron] ${newMessages.length} new message(s) received`);
    newMessages.forEach((m) => logger.debug(`[Telegram Msg] [${m.date}] ${m.text}`));

    // ── Step 2: Send to LLM ───────────────────────────────────────
    const activeTrades = tradeStateManager.getActiveTrades();
    const rawLLMResponse = await analyzeTradingSignal(newMessages, allMessages, activeTrades);

    // ── Step 3: Parse & validate signal ───────────────────────────
    const parsed = parseSignal(rawLLMResponse);

    if (!parsed) {
      logger.warn('[Cron] Signal parsing returned null — invalid JSON or schema from LLM.');
      return;
    }

    if (!parsed.isActionable) {
      logger.info('[Cron] Signal is NO_ACTION — nothing to execute.');
      return;
    }

    const { signal } = parsed;
    logger.info(`[Cron] Actionable signal detected: ${signal.action} on ${signal.symbol}`);

    // ── Step 4 & 5: Execute via trade engine (includes risk gate) ─
    const result = await executeSignal(signal);

    if (result.success) {
      logger.info(`[Cron] ✅ Trade action successful: ${JSON.stringify(result)}`);
    } else {
      logger.warn(`[Cron] ⚠️ Trade action not executed: ${result.reason}`);
    }

    // ── Step 6: Log state snapshot ────────────────────────────────
    const snapshot = tradeStateManager.getSnapshot();
    logger.info(
      `[Cron] State snapshot — activeTrades: ${snapshot.activeTrades.length}, ` +
      `tradesToday: ${snapshot.tradesToday}, dailyPnL: ₹${snapshot.dailyPnL.toFixed(2)}`
    );

  } catch (error) {
    logger.error(`[Cron] Pipeline error (runId: ${runId}): ${error.message}`);
    logger.debug(error.stack);
  } finally {
    isRunning = false;
    logger.info(`[Cron] ◀ Pipeline run finished (runId: ${runId})`);
  }
}

/**
 * Starts the scheduled cron job based on TELEGRAM_FETCH_INTERVAL config.
 * Default: every 60 seconds.
 */
function startCronJobs() {
  const intervalSeconds = config.TELEGRAM_FETCH_INTERVAL || 60;

  // node-cron supports seconds via the 6-field expression
  const cronExpression = `*/${intervalSeconds} * * * * *`;

  // Validate
  if (!cron.validate(cronExpression)) {
    logger.error(`[Cron] Invalid cron expression: ${cronExpression}`);
    process.exit(1);
  }

  logger.info(`[Cron] Scheduling pipeline every ${intervalSeconds} second(s) → "${cronExpression}"`);

  cron.schedule(cronExpression, async () => {
    await runPipeline();
  });

  // Run immediately on startup
  logger.info('[Cron] Running pipeline immediately on startup...');
  runPipeline().catch((err) => logger.error(`[Cron] Startup run failed: ${err.message}`));
}

module.exports = { startCronJobs, runPipeline };
