/**
 * Utility functions for fetching and mapping financial statement data.
 * Supports official Alpha Vantage API keys from Vite env variables, 
 * with automatic fallback to keyless SEC EDGAR and Yahoo Finance endpoints.
 */
import { HISTORICAL_CASES } from '../data/historicalCases';
// Keyless queries are routed through local Vite proxy and Netlify redirects.

// Helper to convert values to float
const parseVal = (val) => {
  if (val === undefined || val === null || val === 'None' || val === 'null' || val === '-') return 0.0;
  if (typeof val === 'object' && val !== null) {
    return parseVal(val.reportedValue || val.val || 0);
  }
  const num = parseFloat(val);
  return isNaN(num) ? 0.0 : num;
};

// Resilient proxy fetch wrapper with public CORS fallback
async function safeFetch(proxyUrl, directUrl, options = {}) {
  try {
    const res = await fetch(proxyUrl, options);
    if (res.ok) return res;
    console.warn(`Proxy fetch for ${proxyUrl} failed with status ${res.status}. Falling back to public CORS proxy...`);
  } catch (err) {
    console.warn(`Proxy fetch for ${proxyUrl} threw connection error. Falling back to public CORS proxy...`, err);
  }

  // Fallback 1: corsproxy.io (high performance, small/medium files)
  const fallbackUrl = `https://corsproxy.io/?url=${encodeURIComponent(directUrl)}`;
  try {
    const fallbackRes = await fetch(fallbackUrl, options);
    if (fallbackRes.ok) return fallbackRes;
  } catch (err) {
    console.warn(`Fallback CORS proxy (corsproxy.io) failed for ${directUrl}. Trying AllOrigins...`, err);
  }

  // Fallback 2: api.allorigins.win (raw JSON pipe)
  const alloriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`;
  return await fetch(alloriginsUrl, options);
}

// Unified multi-provider ticker symbol mappings
export const SYMBOLS = {
  // Germany
  MBG: { tradingview: "XETRA:MBG", alphavantage: "MBG.DEX", yahoo: "MBG.DE" },
  SAP: { tradingview: "XETRA:SAP", alphavantage: "SAP.DEX", yahoo: "SAP.DE" },
  SIE: { tradingview: "XETRA:SIE", alphavantage: "SIE.DEX", yahoo: "SIE.DE" },
  VOW3: { tradingview: "XETRA:VOW3", alphavantage: "VOW3.DEX", yahoo: "VOW3.DE" },
  BMW: { tradingview: "XETRA:BMW", alphavantage: "BMW.DEX", yahoo: "BMW.DE" },

  // China
  BYD: { tradingview: "SZSE:002594", alphavantage: "002594.SHE", yahoo: "002594.SZ" },
  SAIC: { tradingview: "SSE:600104", alphavantage: "600104.SHH", yahoo: "600104.SS" },
  "600104": { tradingview: "SSE:600104", alphavantage: "600104.SHH", yahoo: "600104.SS" },
  "002594": { tradingview: "SZSE:002594", alphavantage: "002594.SHE", yahoo: "002594.SZ" },

  // India
  RELIANCE: { tradingview: "BSE:RELIANCE", alphavantage: "RELIANCE.BSE", yahoo: "RELIANCE.BO" },
  TCS: { tradingview: "BSE:TCS", alphavantage: "TCS.BSE", yahoo: "TCS.BO" },
  INFY: { tradingview: "BSE:INFY", alphavantage: "INFY.BSE", yahoo: "INFY.BO" },
  ITC: { tradingview: "BSE:ITC", alphavantage: "ITC.BSE", yahoo: "ITC.BO" },
  HDFCBANK: { tradingview: "BSE:HDFCBANK", alphavantage: "HDFCBANK.BSE", yahoo: "HDFCBANK.BO" },
  SBIN: { tradingview: "BSE:SBIN", alphavantage: "SBIN.BSE", yahoo: "SBIN.BO" },
  TATAMOTORS: { tradingview: "BSE:TATAMOTORS", alphavantage: "TATAMOTORS.BSE", yahoo: "TATAMOTORS.BO" },
  WIPRO: { tradingview: "BSE:WIPRO", alphavantage: "WIPRO.BSE", yahoo: "WIPRO.BO" },
  TMCV: { tradingview: "BSE:TMCV", alphavantage: "TMCV.BSE", yahoo: "TMCV.BO" }
};

// Helper to map ticker symbols to Alpha Vantage / Yahoo Finance formats
function getAlphaVantageTicker(baseTicker) {
  const upper = baseTicker.toUpperCase();
  return SYMBOLS[upper]?.alphavantage || baseTicker;
}

function getYahooFinanceTicker(baseTicker) {
  const upper = baseTicker.toUpperCase();
  return SYMBOLS[upper]?.yahoo || baseTicker;
}

// ---------------------------------------------------------------------------
// 1. Alpha Vantage Official API Parser
// ---------------------------------------------------------------------------
async function fetchAlphaVantageData(symbolInput, apiKey) {
  let ticker = getAlphaVantageTicker(symbolInput.trim().toUpperCase());

  // If input looks like a company name (e.g. "boeing"), resolve via SYMBOL_SEARCH first
  if (ticker.length > 5 && !ticker.includes(".")) {
    try {
      const searchUrl = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(symbolInput)}&apikey=${apiKey}`;
      const searchRes = await fetch(searchUrl).then(r => r.json());
      if (searchRes.bestMatches && searchRes.bestMatches[0]) {
        const matchedSymbol = searchRes.bestMatches[0]["1. symbol"];
        console.log(`Alpha Vantage resolved name "${symbolInput}" to ticker "${matchedSymbol}"`);
        ticker = matchedSymbol;
      }
    } catch (e) {
      console.warn("Alpha Vantage SYMBOL_SEARCH pre-resolution failed:", e);
    }
  }

  const baseUrl = "https://www.alphavantage.co/query";
  const getUrl = (fn) => `${baseUrl}?function=${fn}&symbol=${ticker}&apikey=${apiKey}`;

  // Fetch Income Statement, Balance Sheet, and Cash Flow sequentially with delay to prevent rate-limiting
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  const incRes = await fetch(getUrl("INCOME_STATEMENT")).then(r => r.json());
  await delay(1200);
  const balRes = await fetch(getUrl("BALANCE_SHEET")).then(r => r.json());
  await delay(1200);
  const cfRes = await fetch(getUrl("CASH_FLOW")).then(r => r.json());

  if (incRes.Information || balRes.Information || cfRes.Information) {
    throw new Error(incRes.Information || balRes.Information || cfRes.Information || "API status information block.");
  }
  if (incRes.Note || balRes.Note || cfRes.Note) {
    throw new Error("Alpha Vantage API rate limit exceeded (5 requests/min standard free tier). Please wait 1 minute.");
  }
  if (!incRes.annualReports || !balRes.annualReports || !cfRes.annualReports) {
    throw new Error(`Symbol "${ticker}" not found or has incomplete reports on Alpha Vantage. Ensure correct ticker suffix (e.g. RELIANCE.BOM for BSE).`);
  }

  const incomeMap = {};
  incRes.annualReports.forEach(r => { incomeMap[r.fiscalDateEnding] = r; });

  const balanceMap = {};
  balRes.annualReports.forEach(r => { balanceMap[r.fiscalDateEnding] = r; });

  const cashMap = {};
  cfRes.annualReports.forEach(r => { cashMap[r.fiscalDateEnding] = r; });

  const dates = Object.keys(balanceMap).sort().reverse();
  const mappedYears = {};

  dates.forEach(date => {
    const inc = incomeMap[date];
    const bal = balanceMap[date];
    const cf = cashMap[date];
    if (!inc || !bal || !cf) return;

    const year = new Date(date).getFullYear();
    mappedYears[year] = {
      fiscal_year: year,
      fiscal_date: date,
      revenue: parseVal(inc.totalRevenue || inc.operatingRevenue),
      cogs: parseVal(inc.costOfRevenue || inc.costofGoodsAndServicesSold),
      receivables: parseVal(bal.netReceivables || bal.currentNetReceivables),
      current_assets: parseVal(bal.totalCurrentAssets),
      ppe_net: parseVal(bal.propertyPlantEquipmentNet || bal.propertyPlantEquipment || bal.nonCurrentAssets),
      total_assets: parseVal(bal.totalAssets),
      depreciation: parseVal(cf.depreciationDepletionAndAmortization || cf.depreciation || inc.depreciationAndAmortization || inc.depreciation),
      sga_expense: parseVal(inc.sellingGeneralAndAdministrative || inc.researchAndDevelopment),
      current_liabilities: parseVal(bal.totalCurrentLiabilities),
      long_term_debt: parseVal(bal.longTermDebt || bal.longTermDebtNoncurrent || bal.totalNonCurrentLiabilities),
      net_income: parseVal(inc.netIncome),
      cfo: parseVal(cf.operatingCashflow || cf.netCashProvidedByOperatingActivities),
      gross_profit_reported: parseVal(inc.grossProfit)
    };
  });

  if (Object.keys(mappedYears).length < 2) {
    throw new Error("Alpha Vantage returned less than 2 years of statement history.");
  }

  return {
    ticker: ticker.toUpperCase(),
    name: incRes.symbol || ticker.toUpperCase(),
    sector: "Global Market (Alpha Vantage API)",
    sic: null,
    sic_description: null,
    years: mappedYears
  };
}

