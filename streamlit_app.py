"""
streamlit_app.py
-----------------
Interactive Streamlit front-end for the Beneish M-Score Forensic Earnings
Screen. Wraps the existing data_collection / mscore_calculator /
visualization modules with a UI: type in tickers, hit Run, get the same
dashboard the notebook produces, live in the browser.

This file makes NO changes to the pipeline logic itself — it only calls
the already-tested functions from the three existing modules and renders
their output with Streamlit widgets instead of notebook cells.
"""

import matplotlib
matplotlib.use("Agg")  # headless backend — required before pyplot is imported anywhere

import streamlit as st
import pandas as pd

import data_collection
import mscore_calculator
import visualization

st.set_page_config(page_title="Beneish M-Score — Forensic Earnings Screen", layout="wide")

st.title("Beneish M-Score — Forensic Earnings Screen")
st.caption(
    "Pulls live SEC EDGAR 10-K data, computes the 8-ratio Beneish M-Score, "
    "and flags likely earnings manipulators against both the fixed academic "
    "threshold and a sector-relative z-score."
)

# ---------------------------------------------------------------------------
# Sidebar — inputs
# ---------------------------------------------------------------------------
with st.sidebar:
    st.header("Configuration")

    user_agent = st.text_input(
        "Your name + email (required by SEC)",
        placeholder="Jane Doe (jane.doe@example.com)",
        help="SEC EDGAR requires every request to identify a real contact. "
             "This is sent as the User-Agent header on each request; it is "
             "not stored anywhere by this app.",
    )

    tickers_input = st.text_input(
        "Tickers (comma-separated)",
        value="AAPL, MSFT, AMZN, NVDA, UAA",
        help="US tickers (AAPL, MSFT) pull from SEC EDGAR. For other exchanges, "
             "add the Yahoo Finance suffix: RELIANCE.NS / TCS.NS (NSE), "
             "BMW.DE (XETRA), 7203.T (TSE), 0700.HK (HKEX), BHP.AX (ASX), "
             "SHOP.TO (TSX), VOD.L (LSE). Non-US results use IFRS accounting "
             "and typically only ~4 years of history — see the Data Source "
             "column in the Summary Table before comparing them directly "
             "against US GAAP results.",
    )

    include_sector = st.checkbox("Include sector-relative flagging", value=True)

    run_clicked = st.button("Run Screen", type="primary", use_container_width=True)

    st.divider()
    st.caption(
        "Known historical fraud cases used as a validation sanity check: "
        + ", ".join(sorted(mscore_calculator.KNOWN_FRAUD_CASES.keys()))
    )


# ---------------------------------------------------------------------------
# Cached data pull — re-runs only when tickers/user_agent/include_sector change
# ---------------------------------------------------------------------------
@st.cache_data(show_spinner=False, ttl=3600)
def _run_pipeline(tickers: tuple, user_agent: str, include_sector: bool):
    data_collection.USER_AGENT = user_agent
    raw = data_collection.collect_dataset(list(tickers), include_sector=include_sector)
    scored = mscore_calculator.compute_mscore_components(raw)
    return raw, scored


# ---------------------------------------------------------------------------
# Main panel
# ---------------------------------------------------------------------------
if not run_clicked and "raw_financials" not in st.session_state:
    st.info("Enter your details in the sidebar and click **Run Screen** to start.")
    st.stop()

if run_clicked:
    tickers = tuple(t.strip().upper() for t in tickers_input.split(",") if t.strip())

    if not user_agent.strip() or "@" not in user_agent:
        st.error("SEC requires a real name and email in the User-Agent field before it will "
                 "accept requests. Please fill that in on the left.")
        st.stop()

    if not tickers:
        st.error("Enter at least one ticker.")
        st.stop()

    with st.spinner(f"Pulling SEC EDGAR data for {len(tickers)} ticker(s)... this can take a "
                     f"minute due to SEC's rate limit."):
        try:
            raw_financials, mscore_df = _run_pipeline(tickers, user_agent.strip(), include_sector)
        except RuntimeError as e:
            st.error(f"Pipeline error: {e}")
            st.stop()
        except Exception as e:
            st.error(f"Unexpected error while collecting or scoring data: {e}")
            st.stop()

    if raw_financials.empty:
        st.error("No data was collected for any of the requested tickers. Check the ticker "
                 "symbols and try again.")
        st.stop()

    st.session_state["raw_financials"] = raw_financials
    st.session_state["mscore_df"] = mscore_df

