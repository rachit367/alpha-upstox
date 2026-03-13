'use strict';

const axios = require('axios');
const zlib = require('zlib');
const mongoose = require('mongoose');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * instrumentManager.js
 * Manages the master instrument database using Mongoose.
 * Syncs daily with Upstox JSON master files.
 */

const NSE_MASTER_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';

// ── Schema Definition ─────────────────────────────────────────

const InstrumentSchema = new mongoose.Schema({
  instrument_key: { type: String, required: true, unique: true, index: true },
  exchange: String,
  symbol: { type: String, index: true },
  trading_symbol: { type: String, index: true },
  name: String,
  last_price: Number,
  expiry: Date,
  strike_price: { type: Number, index: true },
  tick_size: Number,
  lot_size: Number,
  instrument_type: String,
  option_type: { type: String, index: true },
  asset: String,
  underlying_symbol: String,
  underlying_key: String,
}, { 
  timestamps: true,
  strict: false // Allow extra fields from Upstox if they add any
});

const Instrument = mongoose.models.Instrument || mongoose.model('Instrument', InstrumentSchema);

/**
 * Connects to MongoDB using Mongoose.
 */
async function connectDB() {
  if (mongoose.connection.readyState >= 1) return;

  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    logger.info('[InstrumentManager] Connected to MongoDB via Mongoose');
  } catch (err) {
    logger.error(`[InstrumentManager] Mongoose connection failed: ${err.message}`);
    throw err;
  }
}

/**
 * Downloads and syncs master data from Upstox.
 */
async function syncMasterData() {
  try {
    await connectDB();

    logger.info(`[InstrumentManager] Starting sync from ${NSE_MASTER_URL}...`);

    const response = await axios({
      method: 'get',
      url: NSE_MASTER_URL,
      responseType: 'arraybuffer',
    });

    const decompressed = zlib.gunzipSync(response.data);
    const instruments = JSON.parse(decompressed.toString());

    logger.info(`[InstrumentManager] Downloaded ${instruments.length} instruments. Syncing to MongoDB...`);

    // We use bulkWrite for high-speed upserts
    const operations = instruments.map((inst) => ({
      updateOne: {
        filter: { instrument_key: inst.instrument_key },
        update: { $set: inst },
        upsert: true,
      },
    }));

    const chunkSize = 2000;
    for (let i = 0; i < operations.length; i += chunkSize) {
      const chunk = operations.slice(i, i + chunkSize);
      await Instrument.bulkWrite(chunk);
      logger.debug(`[InstrumentManager] Synced chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(operations.length/chunkSize)}`);
    }

    logger.info(`[InstrumentManager] Sync successful. Total records stored: ${instruments.length}`);
  } catch (err) {
    logger.error(`[InstrumentManager] Sync failed: ${err.message}`);
    throw err;
  }
}

/**
 * Dynamic lookup for an instrument.
 */
async function findInstrument(query) {
  await connectDB();

  let mongoQuery = {};

  if (query.trading_symbol) {
    mongoQuery.trading_symbol = query.trading_symbol.toUpperCase();
  } else if (query.symbol) {
    mongoQuery.symbol = query.symbol.toUpperCase();
    if (query.strike) mongoQuery.strike_price = Number(query.strike);
    if (query.type) mongoQuery.option_type = query.type.toUpperCase();
  }

  // Find the exact match or nearest expiry
  const instrument = await Instrument.findOne(mongoQuery).lean();
  
  if (!instrument) {
    logger.warn(`[InstrumentManager] No instrument found for query: ${JSON.stringify(query)}`);
    return null;
  }

  return instrument;
}

/**
 * Returns the lot size for a specific instrument.
 */
async function getLotSize(query) {
  const instrument = await findInstrument(query);
  return instrument ? instrument.lot_size : null;
}

module.exports = {
  syncMasterData,
  findInstrument,
  getLotSize,
  connectDB,
  Instrument, // Export model for other uses
};
