# Beneish M-Score Screener — Forensic Earnings-Manipulation Detector

**Live forensic-accounting screen that flags likely earnings manipulation using real SEC EDGAR and Yahoo Finance data — across US and international exchanges.**

🔗 **[Live App](https://beneish-mscore-screener.streamlit.app/)** — enter a few tickers and get results in your browser, no setup required.

![Dashboard](mscore_dashboard.png)

---

## What It Does

Pulls multi-year financial statements for any company, computes the 8-ratio **Beneish M-Score** (DSRI, GMI, AQI, SGI, DEPI, SGAI, TATA, LVGI), combines them into a composite score, and flags likely earnings manipulators two ways:

1. **Fixed academic threshold** (-1.78, from Beneish's original 1999 paper)
2. **Sector-relative z-score** — how unusual a company's score is versus its own industry peers, since the fixed threshold was calibrated on a mostly-industrial, pre-2000 US sample and doesn't transfer cleanly to every sector

Results are cross-checked against a small library of known historical fraud cases (Enron, WorldCom, Under Armour) as a sanity check, and rendered as a combined trend/comparison/radar dashboard.

## Why This Matters

The Beneish M-Score is used informally by forensic accounting and internal audit teams, short-sellers and hedge funds sourcing ideas, and equity research analysts assessing earnings quality. It famously flagged Enron years before its collapse.

## Try It

- **Live app:** [beneish-mscore-screener.streamlit.app](https://beneish-mscore-screener.streamlit.app/) — type in tickers, click Run, get the dashboard
- **US companies:** `AAPL`, `MSFT`, `AMZN`, `NVDA`, `UAA`
- **International companies** (via Yahoo Finance suffix): `RELIANCE.NS` / `TCS.NS` (NSE, India), `BMW.DE` (XETRA, Germany), `7203.T` (TSE, Japan), `0700.HK` (HKEX, Hong Kong), `BHP.AX` (ASX, Australia), `SHOP.TO` (TSX, Canada), `VOD.L` (LSE, UK)
- **Won't work:** banks, insurers, and other financial institutions (see Known Limitations below) — the app will tell you why if you try one

## System Architecture

```
Tickers
   │
   ├─ US SEC filer? ──► data_collection.py ──────► SEC EDGAR XBRL (10-K/10-K/A, US GAAP)
   │
   └─ Other exchange? ► international_data.py ───► Yahoo Finance (yfinance, IFRS)
                              │
                              ▼
                   mscore_calculator.py   (8-ratio Beneish M-Score, academic +
                                            sector-relative flagging)
                              │
                              ▼
                   visualization.py       (trend, comparison bar, radar,
                                            summary table, combined dashboard)
                              │
                              ▼
                   streamlit_app.py       (live interactive web app)
              main_notebook.ipynb         (Colab notebook — same pipeline, static run)
```

Every row is tagged with `data_source` (`sec_edgar` or `yfinance`) so mixed-source results are never mistaken for a single, uniform dataset — see the caveats below.

## Data Sources & Libraries

| Source | Coverage | Standard | Typical History | Cost |
|---|---|---|---|---|
| SEC EDGAR XBRL (`companyfacts`, `submissions`) | US-listed filers | US GAAP | 10-15+ years | Free, no key (requires a descriptive `User-Agent` email) |
| Yahoo Finance (`yfinance`) | NSE, LSE, TSE, HKEX, ASX, TSX, XETRA, and more | IFRS (varies by market) | ~4 years (free tier) | Free, no key |

**Libraries:** `streamlit`, `pandas`, `numpy`, `requests`, `matplotlib`, `yfinance` (see `requirements.txt`)

## File Structure

```
streamlit_app.py         Live interactive web app — the primary way to use this project
data_collection.py       SEC EDGAR pull, validation, sector lookup (US filers)
international_data.py    Yahoo Finance fallback for non-US exchanges
mscore_calculator.py     8-ratio M-Score, academic + sector-relative flagging
visualization.py         Trend line, comparison bar, radar, summary table, dashboard
main_notebook.ipynb      Colab notebook — same pipeline, one static run
requirements.txt         Dependencies for the Streamlit app
README.md                This file
mscore_dashboard.png     Static dashboard export, regenerated from the notebook
```

## How to Run

**Option A — use the live app (recommended):** [beneish-mscore-screener.streamlit.app](https://beneish-mscore-screener.streamlit.app/). Enter your name + email (SEC requires this on every request), your ticker basket, click Run.

**Option B — Google Colab (for offline/notebook use):**
1. Open `main_notebook.ipynb` in Google Colab.
2. Upload `data_collection.py`, `international_data.py`, `mscore_calculator.py`, `visualization.py` into the same Colab session (Files pane, left sidebar).
3. In the config cell, set `data_collection.USER_AGENT` to your real name + email, and edit `TICKERS`.
4. Run all cells top to bottom.

**Resume line:** *Built and deployed a live forensic earnings-quality screening web app applying the Beneish M-Score across 8 financial ratios to real SEC EDGAR and Yahoo Finance data spanning US and international exchanges, with sector-relative outlier detection and automated accounting-identity validation — the same category of tool used by forensic accounting, short-selling, and equity research teams.*

---

## Known Limitations (Honest List)

**Model scope:**
- **Not meaningful for banks, insurers, or other financial institutions.** These companies don't report Cost of Goods Sold (no goods are sold) or a classified current/non-current balance sheet, so GMI, AQI, and LVGI can never be computed for them — the app detects this pattern and warns explicitly rather than failing with a bare error. This mirrors the real accounting literature: the Beneish M-Score was built and calibrated on non-financial industrial companies.
- **International (yfinance) results use IFRS, not US GAAP.** The M-Score's ratios still compute without error on IFRS statements, but they are **not strictly apples-to-apples** with SEC-sourced (US GAAP) rows — read cross-border comparisons as directional, not precise. Every row's `data_source` column makes this visible rather than hidden.
- **International history depth is shorter.** Yahoo's free tier typically returns ~4 fiscal years vs. 15+ from SEC XBRL, meaning fewer year-over-year pairs and noisier ratios for non-US companies.

**Data quality:**
- `data_warnings` are heuristic 5% tolerance checks (`current_assets + ppe_net <= total_assets`, `revenue - cogs ≈ reported GrossProfit`), not a full double-entry reconciliation.
- **XBRL segment/dimension filtering is unresolved.** A multinational filer reporting `Revenues` at both consolidated and segment level under the same tag could have the extraction pull a segment value instead of the consolidated total. Not fixable through SEC's simplified `companyfacts` API — would require a full XBRL taxonomy parser.
- Yahoo's line-item labels are less standardized than XBRL tags and have changed across `yfinance` versions; an unusual statement structure may still come back with gaps.

**Engineering:**
- No `pytest` suite — validated via synthetic edge-case testing (zero-revenue years, missing fields, mixed-source pipelines) rather than a formal test suite.
- SEC rate limiting is a flat `time.sleep(0.15)`, not adaptive backoff on 429 responses.
- Sector grouping uses 2-digit SIC codes — coarse, fine for a small basket, too coarse for a large one (would want 4-digit SIC or GICS for that).

## Adding a New Historical Fraud Case

In `mscore_calculator.py`:

```python
KNOWN_FRAUD_CASES = {
    "ENRN": "Enron — 2001 accounting fraud, flagged retrospectively by the "
            "original Beneish model.",
    "WCOM": "WorldCom — 2002 expense capitalization fraud.",
    "UAA": "Under Armour — SEC settled 2021 over 'pull-forward' sales "
           "practices used to hit revenue targets, 2015-2016.",
    "TYC": "Tyco International — 2002 executive fraud and improper "
           "accounting for acquisitions.",   # <- add like this
}
```

Rules: ticker in quotes, colon, description in quotes, comma after every line except the last, same 4-space indent. The ticker also needs to be in your ticker basket, or it won't appear in the pulled dataset to be annotated. Delisted/bankrupt companies (Enron, WorldCom, Tyco-era ticker) usually aren't in SEC's current ticker→CIK map — you'd need their CIK from EDGAR's full-text search and a direct-by-CIK fetch, which `data_collection.py` doesn't currently support standalone.

## Roadmap

1. Add Altman Z-Score and Piotroski F-Score, combine into one earnings-quality composite index alongside the M-Score.
2. SEC full-text search + a simple NLP pass over MD&A hedging language as a secondary, non-financial-statement signal.
3. Adaptive backoff for SEC rate limiting instead of a flat sleep.
4. A proper `pytest` suite covering the edge cases currently validated only ad hoc.
