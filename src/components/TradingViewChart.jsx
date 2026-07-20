import React, { useEffect, useRef } from 'react';
import { SYMBOLS } from '../utils/api';

export default function TradingViewChart({ symbol }) {
  const container = useRef();

  useEffect(() => {
    if (!container.current) return;
    
    // Clear container
    container.current.innerHTML = '';

    // If ticker is Enron or WorldCom, they are delisted. Show a custom placeholder.
    if (symbol === 'ENRN' || symbol === 'WCOM') {
      container.current.innerHTML = `
        <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #181d16; color: #8d9284; border: 1px solid rgba(236,228,209,0.14); border-radius: 3px; padding: 20px; font-family: monospace; text-align: center; box-sizing: border-box;">
          <div style="font-size: 32px; color: #c9a54a; margin-bottom: 12px;">★</div>
          <div style="font-size: 13px; font-weight: 600; color: #ece4d1; letter-spacing: 0.05em; text-transform: uppercase;">TradingView Chart Unavailable</div>
          <div style="font-size: 11px; margin-top: 8px; max-width: 280px; line-height: 1.5; color: #8d9284;">
            Ticker <b>${symbol}</b> represents a historical bankrupt or delisted company. No active market data feeds exist.
          </div>
        </div>
      `;
      return;
    }

    const upperSym = symbol.toUpperCase();
    let tvSymbol = SYMBOLS[upperSym]?.tradingview;
    
    if (!tvSymbol) {
      if (symbol.includes('.')) {
        const parts = symbol.split('.');
        const name = parts[0].toUpperCase();
        const suffix = parts[1].toUpperCase();
        if (suffix === 'NS' || suffix === 'BO' || suffix === 'BSE') {
          tvSymbol = `BSE:${name}`;
        } else if (suffix === 'DE' || suffix === 'DEX') {
          tvSymbol = `XETRA:${name}`;
        } else if (suffix === 'LON') {
          tvSymbol = `LSE:${name}`;
        } else {
          tvSymbol = symbol;
        }
      } else {
        tvSymbol = symbol;
      }
    }

    const widgetContainer = document.createElement("div");
    widgetContainer.id = "tradingview-widget-inner";
    widgetContainer.style.height = "100%";
    widgetContainer.style.width = "100%";
    container.current.appendChild(widgetContainer);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      "autosize": true,
      "symbol": tvSymbol,
      "interval": "D",
      "timezone": "Etc/UTC",
      "theme": "dark",
      "style": "1",
      "locale": "en",
      "enable_publishing": false,
      "hide_side_toolbar": false,
      "allow_symbol_change": true,
      "calendar": false,
      "support_host": "https://www.tradingview.com"
    });

    widgetContainer.appendChild(script);
  }, [symbol]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <div 
        ref={container} 
        style={{ height: "100%", width: "100%" }} 
        className="tradingview-chart-container"
      />
    </div>
  );
}
