import React, { useState, useEffect } from 'react';
import { calculateMScore, RATIO_DESCRIPTIONS } from './components/MScoreCalculator';
import { HISTORICAL_CASES } from './data/historicalCases';
import TradingViewChart from './components/TradingViewChart';
import { RadarChart, MScoreTrendChart, AccrualsChart, ProbabilityMeter } from './components/MScoreCharts';
import { fetchCompanyData, searchSymbolSuggestions } from './utils/api';
import { GLOBAL_BLUECHIPS } from './data/globalCompanies';
import { 
  Search, 
  AlertTriangle, 
  AlertCircle, 
  Sliders, 
  HelpCircle,
  Layers,
  LineChart,
  Grid,
  BookOpen
} from 'lucide-react';

export default function App() {
  // Navigation Tabs state
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'ratios', 'spreadsheet'
  
  // Data selection state
  const [isSandbox, setIsSandbox] = useState(true);
  const [selectedCaseKey, setSelectedCaseKey] = useState("ENRN");
  const [modelVariant, setModelVariant] = useState("MODEL_8VAR");
  const [searchTicker, setSearchTicker] = useState('');
  const [pendingTicker, setPendingTicker] = useState('');  // staged live-search, not yet executed
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Live Auto-Complete Suggestions State
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);
  
  // Current evaluated company and year
  const [companyData, setCompanyData] = useState(HISTORICAL_CASES.ENRN);
  const [selectedYear, setSelectedYear] = useState(2001);
  
  // Interactive spreadsheet override state
  const [manualFinancials, setManualFinancials] = useState(null);

  // Live ticker auto-complete suggestions (Alpha Vantage SYMBOL_SEARCH)
  useEffect(() => {
    if (!searchTicker || searchTicker.trim().length < 2) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingSuggestions(true);
      try {
        const suggestions = await searchSymbolSuggestions(searchTicker);
        setSearchSuggestions(suggestions);
        setShowSuggestions(suggestions.length > 0);
      } catch (err) {
        console.warn(err);
      } finally {
        setIsSearchingSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTicker]);

  // Sync state when operational mode or sandbox selection changes
  useEffect(() => {
    if (isSandbox) {
      const data = HISTORICAL_CASES[selectedCaseKey];
      if (data) {
        setCompanyData(data);
        setError(null);
        const years = Object.keys(data.years).map(Number).sort((a, b) => b - a);
        setSelectedYear(years[0] || 2023);
      }
    }
  }, [isSandbox, selectedCaseKey]);

  // Sync manual input financials when company or year changes
  useEffect(() => {
    if (companyData && companyData.years) {
      const current = companyData.years[selectedYear];
      const prior = companyData.years[selectedYear - 1];
      if (current && prior) {
        setManualFinancials({
          current: { ...current },
          prior: { ...prior }
        });
      } else {
        setManualFinancials(null);
      }
    }
  }, [companyData, selectedYear]);

  // Helper to run live ticker search
  const performDirectSearch = async (ticker) => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCompanyData(ticker, true);
      setCompanyData(data);
      setIsSandbox(false);
      
      const years = Object.keys(data.years).map(Number).sort((a, b) => b - a);
      if (years.length < 2) {
        throw new Error("Ingested statements have less than 2 years of history. Cannot calculate index pairs.");
      }
      setSelectedYear(years[0]);
    } catch (err) {
      console.warn("API fetch failed. Initializing manual input fallback for symbol:", ticker, err);
      
      // Create a default blank template with sanitized ticker symbol
      let sanitizedSymbol = ticker.trim().toUpperCase();
      if (sanitizedSymbol.length > 6 && !sanitizedSymbol.includes(".")) {
        sanitizedSymbol = sanitizedSymbol.split(" ")[0];
      }

      const currentYear = 2023;
      const defaultData = {
        ticker: sanitizedSymbol,
        name: ticker.toUpperCase(),
        sector: ticker.includes(".") ? "International Equities (Manual Entry)" : "US Equities (Manual Entry)",
        notes: `Financial statement auto-ingestion failed for ${ticker.toUpperCase()}. Use the 'Simulation Sheet' tab to enter numbers manually.`,
        years: {
          [currentYear]: {
            fiscal_year: currentYear,
            revenue: 0, cogs: 0, receivables: 0, current_assets: 0, ppe_net: 0, total_assets: 0,
            depreciation: 0, sga_expense: 0, current_liabilities: 0, long_term_debt: 0, net_income: 0, cfo: 0,
            gross_profit_reported: 0
          },
          [currentYear - 1]: {
            fiscal_year: currentYear - 1,
            revenue: 0, cogs: 0, receivables: 0, current_assets: 0, ppe_net: 0, total_assets: 0,
            depreciation: 0, sga_expense: 0, current_liabilities: 0, long_term_debt: 0, net_income: 0, cfo: 0,
            gross_profit_reported: 0
          }
        }
      };
      
      setCompanyData(defaultData);
      setSelectedYear(currentYear);
      setIsSandbox(false);
      
      let errMsg = `Notice: Statement auto-ingestion for "${ticker.toUpperCase()}" did not complete automatically. `;
      if (err.message && err.message.includes("25 requests per day")) {
        errMsg += "Your Alpha Vantage free API key reached its daily quota limit (25 requests/24 hrs). Queries are automatically falling back to SEC EDGAR (keyless free feed).";
      } else {
        errMsg += "You can manually enter figures on the 'Simulation Sheet' tab, or view the live TradingView price chart on the right!";
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // Live keyless search submission
  const handleSearch = async (e) => {
    e.preventDefault();
    performDirectSearch(searchTicker);
  };

  // Handle cell overrides
  const handleFieldChange = (period, field, val) => {
    const numericVal = val === '' ? 0 : parseFloat(val);
    setManualFinancials(prev => ({
      ...prev,
      [period]: {
        ...prev[period],
        [field]: isNaN(numericVal) ? 0 : numericVal
      }
    }));
  };

  // Perform Calculations
  let mscoreData = null;
  if (manualFinancials) {
    try {
      mscoreData = calculateMScore(manualFinancials.current, manualFinancials.prior, modelVariant);
    } catch (e) {
      console.error("Calculation failed", e);
    }
  }

  // Get available years list
  const availableYears = companyData && companyData.years
    ? Object.keys(companyData.years).map(Number).sort((a, b) => b - a).filter(y => companyData.years[y - 1] !== undefined)
    : [];

  // Compute M-Scores for all historical years to display in the trend chart
  const historyMapping = {};
  if (companyData && companyData.years) {
    Object.keys(companyData.years).map(Number).sort((a, b) => a - b).forEach(yr => {
      const current = companyData.years[yr];
      const prior = companyData.years[yr - 1];
      if (current && prior) {
        try {
          const calc = calculateMScore(current, prior, modelVariant);
          historyMapping[yr] = {
            mscore: calc.mscore,
            net_income: current.net_income,
            cfo: current.cfo
          };
        } catch (e) {}
      }
    });
  }

  return (
    <div className="app-container animate-fade-up">
      <div className="bg-grid"></div>

      {/* Header Banner */}
      <header style={{
        borderBottom: '1px solid var(--rule)',
        paddingBottom: '20px',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '20px'
      }}>
        <div>
          <div className="eyebrow">Forensic Accounting Terminal</div>
          <h1 style={{ fontSize: '32px', lineHeight: '1.1', fontWeight: '700' }}>
            Beneish M-Score <span style={{ color: '#c9a54a' }}>Screener</span>
          </h1>
        </div>

        {/* Tab Selection */}
        <div style={{
          display: 'flex',
          background: 'var(--ink-2)',
          border: '1px solid var(--rule)',
          borderRadius: '4px',
          padding: '2px'
        }}>
          {[
            { id: 'dashboard', label: 'Dashboard', icon: LineChart },
            { id: 'ratios', label: 'Ratio Index File', icon: BookOpen },
            { id: 'spreadsheet', label: 'Simulation Sheet', icon: Grid }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: active ? 'var(--paper)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--slate)',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.25s ease'
                }}
              >
                <Icon size={14} /> {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Layout Grid */}
      <div className="dashboard-grid">
        
        {/* Left Control Sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Controls */}
          <div style={{
            border: '1px solid var(--rule)',
            background: '#181d16',
            borderRadius: '3px',
            padding: '24px'
          }}>
            <h3 style={{
              fontFamily: 'Source Serif 4, serif',
              fontSize: '18px',
              color: '#ece4d1',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <Sliders size={16} color="#c9a54a" /> Data Feed
            </h3>

            {/* Ingestion Mode selection toggle */}
            <div style={{ display: 'flex', gap: '1px', background: 'rgba(236,228,209,0.14)', padding: '2px', borderRadius: '4px', marginBottom: '20px' }}>
              <button
                onClick={() => setIsSandbox(true)}
                style={{
                  flex: 1,
                  background: isSandbox ? 'var(--paper)' : 'transparent',
                  color: isSandbox ? 'var(--ink)' : 'var(--slate)',
                  border: 'none',
                  padding: '6px 8px',
                  fontSize: '11px',
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontWeight: '600',
                  cursor: 'pointer',
                  borderRadius: '3px'
                }}
              >
                Sandbox
              </button>
              <button
                onClick={() => setIsSandbox(false)}
                style={{
                  flex: 1,
                  background: !isSandbox ? 'var(--paper)' : 'transparent',
                  color: !isSandbox ? 'var(--ink)' : 'var(--slate)',
                  border: 'none',
                  padding: '6px 8px',
                  fontSize: '11px',
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontWeight: '600',
                  cursor: 'pointer',
                  borderRadius: '3px'
                }}
              >
                Live Search
              </button>
            </div>

            {isSandbox ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8d9284' }}>
                  Sandbox Case File
                </label>
                <select
                  value={selectedCaseKey}
                  onChange={(e) => setSelectedCaseKey(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="ENRN">Enron Corp. (2001 Fraud)</option>
                  <option value="WCOM">WorldCom, Inc. (2002 Fraud)</option>
                  <option value="UAA">Under Armour, Inc. (2016 Flagged)</option>
                  <option value="AAPL">Apple Inc. (Clean Benchmark)</option>
                  <option value="MSFT">Microsoft Corp. (Clean Benchmark)</option>
                  <option value="RELIANCE">Reliance Industries (NSE Clean)</option>
                  <option value="TCS">TCS (NSE Clean)</option>
                  <option value="INFY">Infosys Ltd. (NSE Clean)</option>
                  <option value="ITC">ITC Limited (NSE Clean)</option>
                  <option value="WIPRO">Wipro Limited (NSE Clean)</option>
                  <option value="TATAMOTORS">Tata Motors Ltd. (NSE Clean)</option>
                </select>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8d9284' }}>
                  Select Global Stock (US, UK, China, Germany, Canada, India)
                </label>
                <select
                  value={pendingTicker}
                  onChange={(e) => {
                    setPendingTicker(e.target.value);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">Choose Global Company...</option>
                  {GLOBAL_BLUECHIPS.map(c => (
                    <option key={c.ticker} value={c.ticker}>[{c.exchange}] {c.name} ({c.ticker})</option>
                  ))}
                </select>
                <div style={{ fontSize: '11px', color: '#8d9284', lineHeight: '1.4' }}>
                  Select any global equity to fetch live financial statements or technical price charts across major world exchanges.
                </div>

                {/* Run Analysis CTA */}
                <button
                  id="run-analysis-btn"
                  disabled={!pendingTicker || loading}
                  onClick={() => {
                    if (pendingTicker) {
                      setSearchTicker(pendingTicker);
                      performDirectSearch(pendingTicker);
                    }
                  }}
                  style={{
                    marginTop: '4px',
                    padding: '11px 16px',
                    background: pendingTicker && !loading
                      ? 'linear-gradient(135deg, #c9a54a 0%, #e8c76a 100%)'
                      : 'rgba(255,255,255,0.06)',
                    color: pendingTicker && !loading ? '#0f1410' : '#4a5247',
                    border: 'none',
                    borderRadius: '4px',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '12px',
                    fontWeight: '700',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: pendingTicker && !loading ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    width: '100%'
                  }}
                >
                  {loading
                    ? <><span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #4a5247', borderTopColor: '#8d9284', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Fetching Data…
                    </>
                    : <><span>▶</span> Run Analysis</>
                  }
                </button>
              </div>
            )}

            {/* Year Selector */}
            {availableYears.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--rule)' }}>
                <label style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8d9284' }}>
                  Evaluation Year (t)
                </label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  style={{ cursor: 'pointer' }}
                >
                  {availableYears.map(year => (
                    <option key={year} value={year}>
                      {year} (vs {year - 1})
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '11px', color: '#8d9284' }}>
                  Analysis Year: <b>{selectedYear}</b> compared to <b>{selectedYear - 1}</b>.
                </span>
              </div>
            )}

            {/* Formula Model Variant Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--rule)' }}>
              <label style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8d9284' }}>
                Formula Model Variant
              </label>
              <select
                value={modelVariant}
                onChange={(e) => setModelVariant(e.target.value)}
                style={{ cursor: 'pointer' }}
              >
                <option value="MODEL_8VAR">Standard 8-Variable Model (US GAAP)</option>
                <option value="MODEL_5VAR">5-Variable Compact Model (Beneish 1999)</option>
                <option value="MODEL_IFRS">IFRS International Model (EU/Asia/India)</option>
              </select>
              <span style={{ fontSize: '10px', color: '#8d9284', lineHeight: '1.3' }}>
                {modelVariant === 'MODEL_5VAR' && 'Beneish 5-Variable Model with -2.22 cutoff threshold.'}
                {modelVariant === 'MODEL_IFRS' && 'Adjusted for IFRS 16 Leases & Intangible R&D rules.'}
                {modelVariant === 'MODEL_8VAR' && 'Standard Beneish 8-Variable Model with -1.78 cutoff threshold.'}
              </span>
            </div>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="main-content-grid">
          
          {/* Loading Indicator */}
          {loading && (
            <div style={{
              border: '1px solid rgba(201,165,74,0.3)',
              background: 'rgba(201,165,74,0.06)',
              padding: '16px 20px',
              borderRadius: '3px',
              fontSize: '14px',
              color: '#c9a54a',
              fontFamily: 'IBM Plex Mono, monospace',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <div className="animate-pulse" style={{ width: '8px', height: '8px', background: '#c9a54a', borderRadius: '50%' }}></div>
              Connecting to live keyless data feeds. Querying financial statements...
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div style={{
              border: '1px solid rgba(194,74,58,0.3)',
              background: 'rgba(194,74,58,0.06)',
              padding: '16px 20px',
              borderRadius: '3px',
              fontSize: '13.5px',
              color: '#e8836f',
              lineHeight: '1.5',
              display: 'flex',
              gap: '10px'
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ display: 'block', marginBottom: '2px', fontFamily: 'Source Serif 4, serif' }}>Ingestion Failed</strong>
                {error}
              </div>
            </div>
          )}

          {/* VIEW: DASHBOARD TAB */}
          {activeTab === 'dashboard' && mscoreData && (
            <>
              {/* Scorecard Widget Row */}
              <div className="card-panel" style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1fr 1fr',
                gap: '24px',
                alignItems: 'center'
              }}>
                {/* Ticker & Name */}
                <div>
                  <span className="eyebrow">{companyData.sector || 'Equities'}</span>
                  <h2 style={{ fontSize: '26px', margin: '4px 0' }}>
                    {companyData.name} <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', color: '#8d9284' }}>({companyData.ticker})</span>
                  </h2>
                  <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#8d9284', marginTop: '6px' }}>
                    Evaluation Period: Fiscal year {selectedYear} t vs {selectedYear - 1} t-1
                  </div>
                </div>

                {/* Score & Stamp */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--rule)', borderRight: '1px solid var(--rule)', height: '80%' }}>
                  <div style={{ fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace', color: '#8d9284', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Beneish M-Score
                  </div>
                  <div style={{ fontSize: '42px', fontWeight: 'bold', fontFamily: 'IBM Plex Mono, monospace', color: mscoreData.flagged ? '#e8836f' : '#8fc48f', lineHeight: 1 }}>
                    {mscoreData.mscore}
                  </div>
                  <div className={`mscore-stamp animate-stamp-pop ${mscoreData.flagged ? 'flagged' : 'clean'}`} style={{ marginTop: '12px', scale: '0.9' }}>
                    {mscoreData.flagged ? (
                      <>
                        <span className="star">★</span> FLAGGED
                      </>
                    ) : (
                      'CLEAN'
                    )}
                  </div>
                </div>

                {/* Probability Meter */}
                <div>
                  <ProbabilityMeter score={mscoreData.mscore} />
                </div>
              </div>

              {/* Ratios Metrics Row (Pure Values, No Explanations) */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(8, 1fr)',
                gap: '12px'
              }}>
                {Object.keys(mscoreData.ratios).map(k => {
                  const val = mscoreData.ratios[k];
                  const isSuspicious = k === 'TATA' ? val > 0.05 : val > 1.1;
                  return (
                    <div 
                      key={k} 
                      className="card-panel" 
                      style={{ 
                        padding: '12px 8px', 
                        textAlign: 'center',
                        borderTop: isSuspicious ? '3px solid #c24a3a' : '1px solid var(--rule)'
                      }}
                    >
                      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '11px', color: '#8d9284', marginBottom: '4px' }}>
                        {k}
                      </div>
                      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '16px', fontWeight: 'bold', color: isSuspicious ? '#e8836f' : '#ece4d1' }}>
                        {val}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Graphical Visualizations Row */}
              <div className="charts-row">
                {/* M-Score Trend */}
                <div className="card-panel" style={{ height: '320px', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ fontSize: '13px', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', color: '#8d9284', letterSpacing: '0.05em', marginBottom: '16px' }}>
                    Historical M-Score Trend
                  </h3>
                  <MScoreTrendChart history={historyMapping} currentYear={selectedYear} />
                </div>

                {/* Cash Accruals Chart */}
                <div className="card-panel" style={{ height: '320px', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ fontSize: '13px', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', color: '#8d9284', letterSpacing: '0.05em', marginBottom: '16px' }}>
                    Accruals Quality: Net Income vs CFO
                  </h3>
                  <AccrualsChart history={historyMapping} />
                </div>
              </div>

              {/* Widgets Row */}
              <div className="charts-row">
                {/* Radar signature */}
                <div className="card-panel" style={{ height: '390px', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ fontSize: '13px', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', color: '#8d9284', letterSpacing: '0.05em', marginBottom: '16px' }}>
                    Quality Index Fingerprint
                  </h3>
                  <RadarChart 
                    ratios={mscoreData.ratios} 
                    companyName={companyData.ticker} 
                    isFlagged={mscoreData.flagged} 
                  />
                </div>

                {/* TradingView technical chart */}
                <div className="card-panel" style={{ height: '390px', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ fontSize: '13px', fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', color: '#8d9284', letterSpacing: '0.05em', marginBottom: '16px' }}>
                    TradingView Live Technical Price Chart
                  </h3>
                  <div style={{ flex: 1, height: '100%', minHeight: '280px' }}>
                    <TradingViewChart symbol={companyData.ticker} />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* VIEW: RATIO INDEX FILE (EXPLANATIONS PAGE) */}
          {activeTab === 'ratios' && mscoreData && (
            <div className="card-panel animate-fade-up">
              <span className="eyebrow">Index Reference File</span>
              <h2 style={{ fontSize: '24px', marginBottom: '24px' }}>The 8 Beneish Financial Indices</h2>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {Object.keys(RATIO_DESCRIPTIONS).map(k => {
                  const val = mscoreData.ratios[k];
                  const info = RATIO_DESCRIPTIONS[k];
                  const isSuspicious = k === 'TATA' ? val > 0.05 : val > 1.1;

                  return (
                    <div 
                      key={k} 
                      style={{
                        padding: '20px',
                        border: '1px solid var(--rule)',
                        borderRadius: '3px',
                        background: 'rgba(236,228,209,0.02)',
                        borderLeft: isSuspicious ? '4px solid #c24a3a' : '1px solid var(--rule)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                          <span style={{ fontSize: '22px', fontWeight: 'bold', fontFamily: 'IBM Plex Mono, monospace', color: isSuspicious ? '#e8836f' : '#c9a54a' }}>
                            {k}
                          </span>
                          <h4 style={{ fontSize: '16px', fontFamily: 'IBM Plex Sans, sans-serif', fontWeight: '600', color: '#ece4d1' }}>
                            {info.name}
                          </h4>
                        </div>
                        <div style={{ fontSize: '18px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 'bold', color: isSuspicious ? '#e8836f' : '#8fc48f' }}>
                          Current Value: {val}
                        </div>
                      </div>
                      
                      <p style={{ fontSize: '13.5px', color: '#ece4d1', lineHeight: '1.6' }}>
                        {info.desc}
                      </p>

                      <div style={{ display: 'flex', gap: '20px', marginTop: '12px', fontSize: '11px', color: '#8d9284', fontFamily: 'IBM Plex Mono, monospace', paddingTop: '8px', borderTop: '1px dashed rgba(236,228,209,0.1)' }}>
                        <span>Academic Weight: <b>{k === 'SGAI' ? '-0.172' : k === 'LVGI' ? '-0.327' : `+${calculateMScore.toString().includes(k) ? '0.00' : '0.00'}`} (refer weights)</b></span>
                        <span style={{ color: isSuspicious ? '#e8836f' : '#8d9284' }}>
                          Threshold Warning: {isSuspicious ? 'FLAGGED EXTREME' : 'Within Normal Parameters'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIEW: SIMULATION SPREADSHEET (EDITABLE STATEMENT) */}
          {activeTab === 'spreadsheet' && manualFinancials && mscoreData && (
            <div className="card-panel animate-fade-up">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <span className="eyebrow">Spreadsheet Simulation</span>
                  <h3 style={{ fontSize: '20px' }}>Normalized Statements</h3>
                  <p style={{ fontSize: '12px', color: '#8d9284', marginTop: '4px' }}>
                    Edit the input cells below to simulate accounting updates and override parameters.
                  </p>
                </div>
                {mscoreData.warnings.length > 0 && (
                  <div style={{
                    padding: '8px 12px',
                    background: 'rgba(194,74,58,0.06)',
                    border: '1px solid rgba(194,74,58,0.2)',
                    borderRadius: '3px',
                    fontSize: '11px',
                    color: '#e8836f',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <AlertTriangle size={14} /> validation warnings present
                  </div>
                )}
              </div>

              {/* Accounting alerts */}
              {mscoreData.warnings.map((w, idx) => (
                <div key={idx} style={{
                  fontSize: '11px',
                  color: '#e8836f',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'rgba(194,74,58,0.02)',
                  padding: '6px 10px',
                  borderLeft: '2px solid var(--redink-bright)'
                }}>
                  <AlertCircle size={12} /> {w}
                </div>
              ))}

              <div className="ledger-table-container">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Financial Concept (Raw Figures)</th>
                      <th>Year t ({selectedYear})</th>
                      <th>Year t-1 ({selectedYear - 1})</th>
                      <th>Mapped XBRL / Yahoo Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { field: 'revenue', label: 'Revenues / Net Sales', tag: 'RevenueFromContractWithCustomerExcludingAssessedTax, Revenues' },
                      { field: 'cogs', label: 'Cost of Goods Sold (COGS)', tag: 'CostOfGoodsAndServicesSold, CostOfRevenue' },
                      { field: 'receivables', label: 'Net Accounts Receivable', tag: 'AccountsReceivableNetCurrent, Receivables' },
                      { field: 'current_assets', label: 'Total Current Assets', tag: 'AssetsCurrent' },
                      { field: 'ppe_net', label: 'Net Property, Plant & Equipment', tag: 'PropertyPlantEquipmentNet' },
                      { field: 'total_assets', label: 'Total Assets', tag: 'Assets' },
                      { field: 'depreciation', label: 'Depreciation & Amortization', tag: 'DepreciationDepletionAndAmortization' },
                      { field: 'sga_expense', label: 'SG&A Expenses', tag: 'SellingGeneralAndAdministrativeExpense' },
                      { field: 'current_liabilities', label: 'Total Current Liabilities', tag: 'LiabilitiesCurrent' },
                      { field: 'long_term_debt', label: 'Long Term Debt', tag: 'LongTermDebtNoncurrent, LongTermDebt' },
                      { field: 'net_income', label: 'Net Income', tag: 'NetIncomeLoss, ProfitLoss' },
                      { field: 'cfo', label: 'Operating Cash Flow (CFO)', tag: 'NetCashProvidedByUsedInOperatingActivities' },
                    ].map(({ field, label, tag }) => (
                      <tr key={field}>
                        <td style={{ fontWeight: '500' }}>{label}</td>
                        <td>
                          <input
                            type="text"
                            value={manualFinancials.current[field]}
                            onChange={(e) => handleFieldChange('current', field, e.target.value)}
                            style={{
                              background: '#12160f',
                              border: '1px solid rgba(236,228,209,0.1)',
                              color: '#ece4d1',
                              padding: '4px 8px',
                              width: '150px',
                              textAlign: 'right',
                              fontSize: '12.5px',
                              fontFamily: 'IBM Plex Mono, monospace'
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={manualFinancials.prior[field]}
                            onChange={(e) => handleFieldChange('prior', field, e.target.value)}
                            style={{
                              background: '#12160f',
                              border: '1px solid rgba(236,228,209,0.1)',
                              color: '#ece4d1',
                              padding: '4px 8px',
                              width: '150px',
                              textAlign: 'right',
                              fontSize: '12.5px',
                              fontFamily: 'IBM Plex Mono, monospace'
                            }}
                          />
                        </td>
                        <td style={{ color: '#8d9284', fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace' }}>
                          {tag}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Model Limitations Disclosure */}
          <div style={{
            border: '1px solid var(--rule)',
            background: '#181d16',
            borderRadius: '3px',
            padding: '24px',
            fontSize: '13.5px',
            lineHeight: '1.6',
            color: '#8d9284'
          }}>
            <h4 style={{ 
              fontSize: '14px', 
              fontFamily: 'IBM Plex Mono, monospace', 
              textTransform: 'uppercase', 
              color: '#c9a54a', 
              letterSpacing: '0.05em', 
              marginBottom: '12px' 
            }}>
              Methodology Disclosures & Limitations
            </h4>
            <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <li>
                <b>Financial Firm Exclusion:</b> The model does not apply to banks, insurers, or brokerage firms. They do not maintain current/non-current asset definitions in the same way, producing division by zero errors on index calculations.
              </li>
              <li>
                <b>Accounting Standard Differences:</b> US filers use US GAAP, while international tickers (such as NSE/BSE) use IFRS. Ratios will compute, but direct comparisons should be treated as directional.
              </li>
            </ul>
          </div>

        </main>
      </div>

      <footer style={{
        marginTop: '40px',
        paddingTop: '20px',
        borderTop: '1px solid var(--rule)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12px',
        color: '#8d9284',
        fontFamily: 'IBM Plex Mono, monospace'
      }}>
        <div>Beneish M-Score Forensic Terminal © 2026</div>
        <div>
          Made with React & Keyless Free Feeds · <a href="https://github.com/kartikkhandelwal910-arch/beneish-mscore-fraud-detector-" target="_blank" rel="noreferrer" style={{ color: '#c9a54a', textDecoration: 'underline' }}>Repository</a>
        </div>
      </footer>
    </div>
  );
}