// ---------------------------------------------------------------------------
// 2. Keyless Fallback Scrapers (SEC EDGAR & Yahoo Finance)
// ---------------------------------------------------------------------------
const GAAP_TAGS = {
  revenue: [
    "Revenues",
    "SalesRevenueNet",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenue",
    "RevenueFromContractsWithCustomers"
  ],
  cogs: [
    "CostOfGoodsAndServicesSold",
    "CostOfRevenue",
    "CostOfGoodsSold",
    "CostOfSales"
  ],
  receivables: [
    "AccountsReceivableNetCurrent",
    "ReceivablesNetCurrent",
    "AccountsAndNotesReceivableNetCurrent",
    "AccountsReceivableNet",
    "TradeAndOtherCurrentReceivables",
    "TradeReceivables"
  ],
  current_assets: ["AssetsCurrent", "CurrentAssets"],
  ppe_net: [
    "PropertyPlantEquipmentNet",
    "PropertyPlantAndEquipmentNet",
    "PropertyPlantAndEquipmentGross",
    "PropertyPlantAndEquipment"
  ],
  total_assets: ["Assets"],
  depreciation: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
    "Depreciation",
    "DepreciationExpense",
    "DepreciationAndAmortizationExpense"
  ],
  sga_expense: [
    "SellingGeneralAndAdministrativeExpense",
    "GeneralAndAdministrativeExpense",
    "SellingGeneralAndAdministrativeExpenses",
    "AdministrativeExpense",
    "OtherExpenseByFunction"
  ],
  current_liabilities: ["LiabilitiesCurrent", "CurrentLiabilities"],
  long_term_debt: [
    "LongTermDebtNoncurrent",
    "LongTermDebt",
    "LongTermDebtAndCapitalLeaseObligations",
    "NoncurrentFinancialLiabilities",
    "NoncurrentLiabilities"
  ],
  net_income: ["NetIncomeLoss", "ProfitLoss", "ProfitLossFromContinuingOperations"],
  cfo: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByOperatingActivities",
    "CashProvidedByUsedInOperatingActivities",
    "CashFlowsFromUsedInOperatingActivities"
  ],
  gross_profit_reported: ["GrossProfit"]
};

