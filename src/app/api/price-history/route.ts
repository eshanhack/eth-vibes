import { NextResponse } from "next/server";

// Binance klines endpoint documentation:
// GET /api/v3/klines?symbol=ETHUSDT&interval=1m&startTime=X&limit=1
// Returns: [[openTime, open, high, low, close, volume, closeTime, ...], ...]

const API_THROTTLE_MS = 150; // Delay between API calls to avoid rate limiting

// Timeframe definitions
const TIMEFRAMES = {
  "1m": { ms: 60 * 1000, interval: "1m" },
  "10m": { ms: 10 * 60 * 1000, interval: "1m" },
  "30m": { ms: 30 * 60 * 1000, interval: "1m" },
  "1h": { ms: 60 * 60 * 1000, interval: "1h" },
  "1d": { ms: 24 * 60 * 60 * 1000, interval: "1d" },
};

type TimeframeKey = keyof typeof TIMEFRAMES;

// Helper function to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch a single price from Binance
async function fetchPrice(timestamp: number, interval: string = "1m"): Promise<number | null> {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=${interval}&startTime=${timestamp}&limit=1`;
    console.log(`Fetching price: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; ETH-Vibes/1.0)',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Binance API error: ${response.status}`, errorText);
      return null;
    }
    
    const data = await response.json();
    console.log(`Binance response for ${new Date(timestamp).toISOString()}:`, JSON.stringify(data).substring(0, 200));
    
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      const price = parseFloat(data[0][4]); // Close price
      console.log(`Price at ${new Date(timestamp).toISOString()}: $${price}`);
      return price;
    }
    
    console.log("No data returned from Binance for timestamp:", timestamp);
    return null;
  } catch (error) {
    console.error("Error fetching price:", error);
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timestamp = searchParams.get("timestamp");
  const multiTimeframe = searchParams.get("multi") === "true";

  if (!timestamp) {
    return NextResponse.json(
      { error: "timestamp parameter is required" },
      { status: 400 }
    );
  }

  const timeT = parseInt(timestamp, 10);
  const now = Date.now();

  // Single timeframe mode (legacy compatibility)
  if (!multiTimeframe) {
    const timeTPlus10 = timeT + TIMEFRAMES["10m"].ms;
    
    if (timeTPlus10 > now) {
      return NextResponse.json({
        priceAtT: null,
        priceAtT10: null,
        percentChange: null,
        pending: true,
        timeUntilReady: timeTPlus10 - now,
        timeT,
        timeTPlus10,
      });
    }

    const priceAtT = await fetchPrice(timeT);
    await delay(API_THROTTLE_MS);
    const priceAtT10 = await fetchPrice(timeTPlus10);

    let percentChange: number | null = null;
    if (priceAtT !== null && priceAtT10 !== null && priceAtT !== 0) {
      percentChange = ((priceAtT10 - priceAtT) / priceAtT) * 100;
    }

    return NextResponse.json({
      priceAtT,
      priceAtT10,
      percentChange,
      pending: false,
      timeT,
      timeTPlus10,
    });
  }

  // Multi-timeframe mode
  console.log(`Multi-timeframe price request: T=${new Date(timeT).toISOString()}`);

  // First, fetch the base price at time T
  console.log("Fetching base price at T:", new Date(timeT).toISOString());
  const priceAtT = await fetchPrice(timeT);
  console.log("Base price at T:", priceAtT);
  
  if (priceAtT === null) {
    // Return all timeframes as not pending but with null values (no data available)
    const emptyTimeframes: Record<TimeframeKey, { price: number | null; change: number | null; pending: boolean }> = {
      "1m": { price: null, change: null, pending: false },
      "10m": { price: null, change: null, pending: false },
      "30m": { price: null, change: null, pending: false },
      "1h": { price: null, change: null, pending: false },
      "1d": { price: null, change: null, pending: false },
    };
    return NextResponse.json({
      priceAtT: null,
      timeframes: emptyTimeframes,
      impactScore: 0,
      impactDirection: "neutral",
      error: "Could not fetch base price - data may not be available for this timestamp",
      timeT,
    });
  }

  // Fetch price at each timeframe
  const timeframes: Record<TimeframeKey, {
    price: number | null;
    change: number | null;
    pending: boolean;
  }> = {} as Record<TimeframeKey, { price: number | null; change: number | null; pending: boolean }>;

  for (const [key, config] of Object.entries(TIMEFRAMES) as [TimeframeKey, typeof TIMEFRAMES[TimeframeKey]][]) {
    const targetTime = timeT + config.ms;
    
    // Check if this timeframe is still pending
    if (targetTime > now) {
      timeframes[key] = {
        price: null,
        change: null,
        pending: true,
      };
      continue;
    }

    await delay(API_THROTTLE_MS);
    const price = await fetchPrice(targetTime, config.interval);
    
    let change: number | null = null;
    if (price !== null && priceAtT !== 0) {
      change = ((price - priceAtT) / priceAtT) * 100;
    }

    timeframes[key] = {
      price,
      change,
      pending: false,
    };
  }

  // Calculate impact score
  let positiveCount = 0;
  let negativeCount = 0;
  let totalMagnitude = 0;
  let validCount = 0;

  for (const tf of Object.values(timeframes)) {
    if (tf.change !== null) {
      validCount++;
      totalMagnitude += Math.abs(tf.change);
      if (tf.change > 0) positiveCount++;
      else if (tf.change < 0) negativeCount++;
    }
  }

  const impactDirection = positiveCount > negativeCount ? "positive" : 
                          negativeCount > positiveCount ? "negative" : "neutral";
  const impactScore = validCount > 0 ? (totalMagnitude / validCount) * (Math.max(positiveCount, negativeCount) / validCount) : 0;

  return NextResponse.json({
    priceAtT,
    timeframes,
    impactScore,
    impactDirection,
    timeT,
  });
}
