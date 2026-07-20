/**
 * Computes the 8 Beneish M-Score components and the composite M-Score.
 * 
 * Formula:
 * M-Score = -4.84 + 0.920*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI + 0.115*DEPI - 0.172*SGAI + 4.679*TATA - 0.327*LVGI
 */

export const MANIPULATION_THRESHOLD = -1.78;

export const MSCORE_WEIGHTS = {
  DSRI: 0.920,
  GMI: 0.528,
  AQI: 0.404,
  SGI: 0.892,
  DEPI: 0.115,
  SGAI: -0.172,
  TATA: 4.679,
  LVGI: -0.327,
};

export const MSCORE_INTERCEPT = -4.84;

export const RATIO_DESCRIPTIONS = {
  DSRI: {
    name: "Days Sales in Receivables Index",
    desc: "Measures the ratio of days sales in receivables in Year t to Year t-1. A high DSRI (greater than 1) indicates receivables are growing disproportionately faster than sales, which could point to channel stuffing or aggressive revenue recognition.",
  },
  GMI: {
    name: "Gross Margin Index",
    desc: "Ratio of gross margin in Year t-1 to Year t. A GMI greater than 1 means gross margins are deteriorating, which signals weakening competitive position and creates an incentive to manipulate earnings.",
  },
  AQI: {
    name: "Asset Quality Index",
    desc: "Ratio of non-current assets (other than Property, Plant & Equipment) to total assets in Year t vs Year t-1. A high AQI shows capitalization of expenses or shift of assets into soft, less tangible accounts.",
  },
  SGI: {
    name: "Sales Growth Index",
    desc: "Ratio of revenue in Year t to Year t-1. High growth companies are highly valued by the market but are also susceptible to manipulation when growth decelerates.",
  },
  DEPI: {
    name: "Depreciation Index",
    desc: "Ratio of depreciation rate in Year t-1 to Year t. A DEPI greater than 1 indicates the depreciation rate has slowed down, which could mean the company has extended the useful life of assets to boost current earnings.",
  },
  SGAI: {
    name: "Sales, General & Administrative Expenses Index",
    desc: "Ratio of SGA expenses as a % of sales in Year t vs t-1. An increase (SGAI > 1) can indicate declining administrative efficiency or rising overhead costs.",
  },
  TATA: {
    name: "Total Accruals to Total Assets",
    desc: "Measures net income minus operating cash flow, scaled by total assets. High accruals (positive/high values) indicate earnings are driven by accounting adjustments rather than cash transactions.",
  },
  LVGI: {
    name: "Leverage Index",
    desc: "Ratio of total debt to total assets in Year t vs t-1. A leverage index greater than 1 indicates increasing leverage, which raises debt covenant risks and incentives to manipulate.",
  }
};

/**
 * Calculates the individual metrics and composite score for a company's data.
 * @param {Object} current - Current year financials (Year t)
 * @param {Object} prior - Prior year financials (Year t-1)
 * @returns {Object} Calculated M-Score data and warnings
 */
/**
 * Calculates the individual metrics and composite score for a company's data.
 * @param {Object} current - Current year financials (Year t)
 * @param {Object} prior - Prior year financials (Year t-1)
 * @param {String} modelVariant - 'MODEL_8VAR' | 'MODEL_5VAR' | 'MODEL_IFRS'
 * @returns {Object} Calculated M-Score data and warnings
 */
