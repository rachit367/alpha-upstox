'use strict';

/**
 * scripts/getGroups.js
 *
 * Run this ONCE to list all Telegram groups, supergroups, and channels
 * you are a member of — along with their IDs and names.
 *
 * Usage:
 *   node scripts/getGroups.js
 *
 * Copy the ID or username of your target group into .env:
 *   TELEGRAM_GROUP_ID=-1001234567890
 *   (or use the username, e.g. my_trading_group)
 */

require('dotenv').config();

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

const API_ID   = parseInt(process.env.TELEGRAM_API_ID, 10);
const API_HASH = process.env.TELEGRAM_API_HASH;
const PHONE    = process.env.TELEGRAM_PHONE_NUMBER;
const SESSION  = process.env.TELEGRAM_SESSION_STRING || '';

if (!API_ID || !API_HASH) {
  console.error('\n❌  TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in your .env file.\n');
  process.exit(1);
}

async function main() {
  console.log('\n🔌  Connecting to Telegram...\n');

  const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
    connectionRetries: 3,
  });

  await client.start({
    phoneNumber: async () => PHONE || await input.text('📱  Phone number (with country code): '),
    password:    async () => await input.text('🔐  2FA Password (leave blank if none): '),
    phoneCode:   async () => await input.text('💬  OTP code you received: '),
    onError:     (err)  => console.error('Auth error:', err.message),
  });

  // Save session string if it was freshly created
  const sessionString = client.session.save();
  if (sessionString && !SESSION) {
    console.log('\n🔑  Session created! Save this in your .env as TELEGRAM_SESSION_STRING:');
    console.log(`\n    TELEGRAM_SESSION_STRING=${sessionString}\n`);
  }

  console.log('✅  Connected! Fetching your dialogs...\n');

  // Fetch all dialogs (groups, channels, DMs)
  const dialogs = await client.getDialogs({ limit: 200 });

  const groups    = [];
  const channels  = [];
  const megaGroups = [];

  for (const dialog of dialogs) {
    const entity = dialog.entity;
    const title  = dialog.title || dialog.name || '(no title)';
    const id     = entity.id?.toString();

    // Supergroup / Megagroup (most Telegram "groups" are these)
    if (entity.className === 'Channel' && entity.megagroup) {
      megaGroups.push({
        type:     'SUPERGROUP',
        name:     title,
        id:       `-100${id}`,
        username: entity.username ? `@${entity.username}` : '(private)',
      });
    }
    // Broadcast channel
    else if (entity.className === 'Channel' && !entity.megagroup) {
      channels.push({
        type:     'CHANNEL',
        name:     title,
        id:       `-100${id}`,
        username: entity.username ? `@${entity.username}` : '(private)',
      });
    }
    // Old-style basic group
    else if (entity.className === 'Chat') {
      groups.push({
        type:     'GROUP',
        name:     title,
        id:       `-${id}`,
        username: '(no username)',
      });
    }
  }

  // ── Print Results ─────────────────────────────────────────────
  const allResults = [...megaGroups, ...groups, ...channels];

  if (allResults.length === 0) {
    console.log('⚠️  No groups or channels found in your dialogs.');
  } else {
    console.log('═'.repeat(72));
    console.log(`${'TYPE'.padEnd(14)} ${'ID'.padEnd(20)} ${'USERNAME'.padEnd(20)} NAME`);
    console.log('─'.repeat(72));

    for (const item of allResults) {
      console.log(
        `${item.type.padEnd(14)} ${item.id.padEnd(20)} ${item.username.padEnd(20)} ${item.name}`
      );
    }

    console.log('═'.repeat(72));
    console.log(`\n✅  Found ${megaGroups.length} supergroup(s), ${groups.length} group(s), ${channels.length} channel(s)\n`);
    console.log('👉  Copy the ID of your trading group into .env:');
    console.log('    TELEGRAM_GROUP_ID=<the numeric ID above>\n');
  }

  await client.disconnect();
}

main().catch((err) => {
  console.error('\n❌  Error:', err.message);
  process.exit(1);
});
