import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, ComposedChart
} from 'recharts';
import {
  Upload, Database, Sparkles, TrendingUp, BarChart3, CheckCircle2,
  AlertCircle, Download, Send, RefreshCw,
  PieChart as PieChartIcon, Activity, ShieldCheck, ArrowUpRight, ArrowDownRight,
  Table as TableIcon, BrainCircuit, ChevronRight, Cpu, Sun, Moon
} from 'lucide-react';

// --- SAMPLE DATASETS FOR IMMEDIATE DEMO ---
const SAMPLE_DATASETS = {
  retail: {
    name: "Retail Sales & Revenue (2025-26)",
    description: "Monthly e-commerce and retail store performance across product categories, marketing spend, and regional revenue.",
    raw: `Month,Category,Region,Units_Sold,Revenue,Marketing_Spend,Customer_Satisfaction
2025-01,Electronics,North,420,84000,12000,4.5
2025-02,Apparel,South,610,36600,5500,4.2
2025-03,Home & Living,East,340,44200,6800,4.6
2025-04,Electronics,West,490,98000,14500,4.7
2025-05,Apparel,North,720,43200,6200,4.3
2025-06,Home & Living,South,390,50700,7400,4.4
2025-07,Electronics,East,530,106000,15200,4.8
2025-08,Apparel,West,680,40800,5900,4.5
2025-09,Home & Living,North,410,53300,7900,4.5
2025-10,Electronics,South,610,122000,18000,4.9
2025-10,Electronics,South,610,122000,18000,4.9
2025-11,Apparel,East,890,53400,8500,4.6
2025-12,Electronics,West,780,156000,22500,4.9
2026-01,Home & Living,North,460,59800,8200,4.7
2026-02,Electronics,South,650,130000,19000,4.8
2026-03,Apparel,West,740,44400,6400,4.5`
  },
  saas: {
    name: "SaaS Subscription & Churn Metrics",
    description: "B2B SaaS monthly recurring revenue (MRR), active users, support tickets, and operational expenses.",
    raw: `Period,Plan_Tier,Active_Users,MRR,Operating_Cost,Support_Tickets,Churn_Rate
Q1-M1,Enterprise,145,72500,31000,42,1.8
Q1-M2,Pro,420,42000,18500,95,3.2
Q1-M3,Enterprise,160,80000,33000,38,1.5
Q2-M1,Pro,465,46500,19800,102,3.0
Q2-M2,Enterprise,178,89000,35500,35,1.4
Q2-M2,Enterprise,178,89000,35500,35,1.4
Q2-M3,Starter,890,26700,14200,185,5.4
Q3-M1,Enterprise,195,97500,38000,31,1.2
Q3-M2,Pro,510,51000,21000,88,2.7
Q3-M3,Enterprise,215,107500,41000,29,1.1
Q4-M1,Pro,555,55500,22500,,2.5
Q4-M2,Enterprise,240,120000,44500,26,1.0`
  },
  healthcare: {
    name: "Hospital Operations & Patient Flow",
    description: "Departmental patient admissions, average stay duration, treatment billing, and resource utilization.",
    raw: `Month,Department,Patients_Admitted,Avg_Stay_Days,Billing_Revenue,Staff_Hours,Bed_Occupancy_Pct
Jan,Cardiology,210,4.2,315000,4800,84.5
Feb,Orthopedics,185,3.8,240500,4200,78.0
Mar,Neurology,140,5.1,266000,3900,81.2
Apr,Cardiology,235,4.0,352500,5100,88.4
May,Pediatrics,310,2.4,186000,4600,76.5
Jun,Orthopedics,205,3.6,266500,4450,82.0
Jul,Cardiology,250,4.1,375000,5300,91.0
Jul,Cardiology,250,4.1,375000,5300,91.0
Aug,Neurology,165,4.9,313500,4150,85.3
Sep,Pediatrics,340,2.2,204000,4900,80.1
Oct,Cardiology,270,3.9,405000,5600,93.2`
  }
};

const CHART_COLORS = ['#3B5BFD', '#1E40AF', '#10B981', '#F59E0B', '#6366F1', '#0EA5E9'];

// --- CSV PARSER & DATA ENGINE (PHASE 1, 2, 3, 6) ---
function parseCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const rowObj = {};
    headers.forEach((h, idx) => {
      const val = values[idx] !== undefined ? values[idx] : '';
      rowObj[h] = val;
    });
    rows.push(rowObj);
  }
  return { headers, rows };
}

function runPreprocessingAndStats(headers, rawRows) {
  const initialRowCount = rawRows.length;

  // 1. Detect column types
  const columnTypes = {};
  headers.forEach(col => {
    let numCount = 0;
    let validCount = 0;
    rawRows.forEach(r => {
      const val = r[col];
      if (val !== '' && val !== null && val !== undefined && val.toLowerCase() !== 'na' && val.toLowerCase() !== 'null') {
        validCount++;
        if (!isNaN(Number(val))) numCount++;
      }
    });
    columnTypes[col] = validCount > 0 && numCount / validCount >= 0.7 ? 'numeric' : 'categorical';
  });

  // 2. Remove exact duplicates
  const seen = new Set();
  const dedupedRows = [];
  let duplicatesRemoved = 0;

  rawRows.forEach(row => {
    const sig = JSON.stringify(row);
    if (seen.has(sig)) {
      duplicatesRemoved++;
    } else {
      seen.add(sig);
      dedupedRows.push({ ...row });
    }
  });

  // 3. Compute imputation values (Mean for numeric, Mode for categorical)
  const imputationValues = {};
  headers.forEach(col => {
    const validVals = dedupedRows
      .map(r => r[col])
      .filter(v => v !== '' && v !== null && v !== undefined && String(v).toLowerCase() !== 'na' && String(v).toLowerCase() !== 'null');

    if (columnTypes[col] === 'numeric') {
      const nums = validVals.map(Number).filter(n => !isNaN(n));
      const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      imputationValues[col] = Number(mean.toFixed(2));
    } else {
      const freq = {};
      let mode = 'Unknown';
      let maxF = 0;
      validVals.forEach(v => {
        freq[v] = (freq[v] || 0) + 1;
        if (freq[v] > maxF) {
          maxF = freq[v];
          mode = v;
        }
      });
      imputationValues[col] = mode;
    }
  });

  // 4. Clean & Impute Missing Values
  let missingImputed = 0;
  const cleanedRows = dedupedRows.map((row, idx) => {
    const cleanRow = { _id: idx + 1 };
    headers.forEach(col => {
      const rawVal = row[col];
      const isMissing = rawVal === '' || rawVal === null || rawVal === undefined || String(rawVal).toLowerCase() === 'na' || String(rawVal).toLowerCase() === 'null';
      if (isMissing) {
        missingImputed++;
        cleanRow[col] = imputationValues[col];
      } else {
        cleanRow[col] = columnTypes[col] === 'numeric' ? Number(rawVal) : String(rawVal).trim();
      }
    });
    return cleanRow;
  });

  // 5. Phase 3: Statistical Analysis for numeric columns
  const numericCols = headers.filter(h => columnTypes[h] === 'numeric');
  const categoricalCols = headers.filter(h => columnTypes[h] === 'categorical');
  const stats = {};

  numericCols.forEach(col => {
    const vals = cleanedRows.map(r => r[col]).sort((a, b) => a - b);
    const n = vals.length;
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = n ? sum / n : 0;
    const median = n === 0 ? 0 : n % 2 === 0 ? (vals[n / 2 - 1] + vals[n / 2]) / 2 : vals[Math.floor(n / 2)];

    // Mode
    const freq = {};
    let mode = vals[0] ?? 0;
    let maxF = 0;
    vals.forEach(v => {
      freq[v] = (freq[v] || 0) + 1;
      if (freq[v] > maxF) {
        maxF = freq[v];
        mode = v;
      }
    });

    const variance = n > 1 ? vals.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1) : 0;
    const stdDev = Math.sqrt(variance);

    stats[col] = {
      count: n,
      sum: Number(sum.toFixed(2)),
      mean: Number(mean.toFixed(2)),
      median: Number(median.toFixed(2)),
      mode: Number(mode.toFixed(2)),
      stdDev: Number(stdDev.toFixed(2)),
      min: vals[0] ?? 0,
      max: vals[n - 1] ?? 0
    };
  });

  // 6. Correlation Matrix between numeric columns
  const correlations = [];
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      const colA = numericCols[i];
      const colB = numericCols[j];
      const x = cleanedRows.map(r => r[colA]);
      const y = cleanedRows.map(r => r[colB]);
      const meanX = stats[colA].mean;
      const meanY = stats[colB].mean;

      let num = 0, denX = 0, denY = 0;
      for (let k = 0; k < x.length; k++) {
        num += (x[k] - meanX) * (y[k] - meanY);
        denX += Math.pow(x[k] - meanX, 2);
        denY += Math.pow(y[k] - meanY, 2);
      }
      const r = (denX === 0 || denY === 0) ? 0 : num / Math.sqrt(denX * denY);
      correlations.push({
        pair: `${colA} ↔ ${colB}`,
        colA,
        colB,
        r: Number(r.toFixed(3))
      });
    }
  }
  correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  return {
    headers,
    columnTypes,
    numericCols,
    categoricalCols,
    cleanedRows,
    preprocessingReport: {
      initialRowCount,
      finalRowCount: cleanedRows.length,
      duplicatesRemoved,
      missingImputed,
      qualityScore: Math.max(0, Math.min(100, Math.round(100 - ((duplicatesRemoved + missingImputed) / Math.max(1, initialRowCount * headers.length)) * 100)))
    },
    stats,
    correlations
  };
}

// --- PHASE 6: LINEAR REGRESSION FORECASTING ENGINE ---
function computeForecast(rows, labelCol, targetCol, horizon = 4) {
  const n = rows.length;
  if (n < 2 || !targetCol) return null;

  const points = rows.map((r, idx) => ({
    x: idx + 1,
    label: labelCol ? String(r[labelCol]) : `Period ${idx + 1}`,
    actual: Number(r[targetCol]) || 0
  }));

  // Ordinary Least Squares (OLS) Linear Regression: y = m*x + b
  const sumX = points.reduce((acc, p) => acc + p.x, 0);
  const sumY = points.reduce((acc, p) => acc + p.actual, 0);
  const sumXY = points.reduce((acc, p) => acc + p.x * p.actual, 0);
  const sumXX = points.reduce((acc, p) => acc + p.x * p.x, 0);

  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared and Residual Standard Error
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;

  const combinedSeries = points.map(p => {
    const trend = slope * p.x + intercept;
    ssTot += Math.pow(p.actual - meanY, 2);
    ssRes += Math.pow(p.actual - trend, 2);
    return {
      period: p.label,
      actual: p.actual,
      trend: Number(trend.toFixed(2)),
      forecast: null,
      upperBound: null,
      lowerBound: null
    };
  });

  const rSquared = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;
  const stdError = n > 2 ? Math.sqrt(ssRes / (n - 2)) : meanY * 0.08;

  // Connect last actual point to forecast line smoothly
  combinedSeries[combinedSeries.length - 1].forecast = combinedSeries[combinedSeries.length - 1].actual;

  const futurePredictions = [];
  for (let h = 1; h <= horizon; h++) {
    const futureX = n + h;
    const predicted = Math.max(0, slope * futureX + intercept);
    const margin = 1.28 * stdError * Math.sqrt(1 + 1 / n); // ~80% confidence interval
    const periodName = `Forecast +${h}`;

    const entry = {
      period: periodName,
      actual: null,
      trend: Number(predicted.toFixed(2)),
      forecast: Number(predicted.toFixed(2)),
      upperBound: Number((predicted + margin).toFixed(2)),
      lowerBound: Number(Math.max(0, predicted - margin).toFixed(2))
    };
    combinedSeries.push(entry);
    futurePredictions.push(entry);
  }

  const lastActual = points[points.length - 1].actual;
  const finalForecast = futurePredictions[futurePredictions.length - 1].forecast;
  const projectedGrowthPct = lastActual !== 0 ? ((finalForecast - lastActual) / Math.abs(lastActual)) * 100 : 0;

  return {
    slope: Number(slope.toFixed(2)),
    intercept: Number(intercept.toFixed(2)),
    rSquared: Number(rSquared.toFixed(3)),
    projectedGrowthPct: Number(projectedGrowthPct.toFixed(1)),
    combinedSeries,
    futurePredictions
  };
}

