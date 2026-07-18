"""
data_collection.py
-------------------
Pulls multi-year 10-K financial statement data for a basket of tickers from
SEC EDGAR's free XBRL companyfacts API, normalizes it into a tidy
(ticker, fiscal_year) DataFrame, and runs a lightweight accounting-identity
validation pass to catch mistagged/inconsistent pulls before they reach the
M-Score engine.

Upgrades included (v2):
  1. Financial-statement cross-validation layer (validate_financials)
  2. Sector lookup (get_company_sic) — feeds sector-relative thresholds
     in mscore_calculator.py
  3. Restatement-aware extraction — prefers 10-K/A over 10-K for a given
     fiscal year, and takes the most-recently-filed value when SEC has
     multiple filings covering the same period.
"""

import time
import requests
import pandas as pd
import numpy as np

import international_data

# REQUIRED by SEC: a descriptive User-Agent with a real contact email.
# Overwritten by the notebook before any request is made.
USER_AGENT = "Set USER_AGENT before running (see notebook config cell)"

BASE_HEADERS = lambda: {"User-Agent": USER_AGENT}

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"

REQUEST_DELAY_SECONDS = 0.15  # naive but SEC-friendly; see README for upgrade note

# Each financial-statement concept maps to a priority list of us-gaap XBRL
# tags, since different filers (and different eras of the same filer) tag
# the same line item under different names. First tag with usable data wins.
GAAP_TAGS = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
        "SalesRevenueServicesNet",
        "RevenuesNetOfInterestExpense",
        "TotalRevenuesAndOtherIncome",
    ],
    "cogs": [
        "CostOfGoodsAndServicesSold",
        "CostOfRevenue",
        "CostOfGoodsSold",
        "CostOfServices",
        "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization",
        "CostOfGoodsSoldExcludingDepreciationDepletionAndAmortization",
        "CostOfRevenueGoodsAndServicesSold",
    ],
    "receivables": [
        "AccountsReceivableNetCurrent",
        "ReceivablesNetCurrent",
        "AccountsAndOtherReceivablesNetCurrent",
        "AccountsReceivableNet",
        "NontradeReceivablesCurrent",
        "AccountsNotesAndLoansReceivableNetCurrent",
    ],
    "current_assets": [
        "AssetsCurrent",
    ],
    "ppe_net": [
        "PropertyPlantAndEquipmentNet",
        "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization",
        "PropertyPlantAndEquipmentNetExcludingCapitalLeasedAssets",
        "RealEstateAndAccumulatedDepreciation",
    ],
    "total_assets": [
        "Assets",
    ],
    "depreciation": [
        "DepreciationDepletionAndAmortization",
        "DepreciationAndAmortization",
        "DepreciationAmortizationAndAccretionNet",
        "Depreciation",
        "DepreciationNonproduction",
        "DepreciationAmortizationAndImpairmentNetc",
        "DepreciationDepletionAndAmortizationNonproduction",
    ],
    "sga_expense": [
        "SellingGeneralAndAdministrativeExpense",
        "GeneralAndAdministrativeExpense",
        "SellingGeneralAndAdministrativeExpenses",
        "SellingAndMarketingExpense",
        "GeneralAndAdministrativeExpenses",
        "SellingGeneralAndAdministrativeExpensesExcludingDepreciationDepletionAndAmortization",
    ],
    "current_liabilities": [
        "LiabilitiesCurrent",
    ],
    "long_term_debt": [
        "LongTermDebtNoncurrent",
        "LongTermDebt",
        "LongTermDebtAndCapitalLeaseObligations",
        "LongTermNotesAndLoans",
        "DebtInstrumentCarryingAmount",
        "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
    ],
    "net_income": [
        "NetIncomeLoss",
        "ProfitLoss",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
    ],
    "cfo": [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
        "NetCashProvidedByOperatingActivities",
        "CashProvidedByUsedInOperatingActivities",
    ],
    # Used only for the cross-validation layer, not fed into the M-Score itself.
    "gross_profit_reported": [
        "GrossProfit",
    ],
}


def load_ticker_cik_map():
    """Returns {ticker: cik_10digit_str} from SEC's master ticker file."""
    resp = requests.get(TICKER_MAP_URL, headers=BASE_HEADERS(), timeout=15)
    resp.raise_for_status()
    data = resp.json()
    return {
        row["ticker"].upper(): str(row["cik_str"]).zfill(10)
        for row in data.values()
    }


def get_company_sic(cik: str) -> dict:
    """
    Fetches SIC code + description for a company, for sector-relative
    M-Score thresholds. Returns {'sic': str, 'sic_description': str} or
    {'sic': None, 'sic_description': None} on failure (never raises —
    a missing sector is a degraded, not fatal, condition downstream).
    """
    try:
        resp = requests.get(SUBMISSIONS_URL.format(cik=cik), headers=BASE_HEADERS(), timeout=15)
        resp.raise_for_status()
        data = resp.json()
        return {
            "sic": data.get("sic"),
            "sic_description": data.get("sicDescription"),
        }
    except Exception:
        return {"sic": None, "sic_description": None}


