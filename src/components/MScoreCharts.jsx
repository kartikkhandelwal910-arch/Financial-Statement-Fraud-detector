import React from 'react';
import { Radar, Line, Bar } from 'react-chartjs-2';
import { MANIPULATION_THRESHOLD } from './MScoreCalculator';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend
);

// Standard Normal CDF Approximation (Error Function approach)
function standardNormalCDF(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2.0);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Radar Chart displaying the 8 individual indices.
 */
export function RadarChart({ ratios, companyName, isFlagged }) {
  const labels = Object.keys(ratios);
  const dataValues = Object.values(ratios);
  const baselineValues = labels.map(() => 1.0);

  const data = {
    labels: labels,
    datasets: [
      {
        label: `${companyName} Ratio Values`,
        data: dataValues,
        backgroundColor: isFlagged ? 'rgba(194, 74, 58, 0.15)' : 'rgba(127, 174, 127, 0.15)',
        borderColor: isFlagged ? '#c24a3a' : '#7fae7f',
        borderWidth: 2,
        pointBackgroundColor: isFlagged ? '#c24a3a' : '#7fae7f',
        pointBorderColor: '#ece4d1',
        pointHoverBackgroundColor: '#ece4d1',
      },
      {
        label: 'Baseline Normal (1.0)',
        data: baselineValues,
        backgroundColor: 'rgba(141, 146, 132, 0.05)',
        borderColor: '#8d9284',
        borderWidth: 1.2,
        borderDash: [4, 4],
        pointBackgroundColor: 'transparent',
        pointBorderColor: 'transparent',
      }
    ]
  };

  const options = {
    scales: {
      r: {
        angleLines: { color: 'rgba(236, 228, 209, 0.12)' },
        grid: { color: 'rgba(236, 228, 209, 0.12)' },
        pointLabels: {
          color: '#ece4d1',
          font: { family: 'IBM Plex Mono, monospace', size: 10, weight: '500' }
        },
        ticks: {
          color: '#8d9284',
          backdropColor: 'transparent',
          font: { family: 'IBM Plex Mono, monospace', size: 8 }
        },
        suggestedMin: 0,
        suggestedMax: 2.0
      }
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: '#ece4d1',
          boxWidth: 12,
          font: { family: 'IBM Plex Mono, monospace', size: 10 }
        }
      }
    },
    maintainAspectRatio: false,
    responsive: true
  };

  return (
    <div style={{ flex: 1, minHeight: '260px', position: 'relative' }}>
      <Radar data={data} options={options} />
    </div>
  );
}

/**
 * Historical M-Score Line Chart.
 */
export function MScoreTrendChart({ history, currentYear }) {
  // Extract and sort years ascending
  const sortedYears = Object.keys(history)
    .map(Number)
    .sort((a, b) => a - b);

  const mscores = sortedYears.map(yr => history[yr].mscore);

  const data = {
    labels: sortedYears.map(String),
    datasets: [
      {
        label: 'Beneish M-Score',
        data: mscores,
        borderColor: '#c9a54a',
        backgroundColor: 'rgba(201, 165, 74, 0.05)',
        borderWidth: 2,
        pointBackgroundColor: sortedYears.map(yr => 
          history[yr].mscore > MANIPULATION_THRESHOLD ? '#c24a3a' : '#7fae7f'
        ),
        pointBorderColor: '#ece4d1',
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.15,
        fill: true
      }
    ]
  };

  const options = {
    scales: {
      x: {
        grid: { color: 'rgba(236, 228, 209, 0.08)' },
        ticks: { color: '#8d9284', font: { family: 'IBM Plex Mono, monospace', size: 10 } }
      },
      y: {
        grid: { color: 'rgba(236, 228, 209, 0.08)' },
        ticks: { color: '#8d9284', font: { family: 'IBM Plex Mono, monospace', size: 10 } }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => ` M-Score: ${context.raw}`
        }
      }
    },
    maintainAspectRatio: false,
    responsive: true
  };

  // Add custom horizontal annotation in render rather than complex chartjs-plugin-annotation
  const renderThresholdLine = () => {
    return (
      <div style={{
        position: 'absolute',
        left: '48px',
        right: '16px',
        top: '55%', // approximation of -1.78 height
        borderTop: '1px dashed #c24a3a',
        zIndex: 1,
        pointerEvents: 'none'
      }}>
        <span style={{
          position: 'absolute',
          right: '4px',
          top: '-14px',
          fontSize: '9px',
          fontFamily: 'IBM Plex Mono, monospace',
          color: '#c24a3a',
          fontWeight: '600'
        }}>
          THRESHOLD (-1.78)
        </span>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: '200px', position: 'relative' }}>
      <Line data={data} options={options} />
    </div>
  );
}