// --- DETERMINISTIC LOCAL ANALYTICAL & HEURISTIC AI FALLBACK ENGINE ---
function getSegmentBreakdown(analysis, targetMetric) {
  if (!analysis || !targetMetric) return [];
  const segCol =
    analysis.categoricalCols.find(c => !/month|period|date|time|quarter/i.test(c)) ||
    analysis.categoricalCols[0];
  if (!segCol) return [];

  const grouped = {};
  analysis.cleanedRows.forEach(row => {
    const key = String(row[segCol]);
    if (!grouped[key]) grouped[key] = { name: key, total: 0, count: 0 };
    grouped[key].total += Number(row[targetMetric]) || 0;
    grouped[key].count += 1;
  });

  return Object.values(grouped)
    .map(g => ({
      dimension: segCol,
      name: g.name,
      total: Number(g.total.toFixed(2)),
      average: Number((g.total / g.count).toFixed(2)),
      count: g.count
    }))
    .sort((a, b) => b.total - a.total);
}

// Fuzzy column & entity matcher for real-time natural-language data queries
function matchColumnsFromQuery(queryLower, analysis) {
  const matchedNumeric = [];
  const matchedCategorical = [];

  analysis.numericCols.forEach(col => {
    const norm = col.toLowerCase().replace(/_/g, ' ');
    const tokens = norm.split(/\s+/).filter(t => t.length > 2);
    if (queryLower.includes(norm) || queryLower.includes(col.toLowerCase())) {
      matchedNumeric.push({ col, score: 10 });
    } else if (tokens.some(t => queryLower.includes(t))) {
      matchedNumeric.push({ col, score: 5 });
    }
  });

  analysis.categoricalCols.forEach(col => {
    const norm = col.toLowerCase().replace(/_/g, ' ');
    const tokens = norm.split(/\s+/).filter(t => t.length > 2);
    if (queryLower.includes(norm) || queryLower.includes(col.toLowerCase())) {
      matchedCategorical.push({ col, score: 10 });
    } else if (tokens.some(t => queryLower.includes(t))) {
      matchedCategorical.push({ col, score: 5 });
    }
  });

  matchedNumeric.sort((a, b) => b.score - a.score);
  matchedCategorical.sort((a, b) => b.score - a.score);

  return {
    numericCols: matchedNumeric.map(m => m.col),
    categoricalCols: matchedCategorical.map(m => m.col)
  };
}

function findMentionedEntityValues(queryLower, analysis) {
  const matches = [];
  analysis.categoricalCols.forEach(col => {
    const uniqueVals = [...new Set(analysis.cleanedRows.map(r => String(r[col])))];
    uniqueVals.forEach(val => {
      const valLower = val.toLowerCase();
      if (valLower.length >= 2 && queryLower.includes(valLower)) {
        matches.push({ col, value: val });
      }
    });
  });
  return matches;
}

function formatRowSnippet(row, analysis, highlightCol) {
  const labelCol = analysis.categoricalCols[0] || analysis.headers[0];
  const secondaryCat = analysis.categoricalCols.find(c => c !== labelCol);
  const labelParts = [row[labelCol]];
  if (secondaryCat) labelParts.push(row[secondaryCat]);
  const val = typeof row[highlightCol] === 'number' ? row[highlightCol].toLocaleString() : row[highlightCol];
  return `**${labelParts.join(' • ')}** → **${highlightCol}:** **${val}**`;
}

function generateLocalExecutiveBrief(datasetTitle, analysis, forecastData, forecastTarget) {
  const { preprocessingReport, stats, correlations, numericCols } = analysis;
  const primaryCol = forecastTarget || numericCols[1] || numericCols[0];
  const primaryStat = stats[primaryCol];
  const segments = getSegmentBreakdown(analysis, primaryCol);
  const topSeg = segments[0];
  const lowSeg = segments[segments.length - 1];
  const topCorr = correlations[0];
  const secondCorr = correlations[1];

  const findings = [
    `- **Dataset Scale & Integrity:** Processed **${preprocessingReport.finalRowCount} clean records** across **${analysis.headers.length} features** for *${datasetTitle}* with a **${preprocessingReport.qualityScore}% Data Health Score** (${preprocessingReport.duplicatesRemoved} duplicates removed, ${preprocessingReport.missingImputed} missing fields imputed).`,
    primaryStat
      ? `- **Core Metric Volume (${primaryCol.replace(/_/g, ' ')}):** Cumulative total reached **${primaryStat.sum.toLocaleString()}**, averaging **${primaryStat.mean.toLocaleString()}** per record (median: **${primaryStat.median.toLocaleString()}**, range: **${primaryStat.min.toLocaleString()} – ${primaryStat.max.toLocaleString()}**).`
      : null,
    topSeg
      ? `- **Leading Segment (${topSeg.dimension}):** **${topSeg.name}** leads performance with **${topSeg.total.toLocaleString()}** total ${primaryCol} (**${topSeg.average.toLocaleString()}** avg across ${topSeg.count} records)${lowSeg && lowSeg.name !== topSeg.name ? `, outperforming **${lowSeg.name}** (${lowSeg.total.toLocaleString()})` : ''}.`
      : null
  ].filter(Boolean).join('\n');

  const trends = [
    topCorr
      ? `- **Primary Driver Correlation:** **${topCorr.pair}** exhibits a ${Math.abs(topCorr.r) >= 0.7 ? 'strong' : 'moderate'} ${topCorr.r >= 0 ? 'positive' : 'inverse'} linear correlation (**r = ${topCorr.r}**), indicating that shifts in **${topCorr.colA}** closely track **${topCorr.colB}**.`
      : `- **Multivariate Structure:** Analyzed ${numericCols.length} numeric metrics across sequential intervals.`,
    secondCorr
      ? `- **Secondary Relationship:** **${secondCorr.pair}** shows **r = ${secondCorr.r}**, providing additional signal for resource allocation.`
      : null,
    forecastData
      ? `- **OLS Regression Trajectory:** ${primaryCol} is trending at **${forecastData.slope >= 0 ? '+' : ''}${forecastData.slope.toLocaleString()} units/period** with a goodness-of-fit of **R² = ${forecastData.rSquared}** (${Math.round(forecastData.rSquared * 100)}% variance explained).`
      : null
  ].filter(Boolean).join('\n');

  const evaluation = [
    primaryStat
      ? `- **Dispersion & Volatility:** Standard deviation for **${primaryCol}** is **${primaryStat.stdDev.toLocaleString()}** (${primaryStat.mean !== 0 ? Math.round((primaryStat.stdDev / primaryStat.mean) * 100) : 0}% coefficient of variation), reflecting ${primaryStat.stdDev / (primaryStat.mean || 1) > 0.35 ? 'significant variance across segments/periods' : 'consistent operational stability'}.`
      : null,
    forecastData
      ? `- **Forward Outlook:** Over the next **${forecastData.futurePredictions.length} periods**, ${primaryCol} is projected to change by **${forecastData.projectedGrowthPct >= 0 ? '+' : ''}${forecastData.projectedGrowthPct}%**, reaching **${forecastData.futurePredictions[forecastData.futurePredictions.length - 1]?.forecast.toLocaleString()}**.`
      : null
  ].filter(Boolean).join('\n');

  const recommendations = [
    topSeg
      ? `- **Double Down on Top Performers:** Reallocate budget and capacity toward **${topSeg.name}** (${topSeg.dimension}), which delivers the highest average return of **${topSeg.average.toLocaleString()}** per record.`
      : `- **Standardize High-Yield Workflows:** Replicate best-performing operational parameters across underperforming intervals.`,
    topCorr
      ? `- **Optimize Key Lever (${topCorr.colA}):** Because **${topCorr.colA}** correlates strongly with **${topCorr.colB}** (r = ${topCorr.r}), establish automated threshold monitoring on **${topCorr.colA}** to sustain output gains.`
      : `- **Expand Feature Tracking:** Capture additional granular drivers to improve predictive model precision.`,
    lowSeg && lowSeg.name !== topSeg?.name
      ? `- **Targeted Uplift for ${lowSeg.name}:** Audit pricing, conversion, or operational bottlenecks in **${lowSeg.name}** to close the gap with **${topSeg.name}**.`
      : `- **Maintain Data Hygiene:** Enforce schema validation at ingestion to keep Data Health above **95%** without post-hoc imputation.`
  ].join('\n');

  return `### 1. Key Analytical Findings\n${findings}\n\n### 2. Trend & Correlation Explanations\n${trends}\n\n### 3. Performance Evaluation\n${evaluation}\n\n### 4. Actionable Strategic Recommendations\n${recommendations}`;
}

