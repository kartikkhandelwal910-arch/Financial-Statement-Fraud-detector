"""
mscore_calculator.py
---------------------
Computes the 8 Beneish M-Score component ratios and the composite M-Score
from a tidy (ticker, fiscal_year) financial statement DataFrame produced by
data_collection.collect_dataset(), flags likely earnings manipulators, and
cross-checks results against a small library of known historical fraud
cases as a sanity check.

Upgrade included (v2): sector-relative flagging alongside the fixed
academic threshold. Beneish's -1.78 cutoff was calibrated on a mostly-
industrial, pre-2000 US sample and doesn't transfer cleanly across sectors
(tech and financials in particular run structurally different ratios).
compute_sector_relative_flags() computes a within-sector z-score using the
SIC code pulled by data_collection, so a company can be read both against
the absolute academic bar and against its own peer group.
"""

import numpy as np
import pandas as pd

# Academic manipulation threshold (Beneish, 1999).
# M-Score above this value is associated with a higher probability the
# company is manipulating earnings.
MANIPULATION_THRESHOLD = -1.78

MSCORE_WEIGHTS = {
    "DSRI": 0.920,
    "GMI": 0.528,
    "AQI": 0.404,
    "SGI": 0.892,
    "DEPI": 0.115,
    "SGAI": -0.172,
    "TATA": 4.679,
    "LVGI": -0.327,
}
MSCORE_INTERCEPT = -4.84

# A few well-known historical earnings-manipulation cases, for use as a
# validation sanity check against the model's flagged output. Extend this
# freely with tickers you have historical filings for (see README for the
# step-by-step on adding new cases).
KNOWN_FRAUD_CASES = {
    "ENRN": "Enron — 2001 accounting fraud, flagged retrospectively by the "
            "original Beneish model.",
    "WCOM": "WorldCom — 2002 expense capitalization fraud.",
    "UAA": "Under Armour — SEC settled 2021 over 'pull-forward' sales "
           "practices used to hit revenue targets, 2015-2016.",
}


def compute_mscore_components(df: pd.DataFrame) -> pd.DataFrame:
    """
    Takes the tidy financials DataFrame (one row per ticker/fiscal_year)
    and returns a DataFrame with one row per ticker/fiscal_year-pair
    (current year t vs prior year t-1) containing all 8 M-Score components
    plus the composite score.
    """
    df = df.sort_values(["ticker", "fiscal_year"]).copy()

    # Derived line items
    df["gross_profit"] = df["revenue"] - df["cogs"]
    df["gross_margin"] = df["gross_profit"] / df["revenue"]
    df["asset_quality"] = 1 - (df["current_assets"] + df["ppe_net"]) / df["total_assets"]
    df["dep_rate"] = df["depreciation"] / (df["depreciation"] + df["ppe_net"])
    df["leverage"] = (df["current_liabilities"] + df["long_term_debt"]) / df["total_assets"]
    df["sga_pct_sales"] = df["sga_expense"] / df["revenue"]
    df["receivables_pct_sales"] = df["receivables"] / df["revenue"]

    # Carry sector metadata through if data_collection attached it
    has_sector = "sic" in df.columns

    results = []
    for ticker, g in df.groupby("ticker"):
        g = g.sort_values("fiscal_year").reset_index(drop=True)
        for i in range(1, len(g)):
            t, p = g.iloc[i], g.iloc[i - 1]  # current (t), prior (t-1)
            try:
                with np.errstate(divide="ignore", invalid="ignore"):
                    # Silence numpy's RuntimeWarning for 0/0 or x/0 here —
                    # we check for the resulting NaN/inf explicitly below
                    # instead of letting it print a warning and slip through.
                    dsri = t["receivables_pct_sales"] / p["receivables_pct_sales"]
                    gmi = p["gross_margin"] / t["gross_margin"]
                    aqi = t["asset_quality"] / p["asset_quality"]
                    sgi = t["revenue"] / p["revenue"]
                    depi = p["dep_rate"] / t["dep_rate"]
                    sgai = t["sga_pct_sales"] / p["sga_pct_sales"]
                    lvgi = t["leverage"] / p["leverage"]
                    tata = (t["net_income"] - t["cfo"]) / t["total_assets"]

                components = [dsri, gmi, aqi, sgi, depi, sgai, tata, lvgi]
                if any(not np.isfinite(c) for c in components):
                    # A missing input (e.g. ppe_net not tagged that year),
                    # OR a zero denominator (e.g. a company with $0 revenue
                    # in the prior year), produces a silent NaN *or* inf
                    # here rather than an exception. NaN > threshold is
                    # False (would hide an incomplete year as "clean"),
                    # but inf > threshold is True (would falsely flag a
                    # $0-revenue year as a manipulator). np.isfinite()
                    # catches both — pd.isna() alone, as before, missed
                    # the inf case. Skip the row either way so incomplete
                    # or undefined data is absent, not misleading.
                    continue

                mscore = (
                    MSCORE_INTERCEPT
                    + MSCORE_WEIGHTS["DSRI"] * dsri
                    + MSCORE_WEIGHTS["GMI"] * gmi
                    + MSCORE_WEIGHTS["AQI"] * aqi
                    + MSCORE_WEIGHTS["SGI"] * sgi
                    + MSCORE_WEIGHTS["DEPI"] * depi
                    + MSCORE_WEIGHTS["SGAI"] * sgai
                    + MSCORE_WEIGHTS["TATA"] * tata
                    + MSCORE_WEIGHTS["LVGI"] * lvgi
                )

                row = {
                    "ticker": ticker,
                    "fiscal_year": int(t["fiscal_year"]),
                    "DSRI": dsri, "GMI": gmi, "AQI": aqi, "SGI": sgi,
                    "DEPI": depi, "SGAI": sgai, "TATA": tata, "LVGI": lvgi,
                    "MScore": mscore,
                    "flagged": mscore > MANIPULATION_THRESHOLD,
                    "data_warnings": t.get("data_warnings", "") if "data_warnings" in g.columns else "",
                }
                if has_sector:
                    row["sic"] = t.get("sic")
                    row["sic_description"] = t.get("sic_description")
                results.append(row)
            except (ZeroDivisionError, KeyError):
                continue  # incomplete data for this year-pair — skip

    result_df = pd.DataFrame(results)
    if result_df.empty:
        raise RuntimeError(
            "No M-Score could be computed — check that at least 2 fiscal "
            "years of complete data were collected per ticker."
        )

    if has_sector:
        result_df = compute_sector_relative_flags(result_df)

    return result_df


