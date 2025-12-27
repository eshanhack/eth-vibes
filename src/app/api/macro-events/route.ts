import { NextResponse } from "next/server";

// Finnhub Economic Calendar API (free tier available)
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

interface FinnhubEvent {
  actual: number | null;
  country: string;
  estimate: number | null;
  event: string;
  impact: string;
  prev: number | null;
  time: string;
  unit: string;
}

interface FinnhubResponse {
  economicCalendar: FinnhubEvent[];
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
  "Interest Rate Decision",
  "Fed Interest Rate",
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
  "PPI",
  "Producer Price",
];

// Filter for high-impact events
function isHighImpact(event: FinnhubEvent): boolean {
  const eventLower = event.event.toLowerCase();
  return (
    HIGH_IMPACT_KEYWORDS.some((keyword) =>
      eventLower.includes(keyword.toLowerCase())
    ) ||
    event.impact === "high" ||
    event.impact === "medium"
  );
}

export async function GET() {
  try {
    // Debug: Check if API key is configured
    const hasApiKey = !!FINNHUB_API_KEY;
    const keyLength = FINNHUB_API_KEY?.length || 0;

    if (!FINNHUB_API_KEY) {
      // Return demo data if no API key
      return NextResponse.json({
        events: getDemoEvents(),
        source: "Demo Data (FINNHUB_API_KEY not configured)",
        isDemo: true,
        debug: { hasApiKey, keyLength },
      });
    }

    // Fetch events for the next 7 days and past 3 days
    const today = new Date();
    const pastDate = new Date(today);
    pastDate.setDate(pastDate.getDate() - 3);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 7);

    const fromStr = pastDate.toISOString().split("T")[0];
    const toStr = futureDate.toISOString().split("T")[0];

    const url = `https://finnhub.io/api/v1/calendar/economic?from=${fromStr}&to=${toStr}&token=${FINNHUB_API_KEY}`;

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

    const data: FinnhubResponse = await response.json();

    // Check if API returned valid data
    if (!data.economicCalendar || !Array.isArray(data.economicCalendar)) {
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
    const highImpactEvents = data.economicCalendar
      .filter((e) => e.country === "US" && isHighImpact(e))
      .map((e) => {
        // Parse the timestamp - Finnhub uses "YYYY-MM-DD HH:MM:SS" format
        const timestamp = new Date(e.time.replace(" ", "T") + "Z").getTime();
        
        return {
          id: `${e.time}-${e.event}`.replace(/[\s:]+/g, "-").toLowerCase(),
          name: e.event,
          currency: "USD",
          country: e.country,
          date: new Date(timestamp).toISOString(),
          timestamp,
          previous: e.prev,
          forecast: e.estimate,
          actual: e.actual,
          impact: e.impact,
          unit: e.unit || "",
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 20); // Limit to 20 events

    return NextResponse.json({
      events: highImpactEvents,
      source: "Finnhub",
      isDemo: false,
      debug: {
        hasApiKey: true,
        keyLength,
        totalEvents: data.economicCalendar.length,
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
        hasApiKey: !!FINNHUB_API_KEY,
        keyLength: FINNHUB_API_KEY?.length || 0,
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
