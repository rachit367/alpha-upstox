'use strict';

const axios = require('axios');
const { OpenAI } = require('openai');
const config = require('../config/config');
const logger = require('../utils/logger');

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a professional algorithmic trading signal analyzer.
Your job is to analyze a Telegram trading group conversation and determine whether any trading action should be taken.

You must return a single JSON object. Do not include any explanation or markdown — only raw JSON.

Supported actions:
- NEW_TRADE         → New position to open
- EXIT_POSITION     → Exit entire active position
- EARLY_EXIT        → Exit before the original target
- UPDATE_STOP_LOSS  → Modify the stop-loss of an active trade
- UPDATE_TRAILING_SL→ Set or update a trailing stop-loss
- UPDATE_TARGET     → Modify target price(s) of an active trade
- PARTIAL_BOOK      → Book partial profits
- CANCEL_PENDING_ORDER → Cancel a pending/limit order
- NO_ACTION         → No trading action required

Response schema:
{
  "action": "<one of the above actions>",
  "symbol": "<e.g. NIFTY, BANKNIFTY — index name only, never a cash EQ index>",
  "instrument_type": "<OPTION | FUTURE | EQ>",  // EQ only for individual stocks, NEVER for indices
  "strike_price": <number or null>,
  "option_type": "<CE | PE | null>",
  "direction": "<BUY | SELL>",
  "entry_price": <number or null>,
  "stop_loss": <number or null>,
  "trailing_sl": <number or null>,
  "targets": [<number>, ...],
  "partial_percent": <number or null>,
  "reason": "<brief explanation>"
}

Rules:
1. If the message is noise or unrelated to trading, return NO_ACTION.
2. If there is ambiguity, return NO_ACTION.
3. Never invent trades, always base decisions on the conversation.
4. For modifications (UPDATE_*), specify what changed.
5. NEVER suggest trading index instruments (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX, or any market index) with instrument_type=EQ. Indices cannot be bought or sold directly as cash equities. If a message refers to NIFTY/BANKNIFTY/SENSEX etc., they must only appear as OPTION or FUTURE trades.
6. If a signal would require an EQ trade on an index symbol, return NO_ACTION instead.
`;

/**
 * Builds the user content for the LLM prompt.
 */
function buildUserPrompt(newMessages, messageHistory, activeTrades) {
  const historyText = messageHistory
    .slice(-30)
    .map((m) => `[${m.date}] ${m.text}`)
    .join('\n');

  const newText = newMessages.map((m) => `[${m.date}] ${m.text}`).join('\n');

  const tradesText =
    activeTrades.length > 0
      ? JSON.stringify(activeTrades, null, 2)
      : 'No active trades.';

  return `=== RECENT CONVERSATION HISTORY ===
${historyText}

=== NEW MESSAGES (analyze these) ===
${newText}

=== ACTIVE TRADES ===
${tradesText}

Based on the new messages and context, determine the trading action.`;
}

// ── OpenRouter ────────────────────────────────────────────────
async function callOpenRouter(messages, model = config.OPENROUTER_MODEL) {
  const response = await axios.post(
    `${config.OPENROUTER_BASE_URL}/chat/completions`,
    {
      model: model,
      messages,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/tele-signal-automation',
        'X-Title': 'Tele Signal Automation',
      },
      timeout: 30000,
    }
  );
  return response.data.choices[0].message.content;
}

// ── OpenAI ────────────────────────────────────────────────────
async function callOpenAI(messages) {
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: config.OPENAI_MODEL,
    messages,
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });
  return response.choices[0].message.content;
}

/**
 * Sends conversation context to the configured LLM and returns the raw JSON string.
 * @param {Array} newMessages
 * @param {Array} messageHistory
 * @param {Array} activeTrades
 * @returns {string} Raw JSON from LLM
 */
async function analyzeTradingSignal(newMessages, messageHistory, activeTrades = []) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(newMessages, messageHistory, activeTrades) },
  ];

  logger.debug(`[LLM] Sending ${newMessages.length} new messages to ${config.LLM_PROVIDER}`);

  let raw;

  try {
    if (config.LLM_PROVIDER === 'openai') {
      raw = await callOpenAI(messages);
    } else {
      raw = await callOpenRouter(messages);
    }
  } catch (error) {
    logger.error(`[LLM] Primary model failed: ${error.message}. Falling back to OpenRouter ${config.OPENROUTER_FALLBACK_MODEL}`);
    raw = await callOpenRouter(messages, config.OPENROUTER_FALLBACK_MODEL);
  }

  logger.info(`[LLM] Raw response: ${raw}`);
  return raw;
}

module.exports = {
  analyzeTradingSignal,
  buildUserPrompt,
};
