# Alpha Upstox — AI-Powered Trading Automation

Alpha Upstox is a professional-grade automated trading system that bridges Telegram signal providers with the Upstox API. It uses LLMs (OpenRouter/OpenAI) to intelligently parse natural language signals into precise trade actions.

## 🚀 Key Features

### 1. **Intelligent Signal Parsing**
- Uses **OpenRouter** or **OpenAI** to interpret messy Telegram messages.
- Detects `NEW_TRADE`, `EXIT_POSITION`, `UPDATE_STOP_LOSS`, and `PARTIAL_BOOK` actions.
- **Deduplication**: Automatically ignores duplicate or old messages to prevent double trading.

### 2. **Automated Master Data Sync (MongoDB)**
- **No Hardcoding**: Synchronizes daily with official Upstox Master JSON (NSE/NFO).
- **Dynamic Lot Sizes**: Automatically finds the correct `lot_size` and `instrument_key` for stocks, futures, and options.
- **Trade by Lots**: Place orders using lots (e.g., 1 lot); the bot calculates the required units automatically.

### 3. **Live PnL Tracking & WebSocket Integration**
- **Real-time LTP**: Connects to the Upstox Market Data Feed (V3) using WebSockets and Protobuf.
- **Floating PnL**: View your unrealized profit/loss instantly via the `/status` endpoint.
- **Daily Persistence**: Stores active trades in `data/state.json`, allowing the bot to resume overnight positions the next morning.

### 4. **Hard Stop Risk Management**
- **Daily Loss Limit**: Monitors total PnL (Realized + Unrealized) every minute.
- **Global Exit**: If the daily loss limit is breached, the bot triggers a "Hard Stop" and automatically exits all open positions.
- **Duplicate Protection**: Prevents multiple trades on the same instrument unless the previous one is closed.

---

## 🛠 Setup & Installation

### 1. Prerequisites
- **Node.js**: v18 or higher.
- **MongoDB**: A running instance (Local or Atlas).
- **Upstox Account**: With API keys and HFT access enabled.

### 2. Installation
```bash
git clone https://github.com/your-repo/alpha-upstox.git
cd alpha-upstox
npm install
```

### 3. Configuration & Environment
Copy `.env.example` to `.env` and fill in the following:
- **Telegram**: `TELEGRAM_API_ID` & `TELEGRAM_API_HASH` (from [my.telegram.org](https://my.telegram.org)).
- **Upstox**: `UPSTOX_API_KEY` and `UPSTOX_ACCESS_TOKEN`.
- **Database**: `MONGODB_URI` (e.g., `mongodb://localhost:27017/alphabot`).
- **Risk**: `MAX_DAILY_LOSS` (e.g., `10000` for -₹10k hard stop).

### 4. First-Time Run (Telegram Auth)
1. Run `npm start`.
2. The terminal will ask for your **Phone Number**, then the **OTP**, and finally your **2FA Password** (if enabled).
3. Once logged in, the bot will print a **`TELEGRAM_SESSION_STRING`**. 
4. **Copy and paste** this string into your `.env` to avoid logging in again manually.

### 5. Start Trading
```bash
# Start the bot
npm start
```
The bot will automatically:
1. Connect to **MongoDB** via Mongoose.
2. Sync ~50k **Master Instruments** from Upstox.
3. Establish a **WebSocket (V3)** for live market data.
4. Start the **Cron Scheduler** for Telegram signals.

---

## 📡 API Endpoints

- **GET `/status`**: View realized PnL, unrealized PnL, and total stats.
- **GET `/journal`**: Fetch all-time historical trade data from MongoDB.
- **GET `/stats`**: Get aggregated performance analytics (Win Rate, Total PnL, etc.).
- **GET `/health`**: Check system connectivity.
- **GET `/positions`**: Fetch all live positions directly from Upstox.
- **GET `/orders`**: View today's order book.

---

## 📁 Project Structure

- `src/telegram`: Client for fetching and deduplicating messages.
- `src/llm`: Prompting and parsing logic for trade signals.
- `src/trading`: Core execution engine, WebSocket manager, and MongoDB instrument sync.
- `src/memory`: State persistence for active trades.
- `src/scheduler`: Cron-based pipeline orchestration.

## ⚠️ Disclaimer
Trading involves significant risk. This bot is for educational and automation purposes only. The developers are not responsible for any financial losses incurred. Always test with small quantities first.