def _extract_annual_series(facts_json, tag_list, instant=False):
    """
    Walks the raw SEC XBRL companyfacts JSON for one company and pulls the
    best available annual (10-K / 10-K/A) value per fiscal year, MERGING
    across every tag in tag_list rather than stopping at the first tag
    that has any data.

    This merge matters because companies routinely switch which us-gaap
    tag they use for the same concept partway through their filing
    history (the most common case: nearly every filer switched revenue
    tags around 2018 when ASC 606 took effect, e.g. Revenues /
    SalesRevenueNet pre-2018 -> RevenueFromContractWithCustomerExcluding-
    AssessedTax after). Returning on the first non-empty tag would silently
    drop every year only covered by the *other* tag — an earlier version
    of this function did exactly that and lost ~50-90% of early years for
    revenue, cogs, depreciation, and long_term_debt across every ticker.

    Priority rule: for a fiscal year covered by more than one tag in
    tag_list, the earlier tag in the list wins (it's listed first because
    it's the more standard/preferred tag). Restatement handling (10-K/A
    over 10-K, most-recently-filed value) still applies within a single
    tag's own history for that year.

    instant=True is for point-in-time balance-sheet items (e.g. Assets),
    which have no 'start' date, only 'end'. instant=False is for
    duration items (e.g. Revenues), filtered to a 330-400 day span so a
    quarterly or 9-month YTD figure never gets mistaken for a full
    fiscal year.
    """
    us_gaap = facts_json.get("facts", {}).get("us-gaap", {})
    merged = {}  # fiscal_year -> {"tag_idx": int, "rank": tuple, "val": float}

    for tag_idx, tag in enumerate(tag_list):
        if tag not in us_gaap:
            continue
        usd_facts = us_gaap[tag].get("units", {}).get("USD", [])
        if not usd_facts:
            continue

        for fact in usd_facts:
            if fact.get("form") not in ("10-K", "10-K/A"):
                continue
            end = fact.get("end")
            if not end:
                continue
            if not instant:
                start = fact.get("start")
                if not start:
                    continue
                days = (pd.Timestamp(end) - pd.Timestamp(start)).days
                if not (330 <= days <= 400):
                    continue

            fy = fact.get("fy") or pd.Timestamp(end).year
            candidate_rank = (
                1 if fact.get("form") == "10-K/A" else 0,  # restatement preferred
                fact.get("filed", ""),                      # then most recently filed
            )

            existing = merged.get(fy)
            if existing is None:
                merged[fy] = {"tag_idx": tag_idx, "rank": candidate_rank, "val": fact["val"]}
            elif tag_idx == existing["tag_idx"] and candidate_rank > existing["rank"]:
                # Same tag, but a more-authoritative filing for the same year
                merged[fy] = {"tag_idx": tag_idx, "rank": candidate_rank, "val": fact["val"]}
            # else: fy already covered by an earlier (higher-priority) tag — keep it

    return {fy: v["val"] for fy, v in merged.items()}


INSTANT_FIELDS = {"receivables", "current_assets", "ppe_net", "total_assets", "current_liabilities", "long_term_debt"}


def fetch_company_financials(ticker: str, ticker_cik_map: dict) -> pd.DataFrame:
    """Pulls one ticker's full multi-year DataFrame across all GAAP_TAGS concepts."""
    cik = ticker_cik_map.get(ticker.upper())
    if cik is None:
        raise ValueError(f"{ticker}: not found in SEC ticker->CIK map (delisted or invalid ticker)")

    resp = requests.get(FACTS_URL.format(cik=cik), headers=BASE_HEADERS(), timeout=20)
    resp.raise_for_status()
    facts_json = resp.json()

    series = {}
    for field, tags in GAAP_TAGS.items():
        series[field] = _extract_annual_series(facts_json, tags, instant=field in INSTANT_FIELDS)

    all_years = sorted(set().union(*[s.keys() for s in series.values()])) if any(series.values()) else []
    rows = []
    for fy in all_years:
        row = {"fiscal_year": int(fy)}
        for field in GAAP_TAGS:
            row[field] = series[field].get(fy, np.nan)
        rows.append(row)

    df = pd.DataFrame(rows)
    df["ticker"] = ticker.upper()
    df["cik"] = cik
    df["data_source"] = "sec_edgar"
    df["data_warnings"] = ""

    # LongTermDebt is a special case: XBRL filers routinely omit the tag
    # entirely when the balance is zero (they don't file a fact with
    # val=0 — they just don't tag it), rather than it being a genuine
    # data gap. Assuming 0 only for this field is a deliberate, narrow
    # exception — every other missing field stays NaN because "missing"
    # there really does mean "we don't know," not "it's zero."
    zero_assumed_mask = df["long_term_debt"].isna()
    df.loc[zero_assumed_mask, "data_warnings"] = "long_term_debt assumed $0 (no tag filed; likely no debt outstanding)"
    df["long_term_debt"] = df["long_term_debt"].fillna(0)

    return df