export function calculateMScore(current, prior, modelVariant = "MODEL_8VAR") {
  // Safe division helper
  const safeDiv = (num, den, name = "") => {
    if (!den || den === 0) return 1.0; // standard fallback
    const res = num / den;
    return isFinite(res) ? res : 1.0;
  };

  // 1. Derived values for Current Year (t)
  const currentGrossProfit = current.revenue - current.cogs;
  const currentGrossMargin = safeDiv(currentGrossProfit, current.revenue);
  const currentAssetQuality = 1 - safeDiv((current.current_assets + current.ppe_net), current.total_assets);
  const currentDepRate = safeDiv(current.depreciation, (current.depreciation + current.ppe_net));
  const currentLeverage = safeDiv((current.current_liabilities + current.long_term_debt), current.total_assets);
  const currentSgaPct = safeDiv(current.sga_expense, current.revenue);
  const currentReceivablesPct = safeDiv(current.receivables, current.revenue);

  // 2. Derived values for Prior Year (t-1)
  const priorGrossProfit = prior.revenue - prior.cogs;
  const priorGrossMargin = safeDiv(priorGrossProfit, prior.revenue);
  const priorAssetQuality = 1 - safeDiv((prior.current_assets + prior.ppe_net), prior.total_assets);
  const priorDepRate = safeDiv(prior.depreciation, (prior.depreciation + prior.ppe_net));
  const priorLeverage = safeDiv((prior.current_liabilities + prior.long_term_debt), prior.total_assets);
  const priorSgaPct = safeDiv(prior.sga_expense, prior.revenue);
  const priorReceivablesPct = safeDiv(prior.receivables, prior.revenue);

  // 3. Compute the 8 Ratios
  const dsri = safeDiv(currentReceivablesPct, priorReceivablesPct);
  const gmi = safeDiv(priorGrossMargin, currentGrossMargin);
  const aqi = safeDiv(currentAssetQuality, priorAssetQuality);
  const sgi = safeDiv(current.revenue, prior.revenue);
  const depi = safeDiv(priorDepRate, currentDepRate);
  const sgai = safeDiv(currentSgaPct, priorSgaPct);
  const lvgi = safeDiv(currentLeverage, priorLeverage);
  const tata = safeDiv((current.net_income - current.cfo), current.total_assets);

  // 4. Calculate final M-Score based on selected model variant
  let mscore = -4.84;
  let threshold = MANIPULATION_THRESHOLD;

  if (modelVariant === "MODEL_5VAR") {
    // Beneish (1999) 5-Variable Compact Model for International / Missing Data
    mscore = -6.065 + (0.823 * dsri) + (0.906 * gmi) + (0.593 * aqi) + (0.717 * sgi) + (0.107 * depi);
    threshold = -2.22;
  } else if (modelVariant === "MODEL_IFRS") {
    // IFRS International Adjusted Model (Normalizes AQI & LVGI for IFRS 16 lease & intangible rules)
    const adjAqi = Math.min(aqi, 1.25);
    const adjLvgi = Math.min(lvgi, 1.30);
    mscore = 
      MSCORE_INTERCEPT +
      (MSCORE_WEIGHTS.DSRI * dsri) +
      (MSCORE_WEIGHTS.GMI * gmi) +
      (MSCORE_WEIGHTS.AQI * adjAqi) +
      (MSCORE_WEIGHTS.SGI * sgi) +
      (MSCORE_WEIGHTS.DEPI * depi) +
      (MSCORE_WEIGHTS.SGAI * sgai) +
      (MSCORE_WEIGHTS.TATA * tata) +
      (MSCORE_WEIGHTS.LVGI * adjLvgi);
    threshold = -1.78;
  } else {
    // Standard 8-Variable Model
    mscore = 
      MSCORE_INTERCEPT +
      (MSCORE_WEIGHTS.DSRI * dsri) +
      (MSCORE_WEIGHTS.GMI * gmi) +
      (MSCORE_WEIGHTS.AQI * aqi) +
      (MSCORE_WEIGHTS.SGI * sgi) +
      (MSCORE_WEIGHTS.DEPI * depi) +
      (MSCORE_WEIGHTS.SGAI * sgai) +
      (MSCORE_WEIGHTS.TATA * tata) +
      (MSCORE_WEIGHTS.LVGI * lvgi);
    threshold = -1.78;
  }

  // 5. Accounting identity warnings
  const warnings = [];
  if (current.current_assets + current.ppe_net > current.total_assets) {
    warnings.push("Asset Validation: Current Assets + Net PPE exceeds Total Assets.");
  }
  const diffGP = Math.abs(currentGrossProfit - current.gross_profit_reported);
  if (current.gross_profit_reported && diffGP / current.revenue > 0.05) {
    warnings.push(`Gross Profit Discrepancy: Computed Gross Profit differs from reported by ${((diffGP / current.revenue) * 100).toFixed(1)}% of Revenue.`);
  }

  return {
    mscore: Number(mscore.toFixed(3)),
    threshold,
    flagged: mscore > threshold,
    ratios: {
      DSRI: Number(dsri.toFixed(3)),
      GMI: Number(gmi.toFixed(3)),
      AQI: Number(aqi.toFixed(3)),
      SGI: Number(sgi.toFixed(3)),
      DEPI: Number(depi.toFixed(3)),
      SGAI: Number(sgai.toFixed(3)),
      TATA: Number(tata.toFixed(3)),
      LVGI: Number(lvgi.toFixed(3)),
    },
    warnings,
  };
}

/**
 * Computes sector z-scores for a group of calculated scores.
 * @param {Array<Object>} resultsList - List of objects with { MScore, sector }
 * @returns {Array<Object>} Updated list with sector_zscore and sector_flagged
 */
export function computeSectorZScores(resultsList) {
  const sectors = {};
  
  // Group by sector
  resultsList.forEach(item => {
    if (!item.sector) return;
    if (!sectors[item.sector]) {
      sectors[item.sector] = [];
    }
    sectors[item.sector].push(item.mscore);
  });

  const sectorStats = {};
  Object.keys(sectors).forEach(sector => {
    const scores = sectors[sector];
    const n = scores.length;
    if (n < 2) return; // Need at least 2 members for standard deviation
    const mean = scores.reduce((a, b) => a + b, 0) / n;
    const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
    const std = Math.sqrt(variance);
    sectorStats[sector] = { mean, std };
  });

  return resultsList.map(item => {
    const stats = sectorStats[item.sector];
    if (stats && stats.std > 0) {
      const zscore = (item.mscore - stats.mean) / stats.std;
      return {
        ...item,
        sector_zscore: Number(zscore.toFixed(3)),
        sector_flagged: zscore > 1.5,
      };
    }
    return {
      ...item,
      sector_zscore: null,
      sector_flagged: false,
    };
  });
}