// Real-Time Query-Aware Analytical Engine: parses user intent & queries cleanedRows directly
function answerDataQuestionRealTime(question, datasetTitle, analysis, forecastData, forecastTarget, chatHistory = []) {
  const q = question.toLowerCase().trim();
  const cleanQ = q.replace(/[!?.]+$/g, '').trim();
  const { preprocessingReport, stats, correlations, numericCols, categoricalCols, cleanedRows, headers } = analysis;

  const { numericCols: matchedNums, categoricalCols: matchedCats } = matchColumnsFromQuery(q, analysis);
  const entityFilters = findMentionedEntityValues(q, analysis);

  const targetCol =
    matchedNums[0] ||
    forecastTarget ||
    numericCols[1] ||
    numericCols[0];

  const groupCol =
    matchedCats[0] ||
    categoricalCols.find(c => !/month|period|date|time|quarter/i.test(c)) ||
    categoricalCols[0];

  // 0A. Human Greeting & Menu Handler ("hi", "hello", "hey", "good morning", "what can you do", "help", "menu")
  if (
    /^(hi|hello|hey|hii+|heyy+|hola|namaste|good morning|good afternoon|good evening|yo|sup)\b/.test(cleanQ) &&
    cleanQ.split(/\s+/).length <= 5
  ) {
    const sampleEntities = groupCol
      ? [...new Set(cleanedRows.map(r => String(r[groupCol])))].slice(0, 2)
      : [];
    const compareSample =
      sampleEntities.length >= 2
        ? `"Compare ${sampleEntities[0]} vs ${sampleEntities[1]}"`
        : `"Break down ${targetCol} by ${groupCol || 'category'}"`;

    return `Hello! 👋 Great to have you here. I'm your **AI Data Analyst Copilot**, and I've already reviewed **${datasetTitle}** (${preprocessingReport.finalRowCount} clean records across ${headers.length} columns).\n\nHere is a quick menu of questions you can ask me right now:\n- **Rankings & Peaks:** *"Which row has the highest ${targetCol}?"* or *"Show bottom 3 records"*\n- **Side-by-Side Comparisons:** *${compareSample}*\n- **Exact Metrics:** *"What is the average and median ${targetCol}?"*\n- **Drivers & Correlations:** *"What drives ${targetCol} the most?"*\n- **Future Predictions:** *"Predict ${targetCol} for the next 4 periods"*\n- **Data Cleaning Audit:** *"How many missing values or duplicates were fixed?"*\n\nWhat would you like to explore first?`;
  }

  // 0B. Capabilities / Help / Menu Request
  if (/^(help|menu|options|commands|what can you do|how do you work|who are you)\b/.test(cleanQ) || /\b(what questions can i ask|show menu)\b/.test(cleanQ)) {
    return `I can analyze **${datasetTitle}** in real time just like a human data analyst. Try asking me things like:\n\n1. **Filter & Compare:** *"Show details for ${groupCol || 'each group'}"* or *"Compare categories by ${targetCol}"*\n2. **Find Extremes:** *"Top 3 highest ${targetCol} records"* or *"Where is ${targetCol} lowest?"*\n3. **Deep Statistics:** *"Give me the mean, median, and standard deviation of ${targetCol}"*\n4. **Business Advice:** *"How can we improve ${targetCol}?"*\n5. **ML Forecasting:** *"Forecast the next 5 periods"*\n\nJust type your question naturally in your own words!`;
  }

  // 0C. Politeness / Appreciation / Farewell
  if (/^(thanks|thank you|thx|ty|awesome|great|nice|cool|good job|bye|goodbye)\b/.test(cleanQ) && cleanQ.split(/\s+/).length <= 5) {
    return `You're very welcome! 😊 Let me know whenever you want to dig deeper into **${datasetTitle}**, compare another column, or test a forecast scenario.`;
  }

  // 0D. Conversational Follow-up ("why", "explain more", "tell me more", "how so", "elaborate")
  if (/^(why|why\??|how|how so|explain|elaborate|tell me more|more details|details|what else)\b/.test(cleanQ) && cleanQ.split(/\s+/).length <= 5) {
    const lastAssistantMsg = [...chatHistory].reverse().find(m => m.role === 'assistant')?.text || '';
    const topCorr = correlations[0];
    const segments = getSegmentBreakdown(analysis, targetCol);
    const topSeg = segments[0];

    if (/forecast|predict|slope/i.test(lastAssistantMsg) && forecastData) {
      return `Here is the reasoning behind that forecast:\n\n- Our Ordinary Least Squares regression fits a straight line across all **${preprocessingReport.finalRowCount} historical periods**, showing a steady velocity of **${forecastData.slope >= 0 ? '+' : ''}${forecastData.slope.toLocaleString()}** per period.\n- Because **R² = ${forecastData.rSquared}**, the linear trend explains **${Math.round(forecastData.rSquared * 100)}%** of the movement in **${targetCol}**, giving us the confidence band shown in the chart.`;
    }
    if (topCorr) {
      return `Digging one level deeper into **${datasetTitle}**:\n\n- The strongest statistical link in your data is between **${topCorr.colA}** and **${topCorr.colB}** (**r = ${topCorr.r}**).\n${topSeg ? `- At the segment level, **${topSeg.name}** leads **${topSeg.dimension}** with an average **${targetCol}** of **${topSeg.average.toLocaleString()}** per record.\n` : ''}- Would you like me to rank the individual rows or recommend specific actions based on this?`;
    }
  }

  // Parse requested count (e.g. "top 3", "bottom 5", "next 4")
  const countMatch = q.match(/\b(?:top|bottom|first|last|next)\s+(\d+)\b/);
  const requestedCount = countMatch ? Math.min(10, Math.max(1, parseInt(countMatch[1], 10))) : null;

  // 1. Specific Entity Filter & Comparison Queries
  if (entityFilters.length > 0) {
    const byCol = {};
    entityFilters.forEach(ef => {
      if (!byCol[ef.col]) byCol[ef.col] = [];
      byCol[ef.col].push(ef.value);
    });

    const filteredRows = cleanedRows.filter(row =>
      Object.entries(byCol).every(([col, vals]) => vals.includes(String(row[col])))
    );

    if (filteredRows.length > 0) {
      const multiValEntry = Object.entries(byCol).find(([, vals]) => vals.length >= 2);
      if (multiValEntry) {
        const [compCol, compVals] = multiValEntry;
        const rowsSummary = compVals.map((val, idx) => {
          const subset = cleanedRows.filter(r => String(r[compCol]) === val);
          const total = subset.reduce((acc, r) => acc + (Number(r[targetCol]) || 0), 0);
          const avg = subset.length ? total / subset.length : 0;
          return `${idx + 1}. **${val} (${compCol}):** **${subset.length}** records | Total ${targetCol}: **${Number(total.toFixed(2)).toLocaleString()}** | Avg: **${Number(avg.toFixed(2)).toLocaleString()}**`;
        }).join('\n');

        return `**Side-by-Side Comparison (${compVals.join(' vs ')}) — ${targetCol}**\n\n${rowsSummary}\n\nLet me know if you'd like to compare another metric across these groups!`;
      }

      const filterDesc = entityFilters.map(f => `${f.col} = **${f.value}**`).join(', ');
      const metricLines = (matchedNums.length ? matchedNums : numericCols.slice(0, 4)).map(col => {
        const vals = filteredRows.map(r => Number(r[col]) || 0);
        const sum = vals.reduce((a, b) => a + b, 0);
        const avg = sum / vals.length;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        return `- **${col}:** Total = **${Number(sum.toFixed(2)).toLocaleString()}** | Avg = **${Number(avg.toFixed(2)).toLocaleString()}** | Range: ${min.toLocaleString()} – ${max.toLocaleString()}`;
      }).join('\n');

      const sampleRowList = filteredRows
        .slice(0, 4)
        .map((r, i) => `${i + 1}. ${formatRowSnippet(r, analysis, targetCol)}`)
        .join('\n');

      return `**Filtered Query Result (${filterDesc})**\nFound **${filteredRows.length} matching records** in *${datasetTitle}*:\n\n${metricLines}\n\n**Matching Records:**\n${sampleRowList}`;
    }
  }

  // 2. Data Cleaning, Schema, Columns & Row Count Queries
  if (/\b(clean|cleaning|missing|null|duplicate|duplicates|schema|columns|features|how many rows|record count|data health|quality)\b/.test(q)) {
    const colList = headers
      .map(h => `- **${h}** (${analysis.columnTypes[h] === 'numeric' ? 'Numeric' : 'Categorical'})`)
      .join('\n');
    return `**Dataset Schema & Preprocessing Audit — ${datasetTitle}**\n\n- **Initial Rows Uploaded:** **${preprocessingReport.initialRowCount}**\n- **Clean Rows Retained:** **${preprocessingReport.finalRowCount}**\n- **Exact Duplicates Removed:** **${preprocessingReport.duplicatesRemoved}**\n- **Missing Values Imputed:** **${preprocessingReport.missingImputed}** (Mean for numeric, Mode for categorical)\n- **Overall Data Health Score:** **${preprocessingReport.qualityScore}%**\n\n**Detected Features (${headers.length}):**\n${colList}`;
  }

  // 3. Predictive ML Forecast Queries
  if (/\b(forecast|predict|prediction|future|next|projection|horizon|r2|r²|slope|linear regression)\b/.test(q)) {
    const horizon = requestedCount || forecastData?.futurePredictions.length || 4;
    const labelCol = categoricalCols[0] || headers[0];
    const customForecast = computeForecast(cleanedRows, labelCol, targetCol, horizon);
    if (customForecast) {
      const predLines = customForecast.futurePredictions
        .map(fp => `- **${fp.period}:** **${fp.forecast.toLocaleString()}** (80% CI: ${fp.lowerBound.toLocaleString()} – ${fp.upperBound.toLocaleString()})`)
        .join('\n');
      return `**Real-Time OLS Regression Forecast for ${targetCol}**\n\n- **Trend Slope:** **${customForecast.slope >= 0 ? '+' : ''}${customForecast.slope.toLocaleString()}** per period\n- **Model Fit (R²):** **${customForecast.rSquared}** (${Math.round(customForecast.rSquared * 100)}% variance explained)\n- **Projected ${horizon}-Period Growth:** **${customForecast.projectedGrowthPct >= 0 ? '+' : ''}${customForecast.projectedGrowthPct}%**\n\n**Projected Future Values:**\n${predLines}`;
    }
  }

  // 4. Highest / Maximum / Top N / Best / Peak Queries
  if (/\b(highest|maximum|max|top|best|peak|largest|most|greatest)\b/.test(q) && targetCol) {
    if (matchedCats.length > 0 && !/\b(row|record|month|period|day)\b/.test(q)) {
      const catCol = matchedCats[0];
      const grouped = {};
      cleanedRows.forEach(r => {
        const k = String(r[catCol]);
        if (!grouped[k]) grouped[k] = { name: k, total: 0, count: 0 };
        grouped[k].total += Number(r[targetCol]) || 0;
        grouped[k].count += 1;
      });
      const ranked = Object.values(grouped).sort((a, b) => b.total - a.total);
      const topN = requestedCount || ranked.length;
      const lines = ranked
        .slice(0, topN)
        .map((g, i) => `${i + 1}. **${g.name}:** Total **${Number(g.total.toFixed(2)).toLocaleString()}** | Avg **${Number((g.total / g.count).toFixed(2)).toLocaleString()}** (${g.count} records)`)
        .join('\n');
      return `**Top ${catCol} Ranked by ${targetCol}**\n\n${lines}`;
    }

    const sortedDesc = [...cleanedRows].sort((a, b) => (Number(b[targetCol]) || 0) - (Number(a[targetCol]) || 0));
    const n = requestedCount || 3;
    const topRows = sortedDesc.slice(0, n);
    const lines = topRows
      .map((r, i) => `${i + 1}. ${formatRowSnippet(r, analysis, targetCol)}`)
      .join('\n');
    return `**Top ${n} Record${n > 1 ? 's' : ''} by ${targetCol} in ${datasetTitle}**\n\n${lines}\n\n- **Peak Value:** **${Number(topRows[0][targetCol]).toLocaleString()}** vs. dataset average of **${stats[targetCol]?.mean.toLocaleString()}**.`;
  }

  // 5. Lowest / Minimum / Bottom N / Worst Queries
  if (/\b(lowest|minimum|min|bottom|worst|smallest|least)\b/.test(q) && targetCol) {
    const sortedAsc = [...cleanedRows].sort((a, b) => (Number(a[targetCol]) || 0) - (Number(b[targetCol]) || 0));
    const n = requestedCount || 3;
    const bottomRows = sortedAsc.slice(0, n);
    const lines = bottomRows
      .map((r, i) => `${i + 1}. ${formatRowSnippet(r, analysis, targetCol)}`)
      .join('\n');
    return `**Lowest ${n} Record${n > 1 ? 's' : ''} by ${targetCol} in ${datasetTitle}**\n\n${lines}\n\n- **Minimum Value:** **${Number(bottomRows[0][targetCol]).toLocaleString()}** vs. dataset average of **${stats[targetCol]?.mean.toLocaleString()}**.`;
  }

  // 6. Specific Metric Statistics Queries
  if (/\b(average|avg|mean|median|mode|total|sum|std|standard deviation|variance|range|stats|statistics)\b/.test(q) && targetCol && stats[targetCol]) {
    const s = stats[targetCol];
    return `**Statistical Breakdown for ${targetCol} (${datasetTitle})**\n\n- **Total (Sum):** **${s.sum.toLocaleString()}**\n- **Mean (Average):** **${s.mean.toLocaleString()}**\n- **Median (50th Percentile):** **${s.median.toLocaleString()}**\n- **Mode:** **${s.mode.toLocaleString()}**\n- **Standard Deviation:** **${s.stdDev.toLocaleString()}**\n- **Min / Max Range:** **${s.min.toLocaleString()}** to **${s.max.toLocaleString()}** (across ${s.count} records)`;
  }

  // 7. Group-By / Breakdown / Compare by Category Queries
  if (/\b(by|breakdown|group|compare|segment|category|region|department|plan|tier|distribution)\b/.test(q) && groupCol && targetCol) {
    const grouped = {};
    cleanedRows.forEach(r => {
      const k = String(r[groupCol]);
      if (!grouped[k]) grouped[k] = { name: k, total: 0, count: 0 };
      grouped[k].total += Number(r[targetCol]) || 0;
      grouped[k].count += 1;
    });
    const ranked = Object.values(grouped).sort((a, b) => b.total - a.total);
    const grandTotal = ranked.reduce((acc, g) => acc + g.total, 0) || 1;
    const lines = ranked
      .map((g, i) => {
        const share = ((g.total / grandTotal) * 100).toFixed(1);
        return `${i + 1}. **${g.name}:** Total **${Number(g.total.toFixed(2)).toLocaleString()}** (**${share}%** share) | Avg **${Number((g.total / g.count).toFixed(2)).toLocaleString()}** (${g.count} rows)`;
      })
      .join('\n');
    return `**${targetCol} Breakdown Grouped by ${groupCol}**\n\n${lines}`;
  }

  // 8. Correlation / Relationship / Driver Queries
  if (/\b(correlat|drive|driver|relationship|impact|affect|cause|factor|link|between)\b/.test(q)) {
    if (!correlations.length) {
      return `Only one numeric column (**${targetCol}**) is present in *${datasetTitle}*, so pairwise correlation requires at least two numeric features.`;
    }
    const relevant = matchedNums.length
      ? correlations.filter(c => matchedNums.includes(c.colA) || matchedNums.includes(c.colB))
      : correlations;
    const listToShow = (relevant.length ? relevant : correlations).slice(0, 4);
    const topCorr = listToShow[0];
    const lines = listToShow
      .map(c => `- **${c.pair}:** **r = ${c.r}** (${Math.abs(c.r) >= 0.7 ? 'Strong' : Math.abs(c.r) >= 0.4 ? 'Moderate' : 'Weak'} ${c.r >= 0 ? 'positive' : 'negative'} correlation)`)
      .join('\n');
    return `**Correlation & Driver Analysis — ${datasetTitle}**\n\n${lines}\n\n- **Key Insight:** **${topCorr.colA}** and **${topCorr.colB}** show the strongest linear relationship (**r = ${topCorr.r}**).`;
  }

  // 9. Actionable Recommendations Queries
  if (/\b(recommend|recommendation|action|improve|strategy|advice|should we|optimize|grow|increase)\b/.test(q)) {
    const segList = getSegmentBreakdown(analysis, targetCol);
    const bestSeg = segList[0];
    const leadCorr = correlations[0];
    const metricStat = stats[targetCol];
    const recs = [
      bestSeg
        ? `- **Scale High-Yield Segment (${bestSeg.dimension}):** Allocate additional budget and capacity to **${bestSeg.name}**, which averages **${bestSeg.average.toLocaleString()}** ${targetCol} per record.`
        : `- **Replicate Top Intervals:** Standardize workflows from peak ${targetCol} periods across all operations.`,
      leadCorr
        ? `- **Leverage Key Driver (${leadCorr.colA}):** Since **${leadCorr.colA}** correlates strongly with **${leadCorr.colB}** (**r = ${leadCorr.r}**), optimizing **${leadCorr.colA}** offers the highest leverage for lifting **${targetCol}**.`
        : `- **Expand Driver Tracking:** Capture additional operational variables to uncover stronger growth levers.`,
      metricStat
        ? `- **Target Benchmark:** Aim to lift underperforming records closer to the dataset median of **${metricStat.median.toLocaleString()}** (current peak: **${metricStat.max.toLocaleString()}**).`
        : null
    ].filter(Boolean).join('\n');

    return `**Strategic Recommendations for ${targetCol} (${datasetTitle})**\n\n${recs}`;
  }

  // 10. Conversational Intent-Aware Response when user asks an open-ended question
  const primaryStat = stats[targetCol];
  const topCorr = correlations[0];
  const segments = getSegmentBreakdown(analysis, targetCol);
  const topSeg = segments[0];

  return `I took a look at **${datasetTitle}** regarding *"${question.trim()}"*. Here is what stands out right away:\n\n- **${targetCol} Performance:** Across **${preprocessingReport.finalRowCount} clean records**, **${targetCol}** averages **${primaryStat?.mean.toLocaleString()}** (totaling **${primaryStat?.sum.toLocaleString()}**, ranging from **${primaryStat?.min.toLocaleString()}** to **${primaryStat?.max.toLocaleString()}**).\n${topSeg ? `- **Top Performer:** **${topSeg.name}** (${topSeg.dimension}) leads with **${topSeg.total.toLocaleString()}** total **${targetCol}**.\n` : ''}${topCorr ? `- **Key Relationship:** **${topCorr.pair}** moves together with a correlation of **r = ${topCorr.r}**.\n` : ''}\nIf you meant something more specific—like filtering a certain ${groupCol || 'category'}, checking top/bottom rows, or forecasting future periods—just tell me which column or group you want to focus on!`;
}