const YF_TAGS = {
  revenue: "annualTotalRevenue",
  cogs: "annualCostOfRevenue",
  receivables: "annualReceivables",
  current_assets: "annualTotalCurrentAssets",
  ppe_net: "annualPropertyPlantEquipmentNet",
  total_assets: "annualTotalAssets",
  depreciation: "annualDepreciationAndAmortization",
  sga_expense: "annualSellingGeneralAndAdministrative",
  current_liabilities: "annualTotalCurrentLiabilities",
  long_term_debt: "annualLongTermDebt",
  net_income: "annualNetIncome",
  cfo: "annualOperatingCashFlow",
  gross_profit_reported: "annualGrossProfit"
};

async function resolveCik(tickerOrName) {
  const proxyUrl = "/api/sec-www/files/company_tickers.json";
  const directUrl = "https://www.sec.gov/files/company_tickers.json";

  const response = await safeFetch(proxyUrl, directUrl, {
    headers: { "User-Agent": "BeneishTerminal/1.0 (contact@beneish-screener.com)" }
  });
  if (!response.ok) throw new Error("Failed to fetch SEC ticker-to-CIK directory.");
  const data = await response.json();
  
  const searchUpper = tickerOrName.trim().toUpperCase();

  // 1. Corporate Rebrand / Alias Map (e.g., Brooks Automation -> Azenta AZTA)
  const ALIASES = {
    "BROOKS AUTOMATION": "AZTA",
    "BROOKS AUTOMATION INC": "AZTA",
    "BROOKS AUTOMATION, INC.": "AZTA",
    "BROOKS": "AZTA",
    "FACEBOOK": "META",
    "GOOGLE": "GOOGL",
    "ALPHABET": "GOOGL"
  };
  if (ALIASES[searchUpper]) {
    const aliasTicker = ALIASES[searchUpper];
    for (const key in data) {
      if (data[key].ticker.toUpperCase() === aliasTicker) {
        console.log(`Resolved corporate alias "${tickerOrName}" to SEC ticker "${aliasTicker}"`);
        return { cik: String(data[key].cik_str).padStart(10, '0'), ticker: aliasTicker, name: data[key].title };
      }
    }
  }

  // 2. Exact ticker match (e.g. BA, AAPL, TSLA, MSFT, AZTA)
  for (const key in data) {
    const row = data[key];
    if (row.ticker.toUpperCase() === searchUpper) {
      return { cik: String(row.cik_str).padStart(10, '0'), ticker: row.ticker, name: row.title };
    }
  }

  // 3. First-word or Substring Company Name Match (e.g. "BROOKS", "BOEING", "MICROSOFT")
  const firstWord = searchUpper.split(" ")[0];
  for (const key in data) {
    const row = data[key];
    const rowTitleUpper = row.title.toUpperCase();
    if (rowTitleUpper.includes(searchUpper) || (firstWord.length >= 4 && rowTitleUpper.includes(firstWord))) {
      console.log(`Resolved company name search "${tickerOrName}" to SEC ticker "${row.ticker}" (${row.title})`);
      return { cik: String(row.cik_str).padStart(10, '0'), ticker: row.ticker, name: row.title };
    }
  }

  throw new Error(`Ticker or company name "${searchUpper}" not found in SEC EDGAR directory.`);
}

