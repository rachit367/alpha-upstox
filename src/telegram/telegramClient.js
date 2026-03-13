'use strict';

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const config = require('../config/config');
const logger = require('../utils/logger');

let client = null;
let messageHistory = [];
const MAX_HISTORY = 50; // keep last 50 messages in memory

/**
 * Initializes and connects the Telegram client.
 * If no session string is stored, performs interactive login.
 */
async function connectTelegram() {
  if (client && client.connected) {
    return client;
  }

  const session = new StringSession(config.TELEGRAM_SESSION_STRING);

  client = new TelegramClient(session, config.TELEGRAM_API_ID, config.TELEGRAM_API_HASH, {
    connectionRetries: 5,
    useWSS: false,
  });

  await client.start({
    phoneNumber: async () => config.TELEGRAM_PHONE_NUMBER || await input.text('Enter your phone number (with country code): '),
    password: async () => await input.text('Enter your 2FA password (if any): '),
    phoneCode: async () => await input.text('Enter the code you received: '),
    onError: (err) => logger.error(`[Telegram] Auth error: ${err.message}`),
  });

  logger.info('[Telegram] Connected successfully.');

  // Print the session string on first login so user can save it in .env
  const sessionString = client.session.save();
  if (sessionString && !config.TELEGRAM_SESSION_STRING) {
    logger.info(`[Telegram] ⚠️  Save this session string in your .env:\nTELEGRAM_SESSION_STRING=${sessionString}`);
  }

  return client;
}

/**
 * Fetches the last N messages from the configured Telegram group.
 * @param {number} limit - Number of messages to fetch (default: 20)
 * @returns {Array<{id, text, date, sender}>}
 */
async function fetchLatestMessages(limit = 20) {
  try {
    const tgClient = await connectTelegram();
    const entity = await tgClient.getEntity(config.TELEGRAM_GROUP_ID);

    const messages = await tgClient.getMessages(entity, { limit });

    const parsed = messages
      .filter((m) => m.message && m.message.trim())
      .map((m) => ({
        id: m.id,
        text: m.message.trim(),
        date: new Date(m.date * 1000).toISOString(),
        sender: m.senderId ? m.senderId.toString() : 'unknown',
      }))
      .reverse(); // oldest first

    // Update in-memory history deduplicating by message id
    const existingIds = new Set(messageHistory.map((m) => m.id));
    const newMessages = parsed.filter((m) => !existingIds.has(m.id));

    messageHistory = [...messageHistory, ...newMessages].slice(-MAX_HISTORY);

    logger.info(`[Telegram] Fetched ${parsed.length} messages, ${newMessages.length} are new.`);

    return {
      newMessages,
      allMessages: messageHistory,
    };
  } catch (error) {
    logger.error(`[Telegram] Failed to fetch messages: ${error.message}`);
    throw error;
  }
}

/**
 * Returns the current in-memory message history.
 * @returns {Array}
 */
function getMessageHistory() {
  return messageHistory;
}

/**
 * Gracefully disconnects the Telegram client.
 */
async function disconnectTelegram() {
  if (client && client.connected) {
    await client.disconnect();
    logger.info('[Telegram] Disconnected.');
  }
}

module.exports = {
  connectTelegram,
  fetchLatestMessages,
  getMessageHistory,
  disconnectTelegram,
};