// --- GEMINI API CLIENT WITH BACKGROUND KEY BINDING & REAL-TIME FALLBACK ---
function getBackgroundGeminiKey() {
  try {
    if (typeof window !== 'undefined' && window.__GEMINI_API_KEY__) {
      return String(window.__GEMINI_API_KEY__).trim();
    }
  } catch (_) {}
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) {
      return String(import.meta.env.VITE_GEMINI_API_KEY).trim();
    }
  } catch (_) {}
  try {
    if (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) {
      return String(process.env.GEMINI_API_KEY).trim();
    }
  } catch (_) {}
  return '';
}

async function queryGeminiOrFallback({
  contents,
  systemInstruction,
  onFallback
}) {
  const apiKey = getBackgroundGeminiKey();
  const models = ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'];

  for (const model of models) {
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const apiUrl = apiKey ? `${baseUrl}?key=${encodeURIComponent(apiKey)}` : baseUrl;
    const payload = {
      contents,
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      }
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          return { text: text.trim(), source: 'gemini', model };
        }
      }
    } catch (_) {
      // Silently proceed to next active Gemini model or real-time query engine
    }
  }

  // Seamless real-time query-aware analytical engine fallback
  const fallbackText = onFallback();
  return { text: fallbackText, source: 'local', model: 'Real-Time Data Analyst Engine' };
}