/**
 * Historical Accruals Bar Chart (Net Income vs CFO).
 */
export function AccrualsChart({ history }) {
  const sortedYears = Object.keys(history)
    .map(Number)
    .sort((a, b) => a - b);

  const netIncome = sortedYears.map(yr => history[yr].net_income);
  const cfo = sortedYears.map(yr => history[yr].cfo);

  // Formatting helper for currency values (reads cleaner in millions/billions)
  const formatYAxis = (value) => {
    const absVal = Math.abs(value);
    if (absVal >= 1.0e12) return (value / 1.0e12).toFixed(1) + 'T';
    if (absVal >= 1.0e9) return (value / 1.0e9).toFixed(1) + 'B';
    if (absVal >= 1.0e6) return (value / 1.0e6).toFixed(0) + 'M';
    return value;
  };

  const data = {
    labels: sortedYears.map(String),
    datasets: [
      {
        label: 'Net Income',
        data: netIncome,
        backgroundColor: '#7fae7f',
        borderColor: '#12160f',
        borderWidth: 1,
        maxBarThickness: 32
      },
      {
        label: 'Operating Cash Flow (CFO)',
        data: cfo,
        backgroundColor: '#c9a54a',
        borderColor: '#12160f',
        borderWidth: 1,
        maxBarThickness: 32
      }
    ]
  };

  const options = {
    scales: {
      x: {
        grid: { color: 'rgba(236, 228, 209, 0.08)' },
        ticks: { color: '#8d9284', font: { family: 'IBM Plex Mono, monospace', size: 10 } }
      },
      y: {
        grid: { color: 'rgba(236, 228, 209, 0.08)' },
        ticks: { 
          color: '#8d9284', 
          font: { family: 'IBM Plex Mono, monospace', size: 9 },
          callback: (value) => formatYAxis(value)
        }
      }
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#ece4d1',
          boxWidth: 12,
          font: { family: 'IBM Plex Mono, monospace', size: 10 }
        }
      }
    },
    maintainAspectRatio: false,
    responsive: true
  };

  return (
    <div style={{ flex: 1, minHeight: '200px', position: 'relative' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

/**
 * Circular standard normal CDF Fraud Probability Meter.
 */
export function ProbabilityMeter({ score }) {
  const prob = standardNormalCDF(score);
  const percentage = (prob * 100).toFixed(1);

  // SVG configurations for radial ring
  const radius = 64;
  const strokeWidth = 8;
  const normalizedRadius = radius - strokeWidth * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (prob * circumference);

  // Pick color representation based on risk
  let riskColor = '#7fae7f'; // low
  let riskLabel = 'LOW RISK';
  if (score > -1.78) {
    riskColor = '#c24a3a'; // critical
    riskLabel = 'CRITICAL';
  } else if (score > -2.22) {
    riskColor = '#c9a54a'; // moderate
    riskLabel = 'MODERATE';
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'IBM Plex Mono, monospace',
      padding: '10px 0'
    }}>
      <div style={{ position: 'relative', width: `${radius * 2}px`, height: `${radius * 2}px` }}>
        <svg
          height={radius * 2}
          width={radius * 2}
          style={{ transform: 'rotate(-90deg)' }}
        >
          {/* Background circle */}
          <circle
            stroke="rgba(236, 228, 209, 0.08)"
            fill="transparent"
            strokeWidth={strokeWidth}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          {/* Active progress circle */}
          <circle
            stroke={riskColor}
            fill="transparent"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference + ' ' + circumference}
            style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.8s ease' }}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
            strokeLinecap="round"
          />
        </svg>

        {/* Center label */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center'
        }}>
          <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#ece4d1', lineHeight: 1 }}>
            {percentage}%
          </span>
          <span style={{ fontSize: '8px', color: '#8d9284', marginTop: '4px', letterSpacing: '0.04em' }}>
            PROBABILITY
          </span>
        </div>
      </div>

      <div style={{
        marginTop: '12px',
        fontSize: '11px',
        fontWeight: 'bold',
        color: riskColor,
        letterSpacing: '0.08em',
        border: `1px solid ${riskColor}`,
        padding: '3px 8px',
        borderRadius: '3px',
        background: 'rgba(236,228,209,0.02)'
      }}>
        {riskLabel}
      </div>
    </div>
  );
}
