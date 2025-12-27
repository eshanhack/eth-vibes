import { NextResponse } from "next/server";

// Twelve Data Economic Calendar API (free tier: 800 calls/day)
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;

interface TwelveDataEvent {
  event: string;
  country: string;
  actual: string | null;
  previous: string | null;
  consensus: string | null;
  date: string;
  time: string;
  impact: string;
  currency: string;
}

interface TwelveDataResponse {
  data?: TwelveDataEvent[];
  status?: string;
  message?: string;
}

// High-impact event keywords
const HIGH_IMPACT_KEYWORDS = [
  "CPI",
  "Consumer Price Index",
  "NFP",
  "Non-Farm Payrolls",
  "Nonfarm Payrolls",
  "Employment Change",
  "FOMC",
  "Interest Rate",
  "Fed Funds",
  "Federal Funds",
  "GDP",
  "Gross Domestic Product",
  "PCE",
  "Personal Consumption",
  "Retail Sales",
  "Unemployment Rate",
  "PMI",
  "ISM Manufacturing",
  "Core CPI",
  "Core PCE",
  "Initial Jobless Claims",
  "Jobless Claims",
  "PPI",
  "Producer Price",
  "Housing Starts",
  "Durable Goods",
];

// Filter for high-impact events
function isHighImpact(event: TwelveDataEvent): boolean {
  const eventLower = event.event.toLowerCase();
  return (
    HIGH_IMPACT_KEYWORDS.some((keyword) =>
      eventLower.includes(keyword.toLowerCase())
    ) ||
    event.impact === "high" ||
    event.impact === "High"
  );
}

