'use strict';

require('dotenv').config();

/**
 * Central configuration store.
 * All env vars flow through here so the rest of the app
 * never reads process.env directly.
 */
const config = {
  // ── Server ─────────────────────────────────────────────────
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // ── Telegram ───────────────────────────────────────────────
  TELEGRAM_API_ID: parseInt(process.env.TELEGRAM_API_ID, 10),
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH,
  TELEGRAM_PHONE_NUMBER: process.env.TELEGRAM_PHONE_NUMBER,
  TELEGRAM_SESSION_STRING: process.env.TELEGRAM_SESSION_STRING || '',
  TELEGRAM_GROUP_ID: process.env.TELEGRAM_GROUP_ID,
  TELEGRAM_FETCH_INTERVAL: parseInt(process.env.TELEGRAM_FETCH_INTERVAL, 10) || 60,

  // ── LLM ────────────────────────────────────────────────────
  LLM_PROVIDER: (process.env.LLM_PROVIDER || 'openrouter').toLowerCase(),

  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'openai/gpt-4o',
  OPENROUTER_FALLBACK_MODEL: process.env.OPENROUTER_FALLBACK_MODEL || 'google/gemini-2.5-flash',
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',

  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o',

  // ── Upstox ─────────────────────────────────────────────────
  UPSTOX_API_KEY: process.env.UPSTOX_API_KEY,
  UPSTOX_ACCESS_TOKEN: process.env.UPSTOX_ACCESS_TOKEN,
  UPSTOX_BASE_URL: process.env.UPSTOX_BASE_URL || 'https://api.upstox.com/v2',

  // ── Trade ──────────────────────────────────────────────────
  TRADE_LOTS: parseInt(process.env.TRADE_LOTS, 10) || 1,
  TRADE_QUANTITY_PER_LOT: parseInt(process.env.TRADE_QUANTITY_PER_LOT, 10) || 50,

  // ── Risk ───────────────────────────────────────────────────
  MAX_TRADES_PER_DAY: parseInt(process.env.MAX_TRADES_PER_DAY, 10) || 5,
  MAX_DAILY_LOSS: parseFloat(process.env.MAX_DAILY_LOSS) || 10000,

  ENABLE_STOP_LOSS: process.env.ENABLE_STOP_LOSS !== 'false',
  ENABLE_TRAILING_SL: process.env.ENABLE_TRAILING_SL !== 'false',
  ENABLE_TARGETS: process.env.ENABLE_TARGETS !== 'false',
};

// ── Derived ───────────────────────────────────────────────────
config.TRADE_QUANTITY = config.TRADE_LOTS * config.TRADE_QUANTITY_PER_LOT;

module.exports = config;
