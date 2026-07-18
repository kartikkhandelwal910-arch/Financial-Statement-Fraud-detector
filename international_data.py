"""
international_data.py
----------------------
Fallback data source for tickers that aren't US SEC filers. SEC EDGAR
(data_collection.py's only source) covers US-listed companies only —
NSE, BSE, LSE, TSE, HKEX, ASX, TSX, and XETRA-listed companies don't
file 10-Ks with the SEC at all, so they can never appear via that path
no matter how the ticker is spelled.

This module pulls the same financial-statement concepts via yfinance's
`.financials` / `.balance_sheet` / `.cashflow` statements instead, and
maps them into the EXACT same tidy schema data_collection.py produces,
so both sources feed mscore_calculator.py completely unmodified.

HONEST LIMITATIONS — read before trusting output from this path:
  1. Yahoo's free-tier fundamentals typically only go back ~4 fiscal
     years, vs 15+ years available from SEC XBRL. The Beneish M-Score
     needs year-over-year pairs, so a company sourced this way will
     have far fewer scored years than a US SEC filer in the same basket.
  2. International filers report under IFRS, not US GAAP. The Beneish
     M-Score was built and calibrated on US GAAP filers. The ratios
     below still compute without error on IFRS statements, but they are
     NOT strictly apples-to-apples with SEC-sourced rows — read
     cross-border comparisons in the output as directional, not precise.
  3. Yahoo's line-item labels are less standardized than XBRL tags and
     have changed across yfinance versions. YF_TAGS below covers the
     common cases; an unusual statement structure may still come back
     with gaps — check data_warnings and the raw data tab for holes.
  4. No SIC code is available from Yahoo, so yfinance-sourced rows
     never participate in the sector-relative z-score (sector_zscore
     will show NaN for them, same as any SEC row with a missing SIC).
  5. This module has NOT been tested against live Yahoo data in this
     build session (no network access here) — only against a fake
     stand-in object exercising the same parsing logic. Run it once
     yourself against a couple of real non-US tickers before trusting
     the output, exactly as you did for the SEC path.
"""

import numpy as np
import pandas as pd

try:
    import yfinance as yf
except ImportError:
    yf = None

# Each of our internal field names maps to which yfinance statement it
# lives on, plus a priority list of possible row labels (first match
# wins) — the same "priority list" pattern as GAAP_TAGS in
# data_collection.py, just for Yahoo's less-standardized labels.
YF_TAGS = {
    "revenue": {
        "statement": "financials",
        "candidates": ["Total Revenue", "Operating Revenue", "Revenue"],
    },
    "cogs": {
        "statement": "financials",
        "candidates": ["Cost Of Revenue", "Reconciled Cost Of Revenue", "Cost Of Goods Sold"],
    },
    "gross_profit_reported": {
        "statement": "financials",
        "candidates": ["Gross Profit"],
    },
    "sga_expense": {
        "statement": "financials",
        "candidates": [
            "Selling General And Administration",
            "Selling General And Administrative",
            "SG&A Expense",
        ],
    },
    "depreciation": {
        "statement": "cashflow",
        "candidates": [
            "Depreciation And Amortization",
            "Depreciation Amortization Depletion",
            "Depreciation",
        ],
    },
    "net_income": {
        "statement": "financials",
        "candidates": ["Net Income", "Net Income Common Stockholders"],
    },
    "cfo": {
        "statement": "cashflow",
        "candidates": [
            "Operating Cash Flow",
            "Total Cash From Operating Activities",
            "Cash Flow From Continuing Operating Activities",
        ],
    },
    "receivables": {
        "statement": "balance_sheet",
        "candidates": ["Receivables", "Net Receivables", "Accounts Receivable"],
    },
    "current_assets": {
        "statement": "balance_sheet",
        "candidates": ["Current Assets", "Total Current Assets"],
    },
    "ppe_net": {
        "statement": "balance_sheet",
        "candidates": ["Net PPE", "Property Plant Equipment Net", "Net Tangible Assets"],
    },
    "total_assets": {
        "statement": "balance_sheet",
        "candidates": ["Total Assets"],
    },
    "current_liabilities": {
        "statement": "balance_sheet",
        "candidates": ["Current Liabilities", "Total Current Liabilities"],
    },
    "long_term_debt": {
        "statement": "balance_sheet",
        "candidates": ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"],
    },
}