// Parse numeric value from string (handles "0.3%", "227K", etc.)
function parseValue(val: string | null): number | null {
  if (!val || val === "" || val === "-") return null;
  const cleaned = val.replace(/[%KMB,]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Extract unit from value string
function extractUnit(val: string | null): string {
  if (!val) return "";
  if (val.includes("%")) return "%";
  if (val.includes("K")) return "K";
  if (val.includes("M")) return "M";
  if (val.includes("B")) return "B";
  return "";
}

export async function GET() {
  try {
    // Debug: Check if API key is configured
    const hasApiKey = !!TWELVEDATA_API_KEY;
    const keyLength = TWELVEDATA_API_KEY?.length || 0;

    if (!TWELVEDATA_API_KEY) {
      // Return demo data if no API key
      return NextResponse.json({
        events: getDemoEvents(),
        source: "Demo Data (TWELVEDATA_API_KEY not configured)",
        isDemo: true,
        debug: { hasApiKey, keyLength },
      });
    }

    // Twelve Data uses a single endpoint that returns upcoming events
    const url = `https://api.twelvedata.com/economic_calendar?country=United States&apikey=${TWELVEDATA_API_KEY}`;

    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({
        events: getDemoEvents(),
        source: `Demo Data (API returned ${response.status})`,
        isDemo: true,
        debug: {
          hasApiKey: true,
          keyLength,
          status: response.status,
          error: errorText.slice(0, 200),
        },
      });
    }

    const data: TwelveDataResponse = await response.json();

    // Check for API error response
    if (data.status === "error") {
      return NextResponse.json({
        events: getDemoEvents(),
        source: `Demo Data (${data.message || "API Error"})`,
        isDemo: true,
        debug: {
          hasApiKey: true,
          keyLength,
          apiMessage: data.message,
        },
      });
    }

    // Check if API returned valid data
    if (!data.data || !Array.isArray(data.data)) {
      return NextResponse.json({
        events: getDemoEvents(),
        source: "Demo Data (Invalid API response)",
        isDemo: true,
        debug: {
          hasApiKey: true,
          keyLength,
          response: JSON.stringify(data).slice(0, 200),
        },
      });
    }

    // Filter for high-impact US events
    const highImpactEvents = data.data
      .filter((e) => isHighImpact(e))
      .map((e) => {
        // Parse the timestamp - Twelve Data uses separate date and time fields
        // Date format: "2024-01-15", Time format: "08:30:00" or "All Day"
        let timestamp: number;
        if (e.time && e.time !== "All Day") {
          timestamp = new Date(`${e.date}T${e.time}Z`).getTime();
        } else {
          // Default to 8:30 AM ET (13:30 UTC) for "All Day" events
          timestamp = new Date(`${e.date}T13:30:00Z`).getTime();
        }

        const unit = extractUnit(e.actual) || extractUnit(e.consensus) || extractUnit(e.previous);

        return {
          id: `${e.date}-${e.event}`.replace(/[\s:]+/g, "-").toLowerCase(),
          name: e.event,
          currency: e.currency || "USD",
          country: e.country,
          date: new Date(timestamp).toISOString(),
          timestamp,
          previous: parseValue(e.previous),
          forecast: parseValue(e.consensus),
          actual: parseValue(e.actual),
          impact: e.impact?.toLowerCase() || "medium",
          unit,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 20); // Limit to 20 events

    return NextResponse.json({
      events: highImpactEvents,
      source: "Twelve Data",
      isDemo: false,
      debug: {
        hasApiKey: true,
        keyLength,
        totalEvents: data.data.length,
        filteredEvents: highImpactEvents.length,
      },
    });
  } catch (error) {
    console.error("Error fetching macro events:", error);

    // Return demo data on error
    return NextResponse.json({
      events: getDemoEvents(),
      source: "Demo Data (API Error)",
      isDemo: true,
      debug: {
        hasApiKey: !!TWELVEDATA_API_KEY,
        keyLength: TWELVEDATA_API_KEY?.length || 0,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

function getDemoEvents() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  return [
    {
      id: "us-cpi-dec",
      name: "CPI (MoM)",
      currency: "USD",
      country: "US",
      date: new Date(now + 2 * hour).toISOString(),
      timestamp: now + 2 * hour,
      previous: 0.3,
      forecast: 0.2,
      actual: null,
      impact: "high",
      unit: "%",
    },
    {
      id: "us-core-cpi-dec",
      name: "Core CPI (YoY)",
      currency: "USD",
      country: "US",
      date: new Date(now + 2 * hour + 1000).toISOString(),
      timestamp: now + 2 * hour + 1000,
      previous: 3.3,
      forecast: 3.3,
      actual: null,
      impact: "high",
      unit: "%",
    },
    {
      id: "fomc-rate-decision",
      name: "FOMC Interest Rate Decision",
      currency: "USD",
      country: "US",
      date: new Date(now + 1 * day).toISOString(),
      timestamp: now + 1 * day,
      previous: 4.5,
      forecast: 4.5,
      actual: null,
      impact: "high",
      unit: "%",
    },
    {
      id: "us-nfp-jan",
      name: "Nonfarm Payrolls",
      currency: "USD",
      country: "US",
      date: new Date(now + 3 * day).toISOString(),
      timestamp: now + 3 * day,
      previous: 227,
      forecast: 180,
      actual: null,
      impact: "high",
      unit: "K",
    },
    {
      id: "us-gdp-q4",
      name: "GDP Growth Rate (QoQ)",
      currency: "USD",
      country: "US",
      date: new Date(now + 5 * day).toISOString(),
      timestamp: now + 5 * day,
      previous: 2.8,
      forecast: 2.6,
      actual: null,
      impact: "high",
      unit: "%",
    },
    {
      id: "us-pce-dec",
      name: "Core PCE Price Index (MoM)",
      currency: "USD",
      country: "US",
      date: new Date(now - 1 * hour).toISOString(),
      timestamp: now - 1 * hour,
      previous: 0.1,
      forecast: 0.2,
      actual: 0.2,
      impact: "high",
      unit: "%",
    },
    {
      id: "us-retail-dec",
      name: "Retail Sales (MoM)",
      currency: "USD",
      country: "US",
      date: new Date(now - 2 * day).toISOString(),
      timestamp: now - 2 * day,
      previous: 0.7,
      forecast: 0.5,
      actual: 0.4,
      impact: "high",
      unit: "%",
    },
  ];
}