def validate_financials(df: pd.DataFrame) -> pd.DataFrame:
    """
    Upgrade 1: cross-checks derived accounting identities against reported
    totals for each ticker/fiscal-year row and appends a `data_warnings`
    column (empty string if clean). This catches mistagged pulls before
    they silently corrupt an M-Score, without dropping the row — a flagged
    row is still shown, just with a visible caveat.

    Checks (5% relative tolerance):
      - current_assets + ppe_net <= total_assets
      - revenue - cogs ~= reported GrossProfit tag, when that tag exists
    """
    warnings_col = []
    for _, row in df.iterrows():
        msgs = []
        ca, ppe, ta = row.get("current_assets"), row.get("ppe_net"), row.get("total_assets")
        if pd.notna(ca) and pd.notna(ppe) and pd.notna(ta) and ta > 0:
            if (ca + ppe) > ta * 1.05:
                msgs.append("current_assets+ppe_net exceeds total_assets by >5%")

        rev, cogs, gp_reported = row.get("revenue"), row.get("cogs"), row.get("gross_profit_reported")
        if pd.notna(rev) and pd.notna(cogs) and pd.notna(gp_reported):
            implied_gp = rev - cogs
            if gp_reported != 0 and abs(implied_gp - gp_reported) / abs(gp_reported) > 0.05:
                msgs.append("revenue-cogs deviates from reported GrossProfit by >5%")

        warnings_col.append("; ".join(msgs))

    df = df.copy()
    existing = df["data_warnings"] if "data_warnings" in df.columns else pd.Series([""] * len(df), index=df.index)
    combined = []
    for existing_msg, new_msg in zip(existing.fillna(""), warnings_col):
        parts = [m for m in (existing_msg, new_msg) if m]
        combined.append("; ".join(parts))
    df["data_warnings"] = combined
    return df


def debug_available_tags(ticker: str, keyword: str, ticker_cik_map: dict = None):
    """
    DIAGNOSTIC — not used by the main pipeline. Lists every us-gaap tag SEC
    actually has on file for `ticker` whose name contains `keyword`
    (case-insensitive), along with how many annual (10-K/10-K/A) USD facts
    each tag has and which fiscal years they cover.

    Use this when a field is coming back NaN and you want to see the real
    tag SEC used instead of guessing. Example:
        debug_available_tags('AAPL', 'depreciation')
        debug_available_tags('UAA', 'debt')
    """
    if ticker_cik_map is None:
        ticker_cik_map = load_ticker_cik_map()
    cik = ticker_cik_map.get(ticker.upper())
    if cik is None:
        print(f"{ticker}: not found in SEC ticker map")
        return

    resp = requests.get(FACTS_URL.format(cik=cik), headers=BASE_HEADERS(), timeout=20)
    resp.raise_for_status()
    us_gaap = resp.json().get("facts", {}).get("us-gaap", {})

    matches = [tag for tag in us_gaap if keyword.lower() in tag.lower()]
    if not matches:
        print(f"{ticker}: no us-gaap tags contain '{keyword}'")
        return

    for tag in sorted(matches):
        usd_facts = us_gaap[tag].get("units", {}).get("USD", [])
        annual = [f for f in usd_facts if f.get("form") in ("10-K", "10-K/A")]
        years = sorted(set(f.get("fy") for f in annual if f.get("fy")))
        print(f"{tag}: {len(annual)} annual USD facts, fiscal years {years}")


def diagnose_ticker_gaps(ticker: str, ticker_cik_map: dict = None):
    """
    DIAGNOSTIC — runs every GAAP_TAGS concept for one ticker and prints
    exactly which tag (if any) matched and which fiscal years it covered,
    so you can see at a glance which concept/field is the weak link for
    that specific company instead of scanning a wall of NaNs.
    """
    if ticker_cik_map is None:
        ticker_cik_map = load_ticker_cik_map()
    cik = ticker_cik_map.get(ticker.upper())
    if cik is None:
        print(f"{ticker}: not found in SEC ticker map")
        return

    resp = requests.get(FACTS_URL.format(cik=cik), headers=BASE_HEADERS(), timeout=20)
    resp.raise_for_status()
    facts_json = resp.json()

    print(f"--- {ticker} (CIK {cik}) ---")
    for field, tags in GAAP_TAGS.items():
        instant = field in INSTANT_FIELDS
        winner = None
        for tag in tags:
            series = _extract_annual_series(facts_json, [tag], instant=instant)
            if series:
                winner = (tag, sorted(series.keys()))
                break
        if winner:
            print(f"  {field:24s} <- {winner[0]:45s} years {winner[1]}")
        else:
            print(f"  {field:24s} <- NO MATCH in {len(tags)} candidate tags: {tags}")


