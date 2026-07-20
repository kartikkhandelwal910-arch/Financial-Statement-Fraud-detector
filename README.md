# 🔍 Beneish M-Score Screener

**A forensic accounting terminal for detecting earnings manipulation using the Beneish M-Score model.**

Live demo: _Deploy your own in minutes using the guide below._

---

## What Is This?

The **Beneish M-Score** is a probabilistic model developed by Professor Messod D. Beneish (Indiana University, 1999) that uses eight financial ratios to identify companies that may have manipulated their earnings. A score above **−1.78** suggests a high probability of manipulation.

This web app is a fully interactive forensic terminal that:

- 🌍 **Fetches live financial statements** for US, UK, Canadian, German, Indian, and Chinese equities
- 📊 **Computes all 8 Beneish ratios** in real time: DSRI, GMI, AQI, SGI, DEPI, SGAI, TATA, LVGI
- 📈 **Renders historical M-Score trend charts** across multiple fiscal years
- 🔬 **Supports 3 formula variants**: Standard 8-Variable (US GAAP), 5-Variable Compact, and IFRS-Adjusted (EU/Asia/India)
- 🗂️ **Includes pre-loaded historical fraud cases**: Enron, WorldCom, Under Armour
- ✏️ **Manual Simulation Sheet** for custom financial entry
- 📡 **Live TradingView price chart** embedded for any ticker
- 🔎 **Live ticker search** with auto-complete across 100+ global blue-chips

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 19 (Vite) |
| Charts | Chart.js + react-chartjs-2 |
| Icons | Lucide React |
| Price Charts | TradingView Embeds |
| Financial Data | SEC EDGAR (keyless) · Alpha Vantage API · Yahoo Finance |
| Styling | Vanilla CSS (custom design system) |
| Deploy | Netlify (static + proxy redirects) |

---

## Project Structure

```
├── src/
│   ├── App.jsx                   # Main application shell & sidebar
│   ├── components/
│   │   ├── MScoreCalculator.js   # Core Beneish ratio + score computation
│   │   ├── MScoreCharts.jsx      # Line, bar, radar, probability charts
│   │   └── TradingViewChart.jsx  # TradingView live price widget
│   ├── data/
│   │   ├── historicalCases.js    # Pre-loaded fraud + benchmark datasets
│   │   └── globalCompanies.js    # Global blue-chip ticker directory
│   └── utils/
│       └── api.js                # Data fetching: SEC EDGAR, Alpha Vantage, Yahoo Finance
├── netlify.toml                  # Netlify build + CORS proxy redirects
├── vite.config.js                # Vite dev proxy (mirrors netlify.toml)
├── .env.example                  # Environment variable template
└── index.html
```

---

## Local Development

### Prerequisites

- Node.js >= 18
- npm >= 9

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_BROTHER_USERNAME/beneish-mscore-fraud-detector.git
cd beneish-mscore-fraud-detector

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Open .env and add your Alpha Vantage API key (free at alphavantage.co)

# 4. Start the dev server
npm run dev
```

Open http://localhost:5173 — the app loads instantly.

> **Note:** The app works without an API key using keyless SEC EDGAR data for US-listed companies.
> The Alpha Vantage key only unlocks additional non-SEC markets.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_ALPHAVANTAGE_API_KEY` | Optional | Free key from https://www.alphavantage.co/support/#api-key |

> ⚠️ **Never commit `.env` to GitHub.** The `.gitignore` already excludes it.
> Set the variable in the **Netlify dashboard** instead (see deployment guide below).



## How the Data Pipeline Works

```
User clicks "Run Analysis"
        │
        ▼
1. Local Cache?     ──yes──▶  Return preloaded dataset (German/Chinese/Indian sandboxes)
        │ no
        ▼
2. SEC EDGAR        ──ok───▶  Full 15-year history (US + international SEC filers)
   (keyless, free)            e.g. AAPL, MSFT, SHOP, SHEL, AZN, HSBC, UL
        │ fail
        ▼
3. Alpha Vantage    ──ok───▶  5-year history (requires API key, 25 req/day free tier)
   (API key)
        │ fail
        ▼
4. Yahoo Finance    ──ok───▶  4-year history via Netlify proxy redirect
   (proxy)
        │ fail
        ▼
5. Manual Entry     ──────▶  Blank simulation sheet — user types numbers manually
```

---

## The 8 Beneish Ratios Explained

| Ratio | What It Detects |
|---|---|
| **DSRI** — Days Sales in Receivables Index | Inflated revenue / channel stuffing |
| **GMI** — Gross Margin Index | Deteriorating margins hidden by manipulation |
| **AQI** — Asset Quality Index | Off-balance-sheet asset inflation |
| **SGI** — Sales Growth Index | High growth creating manipulation incentive |
| **DEPI** — Depreciation Index | Extending asset lives to boost reported earnings |
| **SGAI** — SG&A Expense Index | Rising overhead masked by revenue manipulation |
| **TATA** — Total Accruals to Total Assets | Most direct measure of accrual-based manipulation |
| **LVGI** — Leverage Index | Rising debt creating incentive to manipulate |

### Score Interpretation

| M-Score | Verdict |
|---|---|
| > −1.78 | ⚠️ **FLAGGED** — High probability of manipulation |
| −2.22 to −1.78 | 🟡 **WATCH** — Moderate zone |
| < −2.22 | ✅ **CLEAN** — Low probability of manipulation |

---

## Formula Variants

| Variant | Best For | Cutoff |
|---|---|---|
| Standard 8-Variable | US GAAP companies | −1.78 |
| 5-Variable Compact | Quick screening | −2.22 |
| IFRS International | European, Indian, Asian companies | −1.78 (with adjusted AQI/LVGI bounds) |

---

## Supported Markets

| Region | Exchange | Example Tickers |
|---|---|---|
| 🇺🇸 United States | NASDAQ / NYSE | AAPL, MSFT, TSLA, NVDA, AMZN |
| 🇨🇦 Canada | NYSE / TSX | SHOP, RY, ENB |
| 🇬🇧 United Kingdom | NYSE ADR | SHEL, AZN, BP, HSBC, UL |
| 🇩🇪 Germany | XETRA | MBG, SAP, SIE, VOW3, BMW |
| 🇮🇳 India | BSE / NSE | RELIANCE, TCS, INFY, ITC, WIPRO |
| 🇨🇳 China | SSE / SZSE | BYD (002594), SAIC (600104) |

---

## Disclaimer

> This tool is for **educational and research purposes only**. The Beneish M-Score is a probabilistic
> screening model — a high score does not prove accounting fraud. Always conduct full due diligence
> before making any financial decisions. The authors are not responsible for any investment decisions
> made using this tool.

---

## License

MIT License — free to use, modify, and distribute.

---

## Author

Built by **Kartik Khandelwal** · [GitHub](https://github.com/kartikkhandelwal910)