raw_financials = st.session_state["raw_financials"]
mscore_df = st.session_state["mscore_df"]

n_tickers = mscore_df["ticker"].nunique()
n_requested = raw_financials["ticker"].nunique()
st.success(f"Scored {n_tickers} of {n_requested} requested ticker(s) across "
           f"{mscore_df['fiscal_year'].nunique()} fiscal years.")

tab_dashboard, tab_summary, tab_data, tab_validation = st.tabs(
    ["Dashboard", "Summary Table", "Raw Data & Warnings", "Known Fraud Cases"]
)

# --- Dashboard tab ---------------------------------------------------------
with tab_dashboard:
    summary = visualization.summary_table(mscore_df)
    top_ticker = summary.iloc[0]["ticker"] if not summary.empty else None

    if top_ticker is not None:
        fig = visualization.plot_dashboard(mscore_df, top_ticker=top_ticker)
        st.pyplot(fig)
    else:
        st.warning("Not enough multi-year data to build the dashboard for any ticker.")

# --- Summary table tab ------------------------------------------------------
with tab_summary:
    st.subheader("Latest Fiscal Year — Summary")
    summary = visualization.summary_table(mscore_df)
    st.dataframe(summary, use_container_width=True)

    flagged = mscore_calculator.flagged_companies(mscore_df)
    st.subheader(f"Flagged on the Academic Threshold ({mscore_calculator.MANIPULATION_THRESHOLD})")
    if flagged.empty:
        st.write("No companies in this basket are flagged on the fixed academic threshold.")
    else:
        st.dataframe(flagged, use_container_width=True)
        if "data_source" in flagged.columns and (flagged["data_source"] == "yfinance").any():
            st.caption(
                "⚠️ One or more flagged companies were sourced via Yahoo Finance (IFRS, "
                "shorter history) rather than SEC EDGAR (US GAAP) — treat the flag as "
                "directional, not a precise apples-to-apples comparison. See the "
                "Data Source column."
            )

    if "sector_flagged" in mscore_df.columns:
        latest = mscore_df.sort_values("fiscal_year").groupby("ticker").tail(1)
        sector_flagged = latest[latest["sector_flagged"] == True]  # noqa: E712
        st.subheader("Sector-Relative Outliers")
        if sector_flagged.empty:
            st.write("No companies are sector-relative outliers in this basket.")
        else:
            st.dataframe(
                sector_flagged[["ticker", "fiscal_year", "MScore", "sector_group", "sector_zscore"]],
                use_container_width=True,
            )

# --- Raw data tab ------------------------------------------------------------
with tab_data:
    st.subheader("Full M-Score Component Table")
    st.dataframe(mscore_df, use_container_width=True)

    st.subheader("Data-Quality Warnings")
    data_issues = raw_financials[raw_financials["data_warnings"] != ""]
    st.write(f"{len(data_issues)} of {len(raw_financials)} ticker/fiscal-year rows flagged by validation.")
    if not data_issues.empty:
        st.dataframe(
            data_issues[["ticker", "fiscal_year", "data_warnings"]],
            use_container_width=True,
        )

    st.download_button(
        "Download full M-Score table as CSV",
        data=mscore_df.to_csv(index=False).encode("utf-8"),
        file_name="mscore_results.csv",
        mime="text/csv",
    )

# --- Known fraud case validation tab -----------------------------------------
with tab_validation:
    st.subheader("Cross-Check Against Known Historical Fraud Cases")
    validation = mscore_calculator.validate_against_known_cases(mscore_df)
    if validation.empty:
        st.write(
            "None of the tickers in this basket match a known historical fraud case "
            f"({', '.join(sorted(mscore_calculator.KNOWN_FRAUD_CASES.keys()))}). "
            "This is expected unless you've included one of those tickers."
        )
    else:
        st.dataframe(validation, use_container_width=True)