async function fetchSecEdgarData(tickerInput) {
  const resolved = await resolveCik(tickerInput);
  const cik = resolved.cik;
  const actualTicker = resolved.ticker;
  const actualName = resolved.name;

  const proxyUrl = `/api/sec-data/api/xbrl/companyfacts/CIK${cik}.json`;
  const directUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

  const response = await safeFetch(proxyUrl, directUrl, {
    headers: { "User-Agent": "BeneishTerminal/1.0 (contact@beneish-screener.com)" }
  });
  if (!response.ok) throw new Error(`Failed to fetch SEC EDGAR facts for CIK ${cik}.`);
  const factsJson = await response.json();
  if (!factsJson) throw new Error("SEC returned empty company facts.");

  const taxonomy = factsJson.facts?.["us-gaap"] || factsJson.facts?.["ifrs-full"];
  if (!taxonomy) throw new Error(`No financial taxonomy (us-gaap or ifrs-full) found in SEC filing for ${actualTicker}.`);

  const extracted = {};
  
  Object.keys(GAAP_TAGS).forEach(concept => {
    extracted[concept] = {};
    const tags = GAAP_TAGS[concept];
    
    for (const tag of tags) {
      if (!taxonomy[tag]) continue;
      
      const units = taxonomy[tag].units;
      const currencyKey = Object.keys(units || {}).find(k => k.match(/USD|EUR|GBP|CAD|INR/i)) || Object.keys(units || {})[0];
      const facts = units?.[currencyKey] || [];
      
      facts.forEach(f => {
        if (f.form !== "10-K" && f.form !== "10-K/A" && f.form !== "20-F" && f.form !== "20-F/A") return;
        if (f.fp !== "FY" && f.fp !== "CY") return;
        
        const year = parseInt(f.fy);
        if (isNaN(year)) return;

        const existing = extracted[concept][year];
        const currentFiled = new Date(f.filed);
        const existingFiled = existing ? new Date(existing.filed) : null;
        
        if (!existing || currentFiled > existingFiled || (currentFiled === existingFiled && f.form === "10-K/A")) {
          extracted[concept][year] = {
            val: parseVal(f.val),
            filed: f.filed,
            form: f.form
          };
        }
      });
    }
  });

  const years = {};
  Object.keys(extracted).forEach(concept => {
    Object.keys(extracted[concept]).forEach(year => {
      if (!years[year]) years[year] = { fiscal_year: parseInt(year) };
      years[year][concept] = extracted[concept][year].val;
    });
  });

  const filteredYears = {};
  Object.keys(years).forEach(y => {
    const data = years[y];
    if (data.revenue && data.total_assets) {
      filteredYears[y] = {
        ...data,
        gross_profit_reported: data.gross_profit_reported || (data.revenue - (data.cogs || 0))
      };
    }
  });

  if (Object.keys(filteredYears).length < 2) {
    throw new Error("SEC EDGAR returned less than 2 years of complete annual statements.");
  }

  return {
    ticker: actualTicker.toUpperCase(),
    name: factsJson.entityName || actualName || actualTicker.toUpperCase(),
    sector: factsJson.sicDescription || "US Equities (SEC EDGAR)",
    sic: factsJson.sic || null,
    sic_description: factsJson.sicDescription || null,
    years: filteredYears
  };
}

