import { NextResponse } from "next/server";

// Hardcoded US Economic Calendar for 2025
// Sources: BLS, Federal Reserve, BEA release schedules
// These are the REAL scheduled release dates

interface MacroEvent {
  id: string;
  name: string;
  currency: string;
  country: string;
  date: string; // ISO date string
  timestamp: number;
  previous: number | null;
  forecast: number | null;
  actual: number | null;
  impact: string;
  unit: string;
}

// All times are in ET, converted to UTC
// CPI/PPI: 8:30 AM ET = 13:30 UTC
// FOMC: 2:00 PM ET = 19:00 UTC  
// NFP: 8:30 AM ET = 13:30 UTC
// GDP: 8:30 AM ET = 13:30 UTC

const ECONOMIC_CALENDAR_2025: Omit<MacroEvent, "timestamp">[] = [
  // December 2024 (for recent context)
  {
    id: "fomc-2024-12-18",
    name: "FOMC Interest Rate Decision",
    currency: "USD",
    country: "US",
    date: "2024-12-18T19:00:00Z",
    previous: 4.75,
    forecast: 4.50,
    actual: 4.50,
    impact: "high",
    unit: "%",
  },
  {
    id: "gdp-2024-q3-final",
    name: "GDP Growth Rate QoQ Final",
    currency: "USD",
    country: "US",
    date: "2024-12-19T13:30:00Z",
    previous: 3.0,
    forecast: 2.8,
    actual: 3.1,
    impact: "high",
    unit: "%",
  },
  {
    id: "pce-2024-11",
    name: "Core PCE Price Index MoM",
    currency: "USD",
    country: "US",
    date: "2024-12-20T13:30:00Z",
    previous: 0.3,
    forecast: 0.2,
    actual: 0.1,
    impact: "high",
    unit: "%",
  },
  
  // January 2025
  {
    id: "nfp-2025-01-10",
    name: "Nonfarm Payrolls",
    currency: "USD",
    country: "US",
    date: "2025-01-10T13:30:00Z",
    previous: 227,
    forecast: 160,
    actual: null,
    impact: "high",
    unit: "K",
  },
  {
    id: "cpi-2025-01-15",
    name: "CPI MoM",
    currency: "USD",
    country: "US",
    date: "2025-01-15T13:30:00Z",
    previous: 0.3,
    forecast: 0.3,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "core-cpi-2025-01-15",
    name: "Core CPI YoY",
    currency: "USD",
    country: "US",
    date: "2025-01-15T13:30:01Z",
    previous: 3.3,
    forecast: 3.3,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "ppi-2025-01-14",
    name: "PPI MoM",
    currency: "USD",
    country: "US",
    date: "2025-01-14T13:30:00Z",
    previous: 0.4,
    forecast: 0.3,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "retail-2025-01-16",
    name: "Retail Sales MoM",
    currency: "USD",
    country: "US",
    date: "2025-01-16T13:30:00Z",
    previous: 0.7,
    forecast: 0.5,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "fomc-2025-01-29",
    name: "FOMC Interest Rate Decision",
    currency: "USD",
    country: "US",
    date: "2025-01-29T19:00:00Z",
    previous: 4.50,
    forecast: 4.50,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "gdp-2025-q4-adv",
    name: "GDP Growth Rate QoQ Advance",
    currency: "USD",
    country: "US",
    date: "2025-01-30T13:30:00Z",
    previous: 3.1,
    forecast: 2.5,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "pce-2025-01-31",
    name: "Core PCE Price Index MoM",
    currency: "USD",
    country: "US",
    date: "2025-01-31T13:30:00Z",
    previous: 0.1,
    forecast: 0.2,
    actual: null,
    impact: "high",
    unit: "%",
  },

  // February 2025
  {
    id: "nfp-2025-02-07",
    name: "Nonfarm Payrolls",
    currency: "USD",
    country: "US",
    date: "2025-02-07T13:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "K",
  },
  {
    id: "cpi-2025-02-12",
    name: "CPI MoM",
    currency: "USD",
    country: "US",
    date: "2025-02-12T13:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "core-cpi-2025-02-12",
    name: "Core CPI YoY",
    currency: "USD",
    country: "US",
    date: "2025-02-12T13:30:01Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "ppi-2025-02-13",
    name: "PPI MoM",
    currency: "USD",
    country: "US",
    date: "2025-02-13T13:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "retail-2025-02-14",
    name: "Retail Sales MoM",
    currency: "USD",
    country: "US",
    date: "2025-02-14T13:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "gdp-2025-q4-second",
    name: "GDP Growth Rate QoQ Second",
    currency: "USD",
    country: "US",
    date: "2025-02-27T13:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "pce-2025-02-28",
    name: "Core PCE Price Index MoM",
    currency: "USD",
    country: "US",
    date: "2025-02-28T13:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },

  // March 2025
  {
    id: "nfp-2025-03-07",
    name: "Nonfarm Payrolls",
    currency: "USD",
    country: "US",
    date: "2025-03-07T13:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "K",
  },
  {
    id: "cpi-2025-03-12",
    name: "CPI MoM",
    currency: "USD",
    country: "US",
    date: "2025-03-12T13:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "core-cpi-2025-03-12",
    name: "Core CPI YoY",
    currency: "USD",
    country: "US",
    date: "2025-03-12T13:30:01Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "ppi-2025-03-13",
    name: "PPI MoM",
    currency: "USD",
    country: "US",
    date: "2025-03-13T13:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "retail-2025-03-17",
    name: "Retail Sales MoM",
    currency: "USD",
    country: "US",
    date: "2025-03-17T12:30:00Z", // Note: DST change
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "fomc-2025-03-19",
    name: "FOMC Interest Rate Decision",
    currency: "USD",
    country: "US",
    date: "2025-03-19T18:00:00Z", // Note: DST
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "gdp-2025-q4-final",
    name: "GDP Growth Rate QoQ Final",
    currency: "USD",
    country: "US",
    date: "2025-03-27T12:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "pce-2025-03-28",
    name: "Core PCE Price Index MoM",
    currency: "USD",
    country: "US",
    date: "2025-03-28T12:30:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },

  // April-May 2025 FOMC
  {
    id: "fomc-2025-05-07",
    name: "FOMC Interest Rate Decision",
    currency: "USD",
    country: "US",
    date: "2025-05-07T18:00:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
  {
    id: "fomc-2025-06-18",
    name: "FOMC Interest Rate Decision",
    currency: "USD",
    country: "US",
    date: "2025-06-18T18:00:00Z",
    previous: null,
    forecast: null,
    actual: null,
    impact: "high",
    unit: "%",
  },
];

export async function GET() {
  try {
    const now = Date.now();
    
    // Filter events: show past 7 days and next 30 days
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysFromNow = now + 30 * 24 * 60 * 60 * 1000;

    const events: MacroEvent[] = ECONOMIC_CALENDAR_2025
      .map((event) => ({
        ...event,
        timestamp: new Date(event.date).getTime(),
      }))
      .filter((event) => event.timestamp >= sevenDaysAgo && event.timestamp <= thirtyDaysFromNow)
      .sort((a, b) => a.timestamp - b.timestamp);

    return NextResponse.json({
      events,
      source: "US Economic Calendar 2025",
      isDemo: false,
      lastUpdated: "2024-12-27",
    });
  } catch (error) {
    console.error("Error processing macro events:", error);

    return NextResponse.json({
      events: [],
      source: "Error",
      isDemo: true,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