def _lookup_row(statement_df, candidates):
    """
    Returns the first matching row (a Series indexed by period) from a
    yfinance statement DataFrame, or None if none of the candidate
    labels are present. Match is case-insensitive on the row index.
    """
    if statement_df is None or statement_df.empty:
        return None
    index_lower = {str(idx).strip().lower(): idx for idx in statement_df.index}
    for candidate in candidates:
        key = candidate.strip().lower()
        if key in index_lower:
            return statement_df.loc[index_lower[key]]
    return None


def is_likely_non_us_ticker(ticker: str) -> bool:
    """
    Heuristic only: a ticker with a Yahoo exchange suffix (a dot followed
    by letters — .NS for NSE, .BO for BSE, .L for LSE, .T for TSE, .HK
    for HKEX, .AX for ASX, .TO for TSX, .DE for XETRA, etc.) is not a US
    SEC filer, so there's no point spending a request checking SEC's
    ticker map first. Plain tickers (AAPL, MSFT) still try SEC first —
    this is just an optimization; collect_dataset falls back to
    yfinance either way if SEC doesn't have the ticker.
    """
    return "." in ticker and not ticker.upper().endswith(".US")


def fetch_via_yfinance(ticker: str) -> pd.DataFrame:
    """
    Pulls one ticker's financials via yfinance and returns a tidy
    DataFrame in the SAME schema as
    data_collection.fetch_company_financials (fiscal_year, revenue,
    cogs, receivables, ..., ticker, data_warnings), plus a data_source
    column set to 'yfinance'. sic/sic_description are left unset here —
    see limitation #4 above — and get filled with None by the caller.

    Raises ValueError if yfinance isn't installed or returns no usable
    annual statements, mirroring fetch_company_financials' error
    behavior so collect_dataset's existing try/except handles both
    sources identically.
    """
    if yf is None:
        raise ValueError(
            "yfinance is not installed — add 'yfinance' to requirements.txt "
            "to enable non-US-exchange tickers."
        )

    tk = yf.Ticker(ticker)
    statements = {
        "financials": tk.financials,
        "balance_sheet": tk.balance_sheet,
        "cashflow": tk.cashflow,
    }

    if all(s is None or s.empty for s in statements.values()):
        raise ValueError(f"{ticker}: yfinance returned no financial statements")

    # yfinance statement columns are period-end Timestamps.
    periods = set()
    for s in statements.values():
        if s is not None and not s.empty:
            periods.update(s.columns)
    periods = sorted(periods)

    rows = []
    for period in periods:
        row = {"fiscal_year": pd.Timestamp(period).year}
        for field, spec in YF_TAGS.items():
            statement_df = statements.get(spec["statement"])
            series = _lookup_row(statement_df, spec["candidates"])
            row[field] = series[period] if (series is not None and period in series.index) else np.nan
        rows.append(row)

    df = pd.DataFrame(rows)

    # Two statement periods can land in the same calendar year (e.g. a
    # fiscal-year-end change) — keep whichever row has more populated
    # fields for that year rather than silently duplicating or picking
    # an arbitrary one.
    df["_completeness"] = df.notna().sum(axis=1)
    df = (
        df.sort_values("_completeness")
        .drop_duplicates("fiscal_year", keep="last")
        .drop(columns="_completeness")
        .sort_values("fiscal_year")
        .reset_index(drop=True)
    )

    df["ticker"] = ticker.upper()
    df["cik"] = None
    df["data_source"] = "yfinance"
    df["data_warnings"] = ""

    # Same long_term_debt zero-assumption rule as the SEC path (see
    # data_collection.fetch_company_financials), for consistency: Yahoo
    # also tends to omit the line entirely rather than report an
    # explicit 0 when a company carries no long-term debt.
    zero_assumed_mask = df["long_term_debt"].isna()
    df.loc[zero_assumed_mask, "data_warnings"] = (
        "long_term_debt assumed $0 (not reported by data source; likely no debt outstanding)"
    )
    df["long_term_debt"] = df["long_term_debt"].fillna(0)

    return df