async function fetchYahooFinanceData(ticker) {
  const cleanTicker = getYahooFinanceTicker(ticker.trim().toUpperCase());
  const types = Object.values(YF_TAGS).join(",");
  const proxyUrl = `/api/yahoo/v1/finance/fundamentalsTimeSeries/${cleanTicker}?period1=0&period2=9999999999&type=${types}`;
  const directUrl = `https://query2.finance.yahoo.com/v1/finance/fundamentalsTimeSeries/${cleanTicker}?period1=0&period2=9999999999&type=${types}`;

  const response = await safeFetch(proxyUrl, directUrl);
  if (!response.ok) throw new Error(`Failed to query Yahoo Finance for "${ticker}".`);
  const data = await response.json();

  const results = data.fundamentalsTimeSeries?.result;
  if (!results || results.length === 0) {
    throw new Error(`Yahoo Finance fundamentals not found for "${ticker}".`);
  }

  const years = {};

  results.forEach(result => {
    const type = result.meta?.type;
    const concept = Object.keys(YF_TAGS).find(k => YF_TAGS[k] === type);
    if (!concept) return;

    const series = result[type] || [];
    series.forEach(item => {
      const dateStr = item.asOfDate;
      if (!dateStr) return;
      const year = new Date(dateStr).getFullYear();
      
      if (!years[year]) {
        years[year] = { 
          fiscal_year: year,
          fiscal_date: dateStr
        };
      }
      years[year][concept] = parseVal(item.reportedValue);
    });
  });

  const filteredYears = {};
  Object.keys(years).forEach(y => {
    const data = years[y];
    if (data.revenue && data.total_assets) {
      filteredYears[y] = {
        ...data,
        gross_profit_reported: data.gross_profit_reported || (data.revenue - (data.cogs || 0))
      };
    }
  });

  if (Object.keys(filteredYears).length < 2) {
    throw new Error("Yahoo Finance fundamentals returned less than 2 years of statement history.");
  }

  return {
    ticker: ticker.toUpperCase(),
    name: ticker.toUpperCase(),
    sector: "International Equities (Yahoo Finance)",
    sic: null,
    sic_description: null,
    years: filteredYears
  };
}