// --- CLEAN MARKDOWN RENDERER FOR BRIEF & CHAT BUBBLES ---
function FormattedMarkdown({ text, isUser = false, isDark = false }) {
  if (!text) return null;
  const lines = text.split('\n');

  const renderInlineBold = (str) => {
    const parts = str.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong
            key={i}
            className={
              isUser
                ? 'font-bold text-white'
                : isDark
                ? 'font-bold text-[#F7F7F5]'
                : 'font-bold text-[#1C1F26]'
            }
          >
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="space-y-2">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;

        if (trimmed.startsWith('### ')) {
          return (
            <h4
              key={idx}
              className={`text-sm font-extrabold pt-2 pb-0.5 tracking-tight ${
                isUser
                  ? 'text-white'
                  : isDark
                  ? 'text-[#6B85FF]'
                  : 'text-[#3B5BFD]'
              }`}
            >
              {trimmed.replace(/^###\s+/, '')}
            </h4>
          );
        }

        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span
                className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                  isUser ? 'bg-blue-200' : isDark ? 'bg-[#5B76FF]' : 'bg-[#3B5BFD]'
                }`}
              />
              <div className="flex-1">{renderInlineBold(trimmed.slice(2))}</div>
            </div>
          );
        }

        const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span
                className={`font-bold shrink-0 ${
                  isUser ? 'text-blue-200' : isDark ? 'text-[#5B76FF]' : 'text-[#3B5BFD]'
                }`}
              >
                {numMatch[1]}
              </span>
              <div className="flex-1">{renderInlineBold(numMatch[2])}</div>
            </div>
          );
        }

        return <p key={idx}>{renderInlineBold(trimmed)}</p>;
      })}
    </div>
  );
}

export default function App() {
  // Theme State (Light / Dark Mode)
  const [isDark, setIsDark] = useState(false);

  // Active Dataset State
  const [datasetKey, setDatasetKey] = useState('retail');
  const [datasetTitle, setDatasetTitle] = useState(SAMPLE_DATASETS.retail.name);
  const [rawCSV, setRawCSV] = useState(SAMPLE_DATASETS.retail.raw);
  const [uploadError, setUploadError] = useState('');

  // Navigation Tabs (Phase 7 Dashboard)
  const [activeTab, setActiveTab] = useState('overview');

  // Visualization Controls (Phase 4)
  const [chartType, setChartType] = useState('bar');
  const [xAxisCol, setXAxisCol] = useState('');
  const [yAxisCol, setYAxisCol] = useState('');
  const [secondaryYCol, setSecondaryYCol] = useState('');

  // Forecasting Controls (Phase 6)
  const [forecastTarget, setForecastTarget] = useState('');
  const [forecastHorizon, setForecastHorizon] = useState(4);

  // AI Copilot State (Phase 5)
  const [aiReport, setAiReport] = useState(null);
  const [aiReportSource, setAiReportSource] = useState('local');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      source: 'local',
      text: `Hi there! 👋 I'm your **AI Data Analyst Copilot**. I've loaded **${SAMPLE_DATASETS.retail.name}** and cleaned the records for you.\n\nSay **"hi"** for a quick question menu, or ask me anything in plain English—like comparing categories, finding top rows, or predicting future sales!`
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const chatFeedRef = useRef(null);
  const submitLockRef = useRef(false);

  // Auto-scroll strictly inside the chat container (prevents awkward page jumps)
  useEffect(() => {
    const el = chatFeedRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chatMessages, isChatLoading]);

  // Run Phases 1, 2, 3 Pipeline
  const analysis = useMemo(() => {
    const { headers, rows } = parseCSV(rawCSV);
    if (!headers.length || !rows.length) return null;
    return runPreprocessingAndStats(headers, rows);
  }, [rawCSV]);

  // Synchronize default column selections when dataset changes
  useEffect(() => {
    if (!analysis) return;
    const { categoricalCols, numericCols, headers } = analysis;
    setXAxisCol(categoricalCols[0] || headers[0] || '');
    setYAxisCol(numericCols[0] || '');
    setSecondaryYCol(numericCols[1] || '');
    setForecastTarget(numericCols[1] || numericCols[0] || '');
    setAiReport(null);
  }, [analysis]);

  // Run Phase 6 Forecast
  const forecastData = useMemo(() => {
    if (!analysis || !forecastTarget) return null;
    const labelCol = analysis.categoricalCols[0] || analysis.headers[0];
    return computeForecast(analysis.cleanedRows, labelCol, forecastTarget, forecastHorizon);
  }, [analysis, forecastTarget, forecastHorizon]);

  // Handle Sample Dataset Switch (resets chat context cleanly so no stale data is referenced)
  const handleSelectSample = (key) => {
    const ds = SAMPLE_DATASETS[key];
    setDatasetKey(key);
    setDatasetTitle(ds.name);
    setRawCSV(ds.raw);
    setUploadError('');
    setAiReport(null);
    setChatMessages([
      {
        role: 'assistant',
        source: 'local',
        text: `Switched active dataset to **${ds.name}**. Preprocessing and statistical profiling are complete—ask me anything or click **Generate AI Insights**!`
      }
    ]);
  };

  // Handle User CSV Upload (Phase 1)
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().endsWith('.txt')) {
      setUploadError('Please upload a valid .CSV file (Excel files can be saved as CSV UTF-8).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string' && content.trim().length > 0) {
        const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
        setDatasetKey('custom');
        setDatasetTitle(cleanTitle);
        setRawCSV(content);
        setUploadError('');
        setAiReport(null);
        setChatMessages([
          {
            role: 'assistant',
            source: 'local',
            text: `Successfully ingested and cleaned **${file.name}**. Conversation context has been reset for your new dataset—ask me any analytical question!`
          }
        ]);
      } else {
        setUploadError('The uploaded file appears to be empty.');
      }
    };
    reader.onerror = () => setUploadError('Failed to read the uploaded file.');
    reader.readAsText(file);
  };

  // Build full dataset & statistical context for Gemini (up to 150 rows + group-bys so any row-level question works)
  const buildDatasetSummaryPrompt = () => {
    if (!analysis) return '';
    const { preprocessingReport, stats, correlations, cleanedRows, categoricalCols, numericCols } = analysis;
    const primaryCol = forecastTarget || numericCols[1] || numericCols[0];
    const segmentBreakdown = getSegmentBreakdown(analysis, primaryCol);

    return JSON.stringify({
      datasetName: datasetTitle,
      rowsAfterCleaning: preprocessingReport.finalRowCount,
      duplicatesRemoved: preprocessingReport.duplicatesRemoved,
      missingValuesImputed: preprocessingReport.missingImputed,
      dataHealthScore: preprocessingReport.qualityScore,
      categoricalColumns: categoricalCols,
      numericColumns: numericCols,
      descriptiveStatistics: stats,
      segmentAggregations: segmentBreakdown,
      topCorrelations: correlations.slice(0, 8),
      forecastSummary: forecastData
        ? {
            targetMetric: forecastTarget,
            slopePerPeriod: forecastData.slope,
            rSquared: forecastData.rSquared,
            projectedGrowthPct: forecastData.projectedGrowthPct,
            nextPeriods: forecastData.futurePredictions
          }
        : null,
      cleanedDatasetRows: cleanedRows.slice(0, 150)
    }, null, 2);
  };

  // Phase 5: Generate Structured AI Executive Insights
  const handleGenerateAIInsights = async () => {
    if (!analysis || isGeneratingReport) return;
    setIsGeneratingReport(true);

    const systemPrompt = `You are a senior AI Data Analyst & Business Intelligence Consultant.
Analyze the provided dataset statistical profile and return a concise, high-impact executive analysis formatted strictly with these 4 markdown headings:
### 1. Key Analytical Findings
### 2. Trend & Correlation Explanations
### 3. Performance Evaluation
### 4. Actionable Strategic Recommendations

Use bullet points with bold lead-ins and cite exact figures from the statistics provided. Keep it sharp, clear, and business-ready.`;

    const userPrompt = `Analyze this dataset profile and generate your Business Intelligence report:\n\n${buildDatasetSummaryPrompt()}`;

    const result = await queryGeminiOrFallback({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: systemPrompt,
      onFallback: () => generateLocalExecutiveBrief(datasetTitle, analysis, forecastData, forecastTarget)
    });

    setAiReport(result.text);
    setAiReportSource(result.source);
    setIsGeneratingReport(false);
  };

  // Phase 5: Interactive Conversational Copilot Q&A (supports multi-turn history + real-time query engine)
  const sendChatMessage = async (rawQuestion) => {
    const userQuestion = rawQuestion.trim();
    if (!userQuestion || !analysis || isChatLoading || submitLockRef.current) return;

    submitLockRef.current = true;
    setChatInput('');
    setIsChatLoading(true);

    const nextHistory = [...chatMessages, { role: 'user', text: userQuestion }];
    setChatMessages(nextHistory);

    const systemPrompt = `You are a warm, attentive, human-like AI Data Analyst & Business Intelligence Copilot for the active dataset "${datasetTitle}".
FIRST, carefully understand the user's conversational intent:
- If the user greets you (e.g., "hi", "hello", "hey"), respond warmly like a helpful human analyst and present a clear, tailored menu of 4–5 example questions they can ask about "${datasetTitle}".
- If the user asks a follow-up question ("why?", "tell me more", "how?"), build directly on your previous answer in the conversation history.
- If the user asks a specific analytical question (rankings, comparisons, filters, averages, correlations, forecasts, or recommendations), answer ONLY what they asked using exact numbers computed from the dataset below—never dump a generic stored summary.
Format replies cleanly with short paragraphs, bullet points, and bold numbers.

FULL DATASET & ANALYTICAL CONTEXT:
${buildDatasetSummaryPrompt()}`;

    // Build clean alternating user/model conversation history for Gemini REST API
    const conversationContents = [];
    const recentHistory = nextHistory.slice(-8);
    recentHistory.forEach((msg) => {
      const cleanText = String(msg.text || '').trim();
      if (!cleanText) return;
      const geminiRole = msg.role === 'user' ? 'user' : 'model';
      if (conversationContents.length === 0 && geminiRole !== 'user') return;

      const lastEntry = conversationContents[conversationContents.length - 1];
      if (lastEntry && lastEntry.role === geminiRole) {
        lastEntry.parts[0].text += `\n\n${cleanText}`;
      } else {
        conversationContents.push({
          role: geminiRole,
          parts: [{ text: cleanText }]
        });
      }
    });

    try {
      const result = await queryGeminiOrFallback({
        contents: conversationContents.length
          ? conversationContents
          : [{ role: 'user', parts: [{ text: userQuestion }] }],
        systemInstruction: systemPrompt,
        onFallback: () =>
          answerDataQuestionRealTime(
            userQuestion,
            datasetTitle,
            analysis,
            forecastData,
            forecastTarget,
            nextHistory
          )
      });

      setChatMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          source: result.source,
          text: result.text
        }
      ]);
    } finally {
      setIsChatLoading(false);
      submitLockRef.current = false;
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    await sendChatMessage(chatInput);
  };

  // Phase 7: Export Full Executive Report (.txt)
  const handleExportReport = () => {
    if (!analysis) return;
    const lines = [
      '====================================================================',
      'AI DATA ANALYST & BUSINESS INTELLIGENCE COPILOT — EXECUTIVE REPORT',
      '====================================================================',
      `Dataset Title: ${datasetTitle}`,
      `Generated On: ${new Date().toLocaleString()}`,
      `Records Analyzed: ${analysis.preprocessingReport.finalRowCount} (Duplicates Removed: ${analysis.preprocessingReport.duplicatesRemoved}, Missing Imputed: ${analysis.preprocessingReport.missingImputed})`,
      `Data Quality Score: ${analysis.preprocessingReport.qualityScore}%`,
      '',
      '--- DESCRIPTIVE STATISTICS (PHASE 3) ---',
      ...Object.entries(analysis.stats).map(
        ([col, s]) =>
          `${col}: Mean=${s.mean}, Median=${s.median}, Mode=${s.mode}, StdDev=${s.stdDev}, Min=${s.min}, Max=${s.max}`
      ),
      '',
      '--- TOP CORRELATIONS ---',
      ...(analysis.correlations.length
        ? analysis.correlations.slice(0, 5).map(c => `${c.pair}: r = ${c.r}`)
        : ['N/A (Single numeric feature)']),
      '',
      '--- PREDICTIVE FORECAST (PHASE 6) ---',
      ...(forecastData
        ? [
            `Target Metric: ${forecastTarget}`,
            `Linear Trend Slope: ${forecastData.slope} / period | R-Squared: ${forecastData.rSquared}`,
            `Projected Growth: ${forecastData.projectedGrowthPct}%`,
            ...forecastData.futurePredictions.map(
              fp => `${fp.period}: Predicted = ${fp.forecast} (80% CI: ${fp.lowerBound} - ${fp.upperBound})`
            )
          ]
        : ['Forecast not computed']),
      '',
      '--- AI BUSINESS INTELLIGENCE BRIEF (PHASE 5) ---',
      aiReport || 'Generate AI Insights in the dashboard prior to exporting for full AI commentary.'
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${datasetTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_bi_report.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Aggregated data for Bar & Pie Charts (Phase 4)
  const aggregatedCategoryData = useMemo(() => {
    if (!analysis || !xAxisCol || !yAxisCol) return [];
    const grouped = {};
    analysis.cleanedRows.forEach(row => {
      const key = String(row[xAxisCol]);
      if (!grouped[key]) {
        grouped[key] = { name: key, value: 0, secondary: 0, count: 0 };
      }
      grouped[key].value += Number(row[yAxisCol]) || 0;
      if (secondaryYCol) {
        grouped[key].secondary += Number(row[secondaryYCol]) || 0;
      }
      grouped[key].count += 1;
    });
    return Object.values(grouped).map(item => ({
      ...item,
      value: Number(item.value.toFixed(2)),
      secondary: Number(item.secondary.toFixed(2))
    }));
  }, [analysis, xAxisCol, yAxisCol, secondaryYCol]);

  // Histogram binning for numeric distribution (Phase 4)
  const histogramData = useMemo(() => {
    if (!analysis || !yAxisCol || !analysis.stats[yAxisCol]) return [];
    const vals = analysis.cleanedRows.map(r => Number(r[yAxisCol]) || 0);
    const min = analysis.stats[yAxisCol].min;
    const max = analysis.stats[yAxisCol].max;
    if (min === max) return [{ range: `${min}`, frequency: vals.length }];

    const binCount = 5;
    const binSize = (max - min) / binCount;
    const bins = Array.from({ length: binCount }, (_, i) => {
      const start = min + i * binSize;
      const end = start + binSize;
      return {
        range: `${Math.round(start)}-${Math.round(end)}`,
        frequency: 0
      };
    });

    vals.forEach(v => {
      let idx = Math.floor((v - min) / binSize);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) idx = 0;
      bins[idx].frequency += 1;
    });
    return bins;
  }, [analysis, yAxisCol]);

  // Primary KPI metrics
  const primaryMetric = analysis?.numericCols[1] || analysis?.numericCols[0] || '';
  const secondaryMetric = analysis?.numericCols[0] || '';

  const gridStroke = isDark ? '#262A34' : '#E5E5E0';
  const tickFill = isDark ? '#9CA3AF' : '#4B5563';
  const tooltipStyle = isDark
    ? {
        backgroundColor: '#181B22',
        borderRadius: '12px',
        borderColor: '#3B5BFD',
        color: '#F7F7F5',
        fontSize: '12px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
      }
    : {
        backgroundColor: '#1C1F26',
        borderRadius: '12px',
        borderColor: '#3B5BFD',
        color: '#F7F7F5',
        fontSize: '12px',
        boxShadow: '0 10px 25px -5px rgba(28, 31, 38, 0.25)'
      };

  return (
    <div
      className={`min-h-screen flex flex-col font-sans relative overflow-x-clip transition-colors duration-300 ${
        isDark ? 'bg-[#0C0E12] text-[#F7F7F5]' : 'bg-[#F7F7F5] text-[#1C1F26]'
      }`}
    >
      {/* HEADER BAR */}
      <header
        className={`border-b sticky top-0 z-30 transition-colors duration-300 ${
          isDark
            ? 'bg-[#151820]/95 border-[#262A34] backdrop-blur-xl shadow-lg shadow-black/30'
            : 'bg-[#1C1F26] border-[#2B303B] text-[#F7F7F5] shadow-md shadow-[#1C1F26]/10'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B5BFD] to-[#2541D8] flex items-center justify-center text-white shadow-md shadow-[#3B5BFD]/30">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-[#F7F7F5]">
                AI Data Analyst &{' '}
                <span className="text-[#6B85FF]">BI Copilot</span>
              </h1>
              <p className="text-xs hidden sm:block text-slate-400">
                Automated Profiling • Statistical Engine • ML Forecasting • Gemini Advisory
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={() => setIsDark(prev => !prev)}
              aria-label={isDark ? 'Switch to Soft Off-White Mode' : 'Switch to Dark Charcoal Mode'}
              title={isDark ? 'Switch to Soft Off-White Mode' : 'Switch to Dark Charcoal Mode'}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#272B35] border border-[#363B47] text-[#F7F7F5] hover:bg-[#323744] transition-all duration-200 cursor-pointer active:scale-95"
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-[#8CA2FF]" />}
              <span className="hidden md:inline">{isDark ? 'Off-White' : 'Dark'}</span>
            </button>

            {/* Phase 1: Upload CSV Button */}
            <label className="cursor-pointer inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#272B35] border border-[#363B47] text-[#F7F7F5] hover:bg-[#323744] hover:border-[#3B5BFD]/60 transition-all duration-200 active:scale-95">
              <Upload className="w-4 h-4 text-[#6B85FF]" />
              <span>Upload CSV</span>
              <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
            </label>

            {/* Phase 7: Export Executive Report */}
            <button
              onClick={handleExportReport}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#3B5BFD] hover:bg-[#2E4CEB] text-white transition-all duration-200 shadow-md shadow-[#3B5BFD]/30 cursor-pointer active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export Report</span>
            </button>
          </div>
        </div>
      </header>

      {/* SAMPLE DATASETS SUB-RIBBON */}
      <div
        className={`relative z-10 border-b transition-colors ${
          isDark
            ? 'bg-[#181B22] border-[#262A34] text-[#F7F7F5]'
            : 'bg-[#252932] border-[#323743] text-[#F7F7F5]'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mr-1">
              <Database className="w-3.5 h-3.5 text-[#6B85FF]" />
              Sample Datasets:
            </span>
            {Object.entries(SAMPLE_DATASETS).map(([key, ds]) => (
              <button
                key={key}
                onClick={() => handleSelectSample(key)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer ${
                  datasetKey === key
                    ? 'bg-[#3B5BFD] text-white shadow-sm shadow-[#3B5BFD]/40'
                    : 'bg-[#313642] text-slate-300 hover:bg-[#3B414F] hover:text-white'
                }`}
              >
                {ds.name.split(' (')[0]}
              </button>
            ))}
          </div>

          {analysis && (
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Data Health: {analysis.preprocessingReport.qualityScore}%
              </span>
              <span className="px-2.5 py-1 rounded-md bg-[#313642] text-slate-300 font-medium">
                {analysis.preprocessingReport.finalRowCount} Rows
              </span>
              <span className="px-2.5 py-1 rounded-md bg-[#313642] text-slate-300 font-medium">
                {analysis.headers.length} Features
              </span>
            </div>
          )}
        </div>
      </div>

      {uploadError && (
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-red-500/10 border border-red-500/30 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* PHASE 7: TOP KPI CARDS */}
        {analysis && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1 */}
            <div
              className={`group relative overflow-hidden p-5 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 ${
                isDark
                  ? 'bg-[#181B22] border-[#262A34] hover:border-[#3B5BFD]/60'
                  : 'bg-[#FFFFFF] border-[#E4E4DF] hover:border-[#3B5BFD]/60 shadow-[0_2px_10px_rgba(28,31,38,0.03)]'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                <span>Total {primaryMetric.replace(/_/g, ' ')}</span>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-[#3B5BFD]/20 text-[#6B85FF]' : 'bg-[#EEF1FF] text-[#3B5BFD]'}`}>
                  <BarChart3 className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                  {analysis.stats[primaryMetric]?.sum.toLocaleString()}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Avg: <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-[#1C1F26]'}`}>{analysis.stats[primaryMetric]?.mean.toLocaleString()}</span> / record
              </p>
            </div>

            {/* KPI 2 */}
            <div
              className={`group relative overflow-hidden p-5 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 ${
                isDark
                  ? 'bg-[#181B22] border-[#262A34] hover:border-[#3B5BFD]/60'
                  : 'bg-[#FFFFFF] border-[#E4E4DF] hover:border-[#3B5BFD]/60 shadow-[0_2px_10px_rgba(28,31,38,0.03)]'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                <span>Mean {secondaryMetric.replace(/_/g, ' ')}</span>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-[#262A34] text-slate-300' : 'bg-[#F2F2EE] text-[#1C1F26]'}`}>
                  <Activity className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                  {analysis.stats[secondaryMetric]?.mean.toLocaleString()}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Range: {analysis.stats[secondaryMetric]?.min.toLocaleString()} – {analysis.stats[secondaryMetric]?.max.toLocaleString()}
              </p>
            </div>

            {/* KPI 3 */}
            <div
              className={`group relative overflow-hidden p-5 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 ${
                isDark
                  ? 'bg-[#181B22] border-[#262A34] hover:border-[#3B5BFD]/60'
                  : 'bg-[#FFFFFF] border-[#E4E4DF] hover:border-[#3B5BFD]/60 shadow-[0_2px_10px_rgba(28,31,38,0.03)]'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                <span>Automated Cleaning</span>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-[#262A34] text-slate-300' : 'bg-[#F2F2EE] text-[#1C1F26]'}`}>
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                  {analysis.preprocessingReport.duplicatesRemoved + analysis.preprocessingReport.missingImputed} Fixes
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {analysis.preprocessingReport.duplicatesRemoved} duplicates • {analysis.preprocessingReport.missingImputed} imputed
              </p>
            </div>

            {/* KPI 4 */}
            <div
              className={`group relative overflow-hidden p-5 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 ${
                isDark
                  ? 'bg-[#181B22] border-[#262A34] hover:border-[#3B5BFD]/60'
                  : 'bg-[#FFFFFF] border-[#E4E4DF] hover:border-[#3B5BFD]/60 shadow-[0_2px_10px_rgba(28,31,38,0.03)]'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                <span>ML Forecast ({forecastTarget.replace(/_/g, ' ')})</span>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? 'bg-[#3B5BFD]/20 text-[#6B85FF]' : 'bg-[#EEF1FF] text-[#3B5BFD]'}`}>
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                  {forecastData ? `${forecastData.projectedGrowthPct >= 0 ? '+' : ''}${forecastData.projectedGrowthPct}%` : 'N/A'}
                </span>
                {forecastData && (
                  <span
                    className={`inline-flex items-center text-xs font-bold px-2.5 py-0.5 rounded-full ${
                      forecastData.projectedGrowthPct >= 0
                        ? isDark ? 'bg-[#3B5BFD]/20 text-[#8CA2FF]' : 'bg-[#EEF1FF] text-[#3B5BFD]'
                        : 'bg-rose-500/15 text-rose-600'
                    }`}
                  >
                    {forecastData.projectedGrowthPct >= 0 ? (
                      <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                    )}
                    R² {forecastData.rSquared}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {forecastHorizon}-period OLS trend projection
              </p>
            </div>
          </div>
        )}

        {/* NAVIGATION BAR */}
        <div
          className={`p-1.5 rounded-2xl border flex flex-wrap gap-1.5 ${
            isDark
              ? 'bg-[#181B22] border-[#262A34]'
              : 'bg-[#ECECE7] border-[#DFDFD9]'
          }`}
        >
          {[
            { id: 'overview', label: '1. Overview & AI Copilot', icon: Sparkles },
            { id: 'visuals', label: '2. Interactive Visuals', icon: PieChartIcon },
            { id: 'forecast', label: '3. Predictive ML Forecast', icon: TrendingUp },
            { id: 'cleaning', label: '4. Data Cleaning & Stats', icon: TableIcon }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-[150px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                  active
                    ? 'bg-[#3B5BFD] text-white shadow-sm shadow-[#3B5BFD]/30'
                    : isDark
                    ? 'text-slate-400 hover:bg-[#222630] hover:text-[#F7F7F5]'
                    : 'text-[#1C1F26]/75 hover:bg-[#FFFFFF]/80 hover:text-[#1C1F26]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ===================================================================== */}
        {/* TAB 1: EXECUTIVE OVERVIEW & PHASE 5 GEMINI AI COPILOT                 */}
        {/* ===================================================================== */}
        {activeTab === 'overview' && analysis && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: AI Strategic Report Generator (Phase 5) */}
            <div className="lg:col-span-7 space-y-6">
              <div
                className={`rounded-2xl border p-6 transition-all ${
                  isDark
                    ? 'bg-[#181B22] border-[#262A34]'
                    : 'bg-[#FFFFFF] border-[#E4E4DF] shadow-[0_2px_12px_rgba(28,31,38,0.03)]'
                }`}
              >
                <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b ${isDark ? 'border-[#262A34]' : 'border-[#ECECE7]'}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-[#6B85FF]' : 'text-[#3B5BFD]'}`}>
                        Phase 5 • AI Business Consultant
                      </span>
                      {aiReport && (
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            isDark ? 'bg-[#3B5BFD]/20 text-[#8CA2FF]' : 'bg-[#EEF1FF] text-[#3B5BFD]'
                          }`}
                        >
                          <Cpu className="w-3 h-3" />
                          {aiReportSource === 'gemini' ? 'Gemini AI Copilot' : 'Smart Analyst Engine'}
                        </span>
                      )}
                    </div>
                    <h2 className={`text-lg font-extrabold mt-0.5 ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                      Automated Business Intelligence Brief
                    </h2>
                  </div>
                  <button
                    onClick={handleGenerateAIInsights}
                    disabled={isGeneratingReport}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#3B5BFD] hover:bg-[#2E4CEB] text-white disabled:opacity-60 transition-all shadow-sm shadow-[#3B5BFD]/25 cursor-pointer active:scale-95"
                  >
                    {isGeneratingReport ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Analyzing Dataset...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>{aiReport ? 'Regenerate Insights' : 'Generate AI Insights'}</span>
                      </>
                    )}
                  </button>
                </div>

                {!aiReport && !isGeneratingReport && (
                  <div className="py-10 text-center space-y-3">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${isDark ? 'bg-[#3B5BFD]/15 text-[#6B85FF]' : 'bg-[#EEF1FF] text-[#3B5BFD]'}`}>
                      <BrainCircuit className="w-7 h-7" />
                    </div>
                    <h3 className={`text-sm font-bold ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                      Ready to Synthesize Executive Insights
                    </h3>
                    <p className="text-xs max-w-md mx-auto leading-relaxed text-slate-500">
                      Click <strong>Generate AI Insights</strong> to synthesize your cleaned dataset profile, correlation matrix, and ML trend metrics into a 4-part strategic brief.
                    </p>
                  </div>
                )}

                {isGeneratingReport && (
                  <div className="py-10 space-y-3">
                    <div className={`h-4 rounded-lg w-3/4 animate-pulse ${isDark ? 'bg-[#262A34]' : 'bg-[#EFEFEB]'}`}></div>
                    <div className={`h-4 rounded-lg w-full animate-pulse ${isDark ? 'bg-[#262A34]' : 'bg-[#EFEFEB]'}`}></div>
                    <div className={`h-4 rounded-lg w-5/6 animate-pulse ${isDark ? 'bg-[#262A34]' : 'bg-[#EFEFEB]'}`}></div>
                    <div className={`h-4 rounded-lg w-2/3 animate-pulse ${isDark ? 'bg-[#262A34]' : 'bg-[#EFEFEB]'}`}></div>
                  </div>
                )}

                {aiReport && !isGeneratingReport && (
                  <div className={`mt-5 text-xs sm:text-sm leading-relaxed ${isDark ? 'text-slate-300' : 'text-[#2C303A]'}`}>
                    <FormattedMarkdown text={aiReport} isDark={isDark} />
                  </div>
                )}
              </div>

              {/* Quick Snapshot Chart */}
              <div
                className={`rounded-2xl border p-6 transition-all ${
                  isDark
                    ? 'bg-[#181B22] border-[#262A34]'
                    : 'bg-[#FFFFFF] border-[#E4E4DF] shadow-[0_2px_12px_rgba(28,31,38,0.03)]'
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className={`text-sm font-extrabold ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                      Performance Distribution ({yAxisCol.replace(/_/g, ' ')} by {xAxisCol.replace(/_/g, ' ')})
                    </h3>
                    <p className="text-xs text-slate-500">Aggregated view from cleaned dataset</p>
                  </div>
                  <button
                    onClick={() => setActiveTab('visuals')}
                    className={`text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition ${isDark ? 'text-[#6B85FF] hover:text-[#8CA2FF]' : 'text-[#3B5BFD] hover:text-[#2E4CEB]'}`}
                  >
                    Explore All Charts <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={aggregatedCategoryData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: tickFill }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: tickFill }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: isDark ? 'rgba(59,91,253,0.1)' : 'rgba(59,91,253,0.06)' }} />
                      <Bar dataKey="value" name={yAxisCol} fill="#3B5BFD" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Right Column: Interactive Conversational Dataset Copilot */}
            <div
              className={`lg:col-span-5 rounded-2xl border flex flex-col h-[650px] overflow-hidden transition-all ${
                isDark
                  ? 'bg-[#181B22] border-[#262A34]'
                  : 'bg-[#FFFFFF] border-[#E4E4DF] shadow-[0_4px_16px_rgba(28,31,38,0.05)]'
              }`}
            >
              {/* Chat Header */}
              <div className="p-4 bg-[#1C1F26] text-[#F7F7F5] border-b border-[#2B303B] flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-xl bg-[#3B5BFD] text-white flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#1C1F26]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-[#F7F7F5]">Ask the BI Copilot</h3>
                    <p className="text-[11px] text-[#8CA2FF] font-medium truncate max-w-[210px]">
                      Live Context: {datasetTitle}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-md shrink-0 bg-[#272B35] text-[#8CA2FF] border border-[#363B47]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3B5BFD] animate-pulse" />
                  Conversational AI
                </span>
              </div>

              {/* Chat Messages Feed */}
              <div ref={chatFeedRef} className={`flex-1 overflow-y-auto p-4 space-y-3.5 ${isDark ? 'bg-[#12141A]' : 'bg-[#F7F7F5]'}`}>
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#3B5BFD] text-white rounded-br-xs shadow-sm shadow-[#3B5BFD]/25'
                          : isDark
                          ? 'bg-[#1C1F26] border border-[#2B303B] text-slate-200 rounded-bl-xs'
                          : 'bg-[#FFFFFF] border border-[#E4E4DF] text-[#1C1F26] rounded-bl-xs shadow-2xs'
                      }`}
                    >
                      <FormattedMarkdown text={msg.text} isUser={msg.role === 'user'} isDark={isDark} />
                    </div>
                    {msg.role === 'assistant' && msg.source && (
                      <span className="text-[10px] text-slate-400 mt-1 px-1">
                        {msg.source === 'gemini' ? 'Gemini AI Copilot' : 'Smart Analyst Engine'}
                      </span>
                    )}
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className={`border rounded-2xl px-4 py-2.5 text-xs flex items-center gap-2 ${isDark ? 'bg-[#1C1F26] border-[#2B303B] text-slate-300' : 'bg-[#FFFFFF] border-[#E4E4DF] text-[#1C1F26]'}`}>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#3B5BFD]" />
                      <span>Understanding your question...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Suggested Quick Prompts */}
              <div className={`px-4 py-2.5 border-t flex gap-1.5 overflow-x-auto ${isDark ? 'border-[#262A34] bg-[#181B22]' : 'border-[#E4E4DF] bg-[#FFFFFF]'}`}>
                {[
                  `Hi! What can I ask?`,
                  `Highest ${primaryMetric || 'metric'} rows`,
                  `Compare ${primaryMetric || 'metric'} by ${analysis.categoricalCols[1] || analysis.categoricalCols[0] || 'category'}`,
                  `Predict next 3 periods`
                ].map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={isChatLoading}
                    onClick={() => sendChatMessage(q)}
                    className={`shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all cursor-pointer disabled:opacity-50 ${
                      isDark
                        ? 'bg-[#222630] border-[#2E3340] hover:border-[#3B5BFD] hover:text-[#8CA2FF] text-slate-300'
                        : 'bg-[#F7F7F5] border-[#E4E4DF] hover:bg-[#EEF1FF] hover:border-[#3B5BFD]/40 hover:text-[#3B5BFD] text-[#1C1F26]'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>

              {/* Chat Input Form */}
              <form
                onSubmit={handleSendChat}
                className={`p-3 border-t flex items-end gap-2 ${isDark ? 'border-[#262A34] bg-[#181B22]' : 'border-[#E4E4DF] bg-[#FFFFFF]'}`}
              >
                <textarea
                  rows={1}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChatMessage(chatInput);
                    }
                  }}
                  placeholder="Say hi or ask anything about your data... (Enter to send)"
                  className={`flex-1 text-sm px-3.5 py-2.5 rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#3B5BFD]/30 focus:border-[#3B5BFD] resize-none max-h-24 transition ${
                    isDark
                      ? 'bg-[#12141A] border-[#2B303B] text-[#F7F7F5] placeholder-slate-500'
                      : 'bg-[#F7F7F5] border-[#DFDFD9] text-[#1C1F26] placeholder-slate-400 focus:bg-white'
                  }`}
                />
                <button
                  type="submit"
                  disabled={isChatLoading || !chatInput.trim()}
                  className="px-4 py-2.5 rounded-xl bg-[#3B5BFD] hover:bg-[#2E4CEB] text-white disabled:opacity-50 transition-all shadow-sm shadow-[#3B5BFD]/25 cursor-pointer shrink-0 active:scale-95"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 2: PHASE 4 INTERACTIVE VISUALIZATION STUDIO                       */}
        {/* ===================================================================== */}
        {activeTab === 'visuals' && analysis && (
          <div className="space-y-6">
            {/* Control Panel */}
            <div className={`p-5 rounded-2xl border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 ${isDark ? 'bg-[#181B22] border-[#262A34]' : 'bg-[#FFFFFF] border-[#E4E4DF]'}`}>
              <div>
                <label className={`block text-xs font-bold mb-1.5 ${isDark ? 'text-slate-300' : 'text-[#1C1F26]'}`}>
                  Chart Visualization Type
                </label>
                <select
                  value={chartType}
                  onChange={e => setChartType(e.target.value)}
                  className={`w-full text-sm rounded-xl border px-3 py-2 focus:outline-none focus:border-[#3B5BFD] ${isDark ? 'bg-[#12141A] border-[#2B303B] text-[#F7F7F5]' : 'bg-[#F7F7F5] border-[#DFDFD9] text-[#1C1F26]'}`}
                >
                  <option value="bar">Bar Chart (Category Comparison)</option>
                  <option value="line">Line Chart (Trend Analysis)</option>
                  <option value="pie">Pie / Donut Chart (Share Distribution)</option>
                  <option value="scatter">Scatter Plot (Correlation View)</option>
                  <option value="histogram">Histogram (Frequency Distribution)</option>
                </select>
              </div>

              <div>
                <label className={`block text-xs font-bold mb-1.5 ${isDark ? 'text-slate-300' : 'text-[#1C1F26]'}`}>
                  X-Axis / Dimension
                </label>
                <select
                  value={xAxisCol}
                  onChange={e => setXAxisCol(e.target.value)}
                  className={`w-full text-sm rounded-xl border px-3 py-2 focus:outline-none focus:border-[#3B5BFD] ${isDark ? 'bg-[#12141A] border-[#2B303B] text-[#F7F7F5]' : 'bg-[#F7F7F5] border-[#DFDFD9] text-[#1C1F26]'}`}
                >
                  {analysis.headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-xs font-bold mb-1.5 ${isDark ? 'text-slate-300' : 'text-[#1C1F26]'}`}>
                  Primary Numeric Metric (Y-Axis)
                </label>
                <select
                  value={yAxisCol}
                  onChange={e => setYAxisCol(e.target.value)}
                  className={`w-full text-sm rounded-xl border px-3 py-2 focus:outline-none focus:border-[#3B5BFD] ${isDark ? 'bg-[#12141A] border-[#2B303B] text-[#F7F7F5]' : 'bg-[#F7F7F5] border-[#DFDFD9] text-[#1C1F26]'}`}
                >
                  {analysis.numericCols.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-xs font-bold mb-1.5 ${isDark ? 'text-slate-300' : 'text-[#1C1F26]'}`}>
                  Secondary Metric (Scatter / Compare)
                </label>
                <select
                  value={secondaryYCol}
                  onChange={e => setSecondaryYCol(e.target.value)}
                  className={`w-full text-sm rounded-xl border px-3 py-2 focus:outline-none focus:border-[#3B5BFD] ${isDark ? 'bg-[#12141A] border-[#2B303B] text-[#F7F7F5]' : 'bg-[#F7F7F5] border-[#DFDFD9] text-[#1C1F26]'}`}
                >
                  <option value="">None</option>
                  {analysis.numericCols.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Interactive Chart Canvas */}
            <div className={`p-6 rounded-2xl border ${isDark ? 'bg-[#181B22] border-[#262A34]' : 'bg-[#FFFFFF] border-[#E4E4DF]'}`}>
              <div className="mb-4">
                <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-[#6B85FF]' : 'text-[#3B5BFD]'}`}>
                  Phase 4 • Interactive Data Visualization
                </span>
                <h3 className={`text-lg font-extrabold ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                  {chartType === 'histogram'
                    ? `Frequency Distribution of ${yAxisCol}`
                    : chartType === 'scatter'
                    ? `Correlation Scatter: ${yAxisCol} vs ${secondaryYCol || xAxisCol}`
                    : `${yAxisCol} across ${xAxisCol}`}
                </h3>
              </div>

              <div className="h-96 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'bar' ? (
                    <BarChart data={aggregatedCategoryData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: tickFill }} />
                      <YAxis tick={{ fontSize: 12, fill: tickFill }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar dataKey="value" name={yAxisCol} fill="#3B5BFD" radius={[6, 6, 0, 0]} />
                      {secondaryYCol && (
                        <Bar dataKey="secondary" name={secondaryYCol} fill={isDark ? '#64748B' : '#1C1F26'} radius={[6, 6, 0, 0]} />
                      )}
                    </BarChart>
                  ) : chartType === 'line' ? (
                    <LineChart data={analysis.cleanedRows}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey={xAxisCol} tick={{ fontSize: 12, fill: tickFill }} />
                      <YAxis tick={{ fontSize: 12, fill: tickFill }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                      <Line type="monotone" dataKey={yAxisCol} stroke="#3B5BFD" strokeWidth={3} dot={{ r: 4 }} />
                      {secondaryYCol && (
                        <Line type="monotone" dataKey={secondaryYCol} stroke={isDark ? '#94A3B8' : '#1C1F26'} strokeWidth={2.5} dot={{ r: 3 }} />
                      )}
                    </LineChart>
                  ) : chartType === 'pie' ? (
                    <PieChart>
                      <Pie
                        data={aggregatedCategoryData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={130}
                        paddingAngle={3}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {aggregatedCategoryData.map((_, idx) => (
                          <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend />
                    </PieChart>
                  ) : chartType === 'scatter' ? (
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis
                        type="number"
                        dataKey={secondaryYCol || yAxisCol}
                        name={secondaryYCol || yAxisCol}
                        tick={{ fontSize: 12, fill: tickFill }}
                      />
                      <YAxis type="number" dataKey={yAxisCol} name={yAxisCol} tick={{ fontSize: 12, fill: tickFill }} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={tooltipStyle} />
                      <Scatter name="Records" data={analysis.cleanedRows} fill="#3B5BFD" />
                    </ScatterChart>
                  ) : (
                    <BarChart data={histogramData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="range" tick={{ fontSize: 12, fill: tickFill }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: tickFill }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="frequency" name="Record Frequency" fill="#3B5BFD" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 3: PHASE 6 PREDICTIVE ANALYTICS & ML FORECASTING                  */}
        {/* ===================================================================== */}
        {activeTab === 'forecast' && analysis && (
          <div className="space-y-6">
            <div className={`p-6 rounded-2xl border ${isDark ? 'bg-[#181B22] border-[#262A34]' : 'bg-[#FFFFFF] border-[#E4E4DF]'}`}>
              <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b ${isDark ? 'border-[#262A34]' : 'border-[#ECECE7]'}`}>
                <div>
                  <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-[#6B85FF]' : 'text-[#3B5BFD]'}`}>
                    Phase 6 • Supervised Machine Learning Forecasting
                  </span>
                  <h2 className={`text-lg font-extrabold mt-0.5 ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                    Linear Regression Trend & Future Horizon Projection
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-500">Target Metric</label>
                    <select
                      value={forecastTarget}
                      onChange={e => setForecastTarget(e.target.value)}
                      className={`text-sm rounded-xl border px-3 py-1.5 ${isDark ? 'bg-[#12141A] border-[#2B303B] text-[#F7F7F5]' : 'bg-[#F7F7F5] border-[#DFDFD9] text-[#1C1F26]'}`}
                    >
                      {analysis.numericCols.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-500">Forecast Horizon</label>
                    <select
                      value={forecastHorizon}
                      onChange={e => setForecastHorizon(Number(e.target.value))}
                      className={`text-sm rounded-xl border px-3 py-1.5 ${isDark ? 'bg-[#12141A] border-[#2B303B] text-[#F7F7F5]' : 'bg-[#F7F7F5] border-[#DFDFD9] text-[#1C1F26]'}`}
                    >
                      <option value={3}>Next 3 Periods</option>
                      <option value={4}>Next 4 Periods</option>
                      <option value={6}>Next 6 Periods</option>
                    </select>
                  </div>
                </div>
              </div>

              {forecastData && (
                <>
                  {/* Model Metrics Strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-5">
                    <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#12141A] border-[#262A34]' : 'bg-[#F7F7F5] border-[#E4E4DF]'}`}>
                      <span className="text-xs font-semibold text-slate-500">Regression Slope (Velocity)</span>
                      <div className={`text-xl font-extrabold mt-1 ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                        {forecastData.slope >= 0 ? '+' : ''}{forecastData.slope} <span className="text-xs font-normal text-slate-500">/ period</span>
                      </div>
                    </div>

                    <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#12141A] border-[#262A34]' : 'bg-[#F7F7F5] border-[#E4E4DF]'}`}>
                      <span className="text-xs font-semibold text-slate-500">Model Goodness-of-Fit (R²)</span>
                      <div className={`text-xl font-extrabold mt-1 ${isDark ? 'text-[#6B85FF]' : 'text-[#3B5BFD]'}`}>
                        {forecastData.rSquared} <span className="text-xs font-normal text-slate-500">({Math.round(forecastData.rSquared * 100)}% variance explained)</span>
                      </div>
                    </div>

                    <div className={`p-4 rounded-xl border ${isDark ? 'bg-[#12141A] border-[#262A34]' : 'bg-[#F7F7F5] border-[#E4E4DF]'}`}>
                      <span className="text-xs font-semibold text-slate-500">Projected Horizon Growth</span>
                      <div className={`text-xl font-extrabold mt-1 ${forecastData.projectedGrowthPct >= 0 ? 'text-[#3B5BFD]' : 'text-rose-500'}`}>
                        {forecastData.projectedGrowthPct >= 0 ? '+' : ''}{forecastData.projectedGrowthPct}%
                      </div>
                    </div>
                  </div>

                  {/* Forecast Chart */}
                  <div className="h-80 w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={forecastData.combinedSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <XAxis dataKey="period" tick={{ fontSize: 11, fill: tickFill }} />
                        <YAxis tick={{ fontSize: 12, fill: tickFill }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="upperBound"
                          name="80% Confidence Upper"
                          stroke="none"
                          fill="#3B5BFD"
                          fillOpacity={isDark ? 0.25 : 0.16}
                        />
                        <Line
                          type="monotone"
                          dataKey="actual"
                          name={`Historical ${forecastTarget}`}
                          stroke={isDark ? '#F7F7F5' : '#1C1F26'}
                          strokeWidth={2.5}
                          dot={{ r: 4 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="trend"
                          name="OLS Linear Trendline"
                          stroke="#94A3B8"
                          strokeDasharray="4 4"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="forecast"
                          name="Predicted Forecast"
                          stroke="#3B5BFD"
                          strokeWidth={3}
                          dot={{ r: 5, fill: '#3B5BFD' }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Forecast Table */}
                  <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className={`border-b ${isDark ? 'border-[#262A34] text-slate-400' : 'border-[#E4E4DF] text-slate-500'}`}>
                          <th className="py-2.5 px-3 font-bold">Future Horizon</th>
                          <th className="py-2.5 px-3 font-bold">Point Forecast ({forecastTarget})</th>
                          <th className="py-2.5 px-3 font-bold">Lower Bound (80% CI)</th>
                          <th className="py-2.5 px-3 font-bold">Upper Bound (80% CI)</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDark ? 'divide-[#262A34]' : 'divide-[#ECECE7]'}`}>
                        {forecastData.futurePredictions.map((fp, idx) => (
                          <tr key={idx} className={isDark ? 'hover:bg-[#222630]' : 'hover:bg-[#F7F7F5]'}>
                            <td className={`py-2.5 px-3 font-bold ${isDark ? 'text-[#6B85FF]' : 'text-[#3B5BFD]'}`}>{fp.period}</td>
                            <td className={`py-2.5 px-3 font-extrabold ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>{fp.forecast.toLocaleString()}</td>
                            <td className="py-2.5 px-3 text-slate-500">{fp.lowerBound.toLocaleString()}</td>
                            <td className="py-2.5 px-3 text-slate-500">{fp.upperBound.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 4: PHASE 2 PREPROCESSING & PHASE 3 STATISTICAL ENGINE             */}
        {/* ===================================================================== */}
        {activeTab === 'cleaning' && analysis && (
          <div className="space-y-6">
            {/* Phase 3: Statistical Profiling Table */}
            <div className={`p-6 rounded-2xl border ${isDark ? 'bg-[#181B22] border-[#262A34]' : 'bg-[#FFFFFF] border-[#E4E4DF]'}`}>
              <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-[#6B85FF]' : 'text-[#3B5BFD]'}`}>
                Phase 3 • Automated Statistical Analysis
              </span>
              <h2 className={`text-lg font-extrabold mt-0.5 mb-4 ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                Descriptive Statistics Matrix
              </h2>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className={`border-y ${isDark ? 'bg-[#12141A] border-[#262A34] text-slate-300' : 'bg-[#F7F7F5] border-[#E4E4DF] text-[#1C1F26]'}`}>
                      <th className="py-3 px-4 font-bold">Feature</th>
                      <th className="py-3 px-4 font-bold">Mean</th>
                      <th className="py-3 px-4 font-bold">Median</th>
                      <th className="py-3 px-4 font-bold">Mode</th>
                      <th className="py-3 px-4 font-bold">Std. Dev</th>
                      <th className="py-3 px-4 font-bold">Min</th>
                      <th className="py-3 px-4 font-bold">Max</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#262A34]' : 'divide-[#ECECE7]'}`}>
                    {Object.entries(analysis.stats).map(([col, s]) => (
                      <tr key={col} className={isDark ? 'hover:bg-[#222630]' : 'hover:bg-[#F7F7F5]'}>
                        <td className={`py-3 px-4 font-bold ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>{col}</td>
                        <td className="py-3 px-4 text-slate-500">{s.mean.toLocaleString()}</td>
                        <td className="py-3 px-4 text-slate-500">{s.median.toLocaleString()}</td>
                        <td className="py-3 px-4 text-slate-500">{s.mode.toLocaleString()}</td>
                        <td className="py-3 px-4 text-slate-500">{s.stdDev.toLocaleString()}</td>
                        <td className="py-3 px-4 text-slate-500">{s.min.toLocaleString()}</td>
                        <td className="py-3 px-4 text-slate-500">{s.max.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Correlation Pairs */}
              {analysis.correlations.length > 0 && (
                <div className={`mt-6 pt-5 border-t ${isDark ? 'border-[#262A34]' : 'border-[#ECECE7]'}`}>
                  <h3 className={`text-sm font-extrabold mb-3 ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                    Pearson Correlation Coefficients (r)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {analysis.correlations.map((c, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl border flex items-center justify-between ${isDark ? 'border-[#262A34] bg-[#12141A]' : 'border-[#E4E4DF] bg-[#F7F7F5]'}`}
                      >
                        <span className={`text-xs font-semibold truncate pr-2 ${isDark ? 'text-slate-300' : 'text-[#1C1F26]'}`}>
                          {c.pair}
                        </span>
                        <span
                          className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                            Math.abs(c.r) >= 0.7
                              ? isDark ? 'bg-[#3B5BFD]/20 text-[#8CA2FF]' : 'bg-[#EEF1FF] text-[#3B5BFD]'
                              : isDark ? 'bg-[#262A34] text-slate-300' : 'bg-[#E4E4DF] text-[#1C1F26]'
                          }`}
                        >
                          r = {c.r}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Phase 2: Cleaned Dataset Preview Table */}
            <div className={`p-6 rounded-2xl border ${isDark ? 'bg-[#181B22] border-[#262A34]' : 'bg-[#FFFFFF] border-[#E4E4DF]'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                    Phase 2 • Data Preprocessing Output
                  </span>
                  <h3 className={`text-lg font-extrabold ${isDark ? 'text-[#F7F7F5]' : 'text-[#1C1F26]'}`}>
                    Cleaned & Imputed Dataset Preview
                  </h3>
                </div>
                <span className="text-xs text-slate-500">
                  Showing {analysis.cleanedRows.length} standardized records
                </span>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-[#1C1F26] text-[#F7F7F5]">
                    <tr>
                      <th className="py-2.5 px-3 font-bold">#</th>
                      {analysis.headers.map(h => (
                        <th key={h} className="py-2.5 px-3 font-bold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[#262A34]' : 'divide-[#ECECE7]'}`}>
                    {analysis.cleanedRows.map(row => (
                      <tr key={row._id} className={isDark ? 'hover:bg-[#222630]' : 'hover:bg-[#F7F7F5]'}>
                        <td className="py-2 px-3 text-slate-400">{row._id}</td>
                        {analysis.headers.map(h => (
                          <td key={h} className={`py-2 px-3 whitespace-nowrap ${isDark ? 'text-slate-300' : 'text-[#1C1F26]'}`}>
                            {typeof row[h] === 'number' ? row[h].toLocaleString() : row[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="relative z-10 border-t border-[#2B303B] bg-[#1C1F26] text-slate-400 py-4 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <span className="text-[#F7F7F5] font-medium">
            AI Data Analyst & Business Intelligence Copilot — B.Tech (AI & DS) Minor Project (AIDS451)
          </span>
          <span>Dr. Akhilesh Das Gupta Institute of Professional Studies • Delhi </span>
        </div>
      </footer>
    </div>
  );
}