# 📈 Tele Signal Automation

A production-ready **AI-powered trading automation system** built with Node.js.

It reads signals from a Telegram group, analyzes them using an LLM (OpenRouter or OpenAI), and automatically executes trades via the **Upstox API**.

---

## 🏗 Architecture

```
Telegram Group
     │
     ▼ (every N seconds via node-cron)
telegramClient.js   ─── fetches latest messages
     │
     ▼
llmClient.js        ─── sends messages + active trades to LLM
     │
     ▼
signalParser.js     ─── validates structured JSON signal
     │
     ▼
riskManager.js      ─── checks risk rules (max loss, duplicates, etc.)
     │
     ▼
tradeEngine.js      ─── dispatches action to Upstox
     │
     ▼
upstoxClient.js     ─── places / modifies / cancels orders
     │
     ▼
tradeStateManager   ─── updates in-memory state + PnL
```

---

## 📁 Project Structure

```
tele-signal-automation/
├── server.js                      # Express entry point + cron starter
├── .env.example                   # Environment variable template
├── package.json
└── src/
    ├── config/
    │   └── config.js              # Centralized env config
    ├── utils/
    │   └── logger.js              # Winston logger (console + file)
    ├── telegram/
    │   └── telegramClient.js      # GramJS client — fetch group messages
    ├── llm/
    │   ├── llmClient.js           # OpenRouter / OpenAI dual-provider
    │   └── signalParser.js        # Validate + parse LLM JSON output
    ├── trading/
    │   ├── upstoxClient.js        # Upstox v2 API wrapper
    │   ├── riskManager.js         # Trade risk validation
    │   └── tradeEngine.js         # Action dispatcher
    ├── memory/
    │   └── tradeStateManager.js   # In-memory trade + PnL tracker
    └── scheduler/
        └── cronRunner.js          # node-cron pipeline orchestrator
```

---

## ⚙️ Setup & Installation

### 1. Clone & install

```bash
git clone <your-repo>
cd tele-signal-automation
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in all the required values:

| Variable | Description |
|---|---|
| `TELEGRAM_API_ID` | From [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_API_HASH` | From [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_PHONE_NUMBER` | Your phone number with country code (e.g. `+919876543210`) |
| `TELEGRAM_SESSION_STRING` | Leave blank on first run — saved automatically |
| `TELEGRAM_GROUP_ID` | Group username or numeric ID (e.g. `-1001234567890`) |
| `LLM_PROVIDER` | `openrouter` or `openai` |
| `OPENROUTER_API_KEY` | From [openrouter.ai](https://openrouter.ai) |
| `OPENAI_API_KEY` | From [platform.openai.com](https://platform.openai.com) |
| `UPSTOX_ACCESS_TOKEN` | From Upstox developer console |

### 3. First-time Telegram login

Ensure you have set `TELEGRAM_PHONE_NUMBER` in your `.env`. 
On the first run, the bot will read your number and immediately request an OTP from Telegram. You will only be prompted for:
- OTP code (sent to your Telegram app)
- 2FA password (if you have one set)

After a successful login, it will print a `TELEGRAM_SESSION_STRING`. Copy that string into your `.env` to bypass login entirely on future restarts.

### 4. Run

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

---

## 📡 Supported Trading Actions

| Action | Description |
|---|---|
| `NEW_TRADE` | Opens a new position |
| `EXIT_POSITION` | Exits the full position |
| `EARLY_EXIT` | Exits before the planned target |
| `UPDATE_STOP_LOSS` | Modifies the stop loss of a live trade |
| `UPDATE_TRAILING_SL` | Sets / updates a trailing stop loss |
| `UPDATE_TARGET` | Changes the take-profit target |
| `PARTIAL_BOOK` | Books a percentage of the position |
| `CANCEL_PENDING_ORDER` | Cancels a pending/limit order |
| `NO_ACTION` | No trade action required |

---

## 🛡️ Risk Management

Configure via `.env`:

| Variable | Default | Effect |
|---|---|---|
| `MAX_TRADES_PER_DAY` | `5` | Stops trading after N trades |
| `MAX_DAILY_LOSS` | `10000` | Stops trading if PnL ≤ -₹10,000 |
| `ENABLE_STOP_LOSS` | `true` | Places SL-M order alongside entry |
| `ENABLE_TRAILING_SL` | `true` | Allows trailing SL updates |
| `ENABLE_TARGETS` | `true` | Places target LIMIT orders |

---

## 🔌 API Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Server health check |
| `GET /status` | Current trades, PnL, daily count |

---

## 🪵 Logs

All logs are written to the `logs/` directory:

| File | Contents |
|---|---|
| `logs/combined.log` | All log levels |
| `logs/error.log` | Errors only |
| `logs/trades.log` | Trade-specific activity |

---

## ⚠️ Disclaimer

This software is for **educational and research purposes only**. Algorithmic trading involves significant financial risk. Always test in a paper trading environment before using real funds. The authors are not responsible for any financial losses.

---

## 📄 License

MIT