// ---------------------------------------------------------------------------
// 3. Orchestrated Entry Point
// ---------------------------------------------------------------------------
export async function fetchCompanyData(ticker, bypassCache = false) {
  const cleanTicker = ticker.trim().toUpperCase();
  if (!cleanTicker) throw new Error("Ticker symbol cannot be empty.");

  // 1. Check local preloaded historical cases first (Instant, Offline, 0ms)
  const baseSymbol = cleanTicker.split(".")[0];
  const TICKER_ALIASES = {
    "MBGAF": "MBG",
    "MBG.DEX": "MBG",
    "SIEGY": "SIE",
    "SIE.DEX": "SIE",
    "VWAGY": "VOW3",
    "VOW3.DEX": "VOW3",
    "BMWYY": "BMW",
    "BMW.DEX": "BMW",
    "BYDDY": "BYD",
    "002594.SHZ": "BYD",
    "002594": "BYD",
    "600104.SHH": "SAIC",
    "600104": "SAIC",
    "SAIC.SHH": "SAIC",
    "TSCDY": "TSCO",
    "TSCO.LON": "TSCO",
    "RELIANCE.BSE": "RELIANCE",
    "RELIANCE.NS": "RELIANCE",
    "TCS.NS": "TCS",
    "INFY.NS": "INFY",
    "ITC.NS": "ITC",
    "TATAMOTORS.NS": "TATAMOTORS",
    "WIPRO.NS": "WIPRO"
  };

  const resolvedKey = TICKER_ALIASES[cleanTicker] || TICKER_ALIASES[baseSymbol] || baseSymbol;
  
  // SEC-registered tickers that should pull full multi-year histories from EDGAR instead of the 2-year sandbox cache
  const isSecEquity = ["AAPL", "MSFT", "SHOP", "RY", "ENB", "SHEL", "AZN", "BP", "HSBC", "UL"].includes(resolvedKey);
  const shouldCheckCache = !bypassCache || !isSecEquity;

  if (shouldCheckCache) {
    const matchedCase = HISTORICAL_CASES[resolvedKey] || HISTORICAL_CASES[cleanTicker] || HISTORICAL_CASES[baseSymbol];
    if (matchedCase) {
      console.log("Loading preloaded data from local cache for symbol:", resolvedKey);
      return JSON.parse(JSON.stringify(matchedCase));
    }
  }

  // 2. Query keyless SEC EDGAR FIRST (100% Anonymous, Free, Zero Rate Limits for US & International SEC Filers!)
  try {
    console.log("Executing keyless anonymous SEC EDGAR query for:", baseSymbol);
    return await fetchSecEdgarData(baseSymbol);
  } catch (secErr) {
    console.warn("SEC EDGAR keyless lookup did not find data. Checking Alpha Vantage API...", secErr);
  }

  // 3. Secondary check: Alpha Vantage API Key (if provided)
  const avApiKey = import.meta.env.VITE_ALPHAVANTAGE_API_KEY;
  const isDummy = !avApiKey || 
                  avApiKey === "your_alpha_vantage_api_key_here" || 
                  avApiKey === "YOUR_FREE_KEY_HERE" || 
                  avApiKey.trim() === "";

  if (!isDummy) {
    console.log("Using official Alpha Vantage API Feed for ticker:", cleanTicker);
    try {
      return await fetchAlphaVantageData(cleanTicker, avApiKey);
    } catch (err) {
      console.warn("Official Alpha Vantage query failed. Falling back to Yahoo Finance...", err);
    }
  }

  // 4. Final Fallback: Yahoo Finance
  return await fetchYahooFinanceData(cleanTicker);
}

// ---------------------------------------------------------------------------
// 4. Live Symbol Auto-Complete Suggestions (Alpha Vantage SYMBOL_SEARCH)
// ---------------------------------------------------------------------------
export async function searchSymbolSuggestions(keyword) {
  if (!keyword || keyword.trim().length < 2) return [];
  const cleanKeyword = keyword.trim().toLowerCase();

  const avApiKey = import.meta.env.VITE_ALPHAVANTAGE_API_KEY;
  const isDummy = !avApiKey || 
                  avApiKey === "your_alpha_vantage_api_key_here" || 
                  avApiKey === "YOUR_FREE_KEY_HERE" || 
                  avApiKey.trim() === "";

  let results = [];

  if (!isDummy) {
    try {
      const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(cleanKeyword)}&apikey=${avApiKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.bestMatches && Array.isArray(data.bestMatches)) {
          results = data.bestMatches.slice(0, 6).map(m => ({
            symbol: m["1. symbol"],
            name: m["2. name"],
            region: m["4. region"] || "Global"
          }));
        }
      }
    } catch (e) {
      console.warn("Alpha Vantage SYMBOL_SEARCH failed:", e);
    }
  }

  // Fallback / complement with local indexed blue-chips
  if (results.length === 0) {
    const { GLOBAL_BLUECHIPS } = await import('../data/globalCompanies');
    results = GLOBAL_BLUECHIPS.filter(c => 
      c.name.toLowerCase().includes(cleanKeyword) || 
      c.ticker.toLowerCase().includes(cleanKeyword)
    ).slice(0, 6).map(c => ({
      symbol: c.ticker,
      name: c.name,
      region: "United States"
    }));
  }

  return results;
}