def compute_sector_relative_flags(mscore_df: pd.DataFrame) -> pd.DataFrame:
    """
    Upgrade: within-sector z-score of MScore, using the 2-digit SIC prefix
    as the peer group (2-digit SIC = broad industry group, e.g. '73' =
    business services, '28' = chemicals — coarse enough to give each
    group a workable sample size from a small ticker basket).

    Adds:
      sector_group      — 2-digit SIC prefix used for grouping
      sector_zscore      — (MScore - peer mean) / peer std, NaN if the
                            peer group has fewer than 2 members (can't
                            compute a meaningful std) or SIC is missing
      sector_flagged     — True if sector_zscore > 1.5 (top ~7% of a
                            peer group under a normal approximation)

    This is a *secondary* signal, not a replacement for MANIPULATION_THRESHOLD
    — it tells you "unusual for its industry," which is a different claim
    than "unusual vs. Beneish's original pre-2000 industrial sample."
    """
    df = mscore_df.copy()
    df["sector_group"] = df["sic"].astype(str).str[:2]
    df.loc[df["sic"].isna(), "sector_group"] = np.nan

    group_mean = df.groupby("sector_group")["MScore"].transform("mean")
    group_std = df.groupby("sector_group")["MScore"].transform("std")
    group_size = df.groupby("sector_group")["MScore"].transform("size")

    df["sector_zscore"] = np.where(
        (group_size >= 2) & (group_std > 0) & df["sector_group"].notna(),
        (df["MScore"] - group_mean) / group_std,
        np.nan,
    )
    df["sector_flagged"] = df["sector_zscore"] > 1.5
    return df


def flagged_companies(mscore_df: pd.DataFrame) -> pd.DataFrame:
    """Latest fiscal year per ticker, filtered to flagged (mscore > threshold)."""
    latest = mscore_df.sort_values("fiscal_year").groupby("ticker").tail(1)
    return latest[latest["flagged"]].sort_values("MScore", ascending=False)


def validate_against_known_cases(mscore_df: pd.DataFrame) -> pd.DataFrame:
    """
    Cross-checks flagged tickers against KNOWN_FRAUD_CASES as a sanity
    check. Returns a small report DataFrame — empty if none of the known
    cases are present in the dataset (expected unless you've explicitly
    pulled their historical filings).
    """
    hits = mscore_df[mscore_df["ticker"].isin(KNOWN_FRAUD_CASES.keys())].copy()
    hits["known_case_note"] = hits["ticker"].map(KNOWN_FRAUD_CASES)
    return hits


if __name__ == "__main__":
    # Smoke-test with synthetic data
    demo = pd.DataFrame({
        "ticker": ["DEMO"] * 2,
        "fiscal_year": [2023, 2024],
        "revenue": [1000, 1300],
        "cogs": [600, 700],
        "receivables": [100, 180],
        "current_assets": [300, 340],
        "ppe_net": [400, 420],
        "total_assets": [1000, 1100],
        "depreciation": [50, 45],
        "sga_expense": [150, 210],
        "current_liabilities": [200, 260],
        "long_term_debt": [300, 340],
        "net_income": [120, 200],
        "cfo": [140, 90],
    })
    out = compute_mscore_components(demo)
    print(out)
