# 📈 Tele Signal Automation

A production-ready **AI-powered trading automation system** built with Node.js.

The bot reads signals from a Telegram group, analyzes them using an LLM (OpenRouter or OpenAI), and automatically executes Nifty/BankNifty trades via the **Upstox API**.

---

## 🏗 Key Features (New)

- **Overnight Persistence**: Saves all active trades and daily stats to `data/state.json`. If you stop the bot at 3:30 PM and restart it at 9:15 AM, it automatically resumes tracking your positional trades.
- **Smart Message Deduplication**: Uses a persistent Map ID tracker to ensure no signal is processed twice, even after a restart.
- **Dynamic Lot Sizing**: Automatically calculates order quantity based on your `.env` lot settings and the instrument type (Nifty: 50, BankNifty: 15, etc.).
- **1-Minute Scheduler**: Optimized 30-60s heartbeat to ensure fast entry while managing API rate limits.

---

## 📐 Architecture

```
Telegram Group
     │
     ▼ (checks every N seconds via node-cron)
telegramClient.js   ─── fetches latest & skips historical on startup
     │
     ▼
llmClient.js        ─── sends messages + active trades to LLM
     │
     ▼
signalParser.js     ─── validates structured JSON signal
     │
     ▼
riskManager.js      ─── checks risk rules (max loss, daily limit, etc.)
     │
     ▼
tradeEngine.js      ─── calculates qty from configured lots & executes
     │
     ▼
upstoxClient.js     ─── places / modifies / cancels orders
     │
     ▼
tradeStateManager   ─── persists state to data/state.json
```

---

## ⚙️ Configuration (.env)

Edit your `.env` file to control the bot's behavior. **All variables are strictly respected from this file.**

| Category | Variable | Description |
|---|---|---|
| **Telegram** | `TELEGRAM_FETCH_INTERVAL` | Pulse interval in seconds (e.g., `30`) |
| **Trade** | `TRADE_LOTS` | Number of lots to buy per trade (e.g., `1`) |
| **Risk** | `MAX_TRADES_PER_DAY` | Stop trading after N entries |
| **Risk** | `MAX_DAILY_LOSS` | Stop trading if PnL drops below this INR amount |
| **Risk** | `ENABLE_STOP_LOSS` | Places automatic SL-M orders |
| **Risk** | `ENABLE_TARGETS` | Places automatic Profit-Target limit orders |

---

## 📂 Project Structure

```
tele-signal-automation/
├── server.js                      # Express entry point + health check
├── .env                           # Your secret configurations
├── data/
│   └── state.json                 # Persistent trade state (Automatic)
└── src/
    ├── memory/
    │   └── tradeStateManager.js   # Disk-backed state persistence
    ├── trading/
    │   ├── tradeEngine.js         # Dynamic lot-to-quantity logic
    │   └── upstoxClient.js        # Upstox v2 API wrapper
    ├── scheduler/
    │   └── cronRunner.js          # Pipeline orchestrator
    └── telegram/
        └── telegramClient.js      # Deduplication & GramJS client
```

---

## 🚀 Getting Started

1. **Setup Env**: `cp .env.example .env` and fill in your API keys (Telegram, Upstox, LLM).
2. **Install**: `npm install`
3. **First Run**: `node server.js`
   - Log in with your phone/OTP when prompted.
   - Save the `TELEGRAM_SESSION_STRING` printed in your console back into `.env` to avoid logging in again.
4. **Deploy**: The bot will skip all historical messages on boot and only track new ones appearing after it starts.

---

## 📡 Supported Instruments & Lot Sizes

The bot automatically identifies the followingIndices and applies the correct lot size:

- **NIFTY**: 50
- **BANKNIFTY**: 15
- **FINNIFTY**: 40
- **MIDCPNIFTY**: 75
- **SENSEX**: 10

---

## 🔌 API Status Endpoints

You can check the bot's live status locally:
- `GET /status` — View current active trades, PnL, and loaded state.
- `GET /positions` — Fetch live positions directly from Upstox.
- `GET /orders` — Fetch today’s order book from Upstox.

---

## ⚠️ Disclaimer

This software is for **educational and research purposes only**. Algorithmic trading involves significant financial risk. Always verify logic in a paper trading environment before using real funds.

---

## 📄 License
MIT