def collect_dataset(tickers, include_sector=True):
    """
    Loops over tickers, pulls financials, runs validation, and concatenates.
    Skips (does not crash on) any ticker that errors out — SEC tagging is
    inconsistent enough that one bad ticker shouldn't kill the whole batch.
    Prints a per-ticker status line so failures are visible, not silent.

    Data source per ticker:
      - US SEC filers (the default case) go through SEC EDGAR XBRL, same
        as before — this path is unchanged and already tested end-to-end.
      - A ticker with a Yahoo exchange suffix (e.g. 'RELIANCE.NS',
        'BMW.DE', '7203.T') is not a US SEC filer, so it's routed
        straight to the yfinance fallback in international_data.py.
      - A plain ticker (no suffix) that SEC's map doesn't recognize also
        falls back to yfinance automatically, rather than being skipped
        outright — covers delisted-from-SEC-map edge cases and typos
        that still resolve on Yahoo.
      - Every row is tagged with data_source ('sec_edgar' or 'yfinance')
        so mixed-source results are always visibly attributable — see
        international_data.py's module docstring for why SEC-sourced and
        yfinance-sourced M-Scores are NOT strictly apples-to-apples
        (different accounting standards, different history depth).
    """
    ticker_cik_map = load_ticker_cik_map()
    frames = []
    sic_cache = {}

    for ticker in tickers:
        is_sec_candidate = (
            not international_data.is_likely_non_us_ticker(ticker)
            and ticker.upper() in ticker_cik_map
        )
        try:
            if is_sec_candidate:
                df = fetch_company_financials(ticker, ticker_cik_map)
                if df.empty:
                    print(f"  [skip] {ticker}: no annual XBRL data returned")
                    continue
                df = validate_financials(df)

                if df["cogs"].isna().all() and df["current_assets"].isna().all():
                    print(
                        f"  [warn] {ticker}: 'cogs' and 'current_assets' are entirely "
                        f"missing from SEC's filings for this company — the signature "
                        f"pattern of a bank, insurer, or other financial institution. "
                        f"These companies don't report Cost of Goods Sold (no goods are "
                        f"sold) or a classified current/non-current balance sheet, so "
                        f"GMI, AQI, and LVGI can never be computed for it. The Beneish "
                        f"M-Score was built for non-financial industrial companies and "
                        f"is not considered meaningful for banks/insurers in the "
                        f"underlying literature — this ticker will likely produce zero "
                        f"scored years even though the data pull itself succeeded."
                    )

                if include_sector:
                    cik = ticker_cik_map.get(ticker.upper())
                    if cik not in sic_cache:
                        sic_cache[cik] = get_company_sic(cik)
                        time.sleep(REQUEST_DELAY_SECONDS)
                    df["sic"] = sic_cache[cik]["sic"]
                    df["sic_description"] = sic_cache[cik]["sic_description"]

                n_warned = (df["data_warnings"] != "").sum()
                warn_note = f", {n_warned} year(s) flagged by validation" if n_warned else ""
                print(f"  [ok]   {ticker}: {len(df)} fiscal years{warn_note} (SEC EDGAR)")
                frames.append(df)
            else:
                df = international_data.fetch_via_yfinance(ticker)
                if df.empty:
                    print(f"  [skip] {ticker}: no usable data from any source")
                    continue
                df = validate_financials(df)
                if include_sector:
                    # No SIC code available from Yahoo — see
                    # international_data.py limitation #4. Left as None
                    # so these rows simply don't join a sector peer
                    # group, same handling as a US row with missing SIC.
                    df["sic"] = None
                    df["sic_description"] = None

                n_warned = (df["data_warnings"] != "").sum()
                warn_note = f", {n_warned} year(s) flagged by validation" if n_warned else ""
                print(f"  [ok]   {ticker}: {len(df)} fiscal years{warn_note} (yfinance — "
                      f"IFRS/shorter-history caveats apply, see international_data.py)")
                frames.append(df)
        except Exception as e:
            print(f"  [skip] {ticker}: {e}")
        time.sleep(REQUEST_DELAY_SECONDS)

    if not frames:
        raise RuntimeError("No data collected for any ticker — check tickers and USER_AGENT.")

    return pd.concat(frames, ignore_index=True)


if __name__ == "__main__":
    # Cannot hit SEC from this sandbox (network is allow-listed to package
    # registries only) — this block documents intended standalone usage.
    print("data_collection.py — run collect_dataset(['AAPL','MSFT']) from the notebook.")
