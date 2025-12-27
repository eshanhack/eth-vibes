import { NextResponse } from "next/server";

// Financial Modeling Prep Economic Calendar API
const FMP_API_KEY = process.env.FMP_API_KEY;

interface FMPEvent {
  date: string;
  country: string;
  event: string;
  currency: string;
  previous: number | null;
  estimate: number | null;
  actual: number | null;
  change: number | null;
  impact: string;
  changePercentage: number | null;
  unit: string;
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
];

// Filter for high-impact events
function isHighImpact(event: FMPEvent): boolean {
  const eventLower = event.event.toLowerCase();
  return (
    HIGH_IMPACT_KEYWORDS.some((keyword) =>
      eventLower.includes(keyword.toLowerCase())
    ) ||
    event.impact === "High" ||
    event.impact === "high"
  );
}

export async function GET() {
  try {
    if (!FMP_API_KEY) {
      // Return demo data if no API key
      return NextResponse.json({
        events: getDemoEvents(),
        source: "Demo Data (FMP_API_KEY not configured)",
        isDemo: true,
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

    const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${fromStr}&to=${toStr}&apikey=${FMP_API_KEY}`;

    const response = await fetch(url, {
      next: { revalidate: 300 }, // Cache for 5 minutes
    });

    if (!response.ok) {
      throw new Error(`FMP API error: ${response.status}`);
    }

    const data: FMPEvent[] = await response.json();

    // Filter for high-impact USD events
    const highImpactEvents = data
      .filter((e) => e.currency === "USD" && isHighImpact(e))
      .map((e) => ({
        id: `${e.date}-${e.event}`.replace(/\s+/g, "-").toLowerCase(),
        name: e.event,
        currency: e.currency,
        country: e.country,
        date: e.date,
        timestamp: new Date(e.date).getTime(),
        previous: e.previous,
        forecast: e.estimate,
        actual: e.actual,
        impact: e.impact,
        unit: e.unit || "",
      }))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 20); // Limit to 20 events

    return NextResponse.json({
      events: highImpactEvents,
      source: "Financial Modeling Prep",
      isDemo: false,
    });
  } catch (error) {
    console.error("Error fetching macro events:", error);

    // Return demo data on error
    return NextResponse.json({
      events: getDemoEvents(),
      source: "Demo Data (API Error)",
      isDemo: true,
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
      impact: "High",
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
      impact: "High",
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
      impact: "High",
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
      impact: "High",
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
      impact: "High",
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
      impact: "High",
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
      impact: "High",
      unit: "%",
    },
  ];
}

