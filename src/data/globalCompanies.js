/**
 * List of top global blue-chip companies across major exchanges 
 * mapped to their exact SEC EDGAR & Preloaded case dataset keys.
 */
export const GLOBAL_BLUECHIPS = [
  // United States (NYSE / NASDAQ)
  { name: "Apple Inc.", ticker: "AAPL", exchange: "US" },
  { name: "Microsoft Corp.", ticker: "MSFT", exchange: "US" },
  { name: "Alphabet Inc. (Google)", ticker: "GOOGL", exchange: "US" },
  { name: "Amazon.com Inc.", ticker: "AMZN", exchange: "US" },
  { name: "NVIDIA Corp.", ticker: "NVDA", exchange: "US" },
  { name: "Tesla Inc.", ticker: "TSLA", exchange: "US" },
  { name: "Meta Platforms Inc.", ticker: "META", exchange: "US" },
  { name: "IBM Corp.", ticker: "IBM", exchange: "US" },
  { name: "The Boeing Co.", ticker: "BA", exchange: "US" },
  { name: "JPMorgan Chase & Co.", ticker: "JPM", exchange: "US" },
  { name: "Walmart Inc.", ticker: "WMT", exchange: "US" },

  // Canada (Toronto / SEC EDGAR)
  { name: "Shopify Inc.", ticker: "SHOP", exchange: "Canada" },
  { name: "Royal Bank of Canada", ticker: "RY", exchange: "Canada" },
  { name: "Enbridge Inc.", ticker: "ENB", exchange: "Canada" },

  // United Kingdom (London / SEC EDGAR)
  { name: "Shell PLC", ticker: "SHEL", exchange: "UK" },
  { name: "AstraZeneca PLC", ticker: "AZN", exchange: "UK" },
  { name: "BP PLC", ticker: "BP", exchange: "UK" },
  { name: "HSBC Holdings PLC", ticker: "HSBC", exchange: "UK" },
  { name: "Unilever PLC", ticker: "UL", exchange: "UK" },

  // Germany (XETRA / Preloaded)
  { name: "Mercedes-Benz Group", ticker: "MBG", exchange: "Germany" },
  { name: "SAP SE", ticker: "SAP", exchange: "Germany" },

  // China / Hong Kong (Preloaded)
  { name: "BYD Co Ltd", ticker: "BYD", exchange: "China" },
  { name: "SAIC Motor Corp", ticker: "SAIC", exchange: "China" },

  // India (NSE / BSE / Preloaded)
  { name: "Reliance Industries", ticker: "RELIANCE", exchange: "India" },
  { name: "Tata Consultancy Services", ticker: "TCS", exchange: "India" },
  { name: "Infosys Ltd", ticker: "INFY", exchange: "India" },
  { name: "ITC Limited", ticker: "ITC", exchange: "India" },
  { name: "Tata Motors Ltd", ticker: "TATAMOTORS", exchange: "India" }
];
