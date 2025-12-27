import { NextResponse } from "next/server";

const FRED_API_KEY = process.env.FRED_API_KEY;

interface FREDObservation {
  date: string;
  value: string;
}

interface FREDResponse {
  observations: FREDObservation[];
}

// Calculate YoY percentage change for CPI
function calculateYoYChange(observations: FREDObservation[]): { date: string; value: number }[] {
  const result: { date: string; value: number }[] = [];
  
  for (let i = 12; i < observations.length; i++) {
    const current = parseFloat(observations[i].value);
    const yearAgo = parseFloat(observations[i - 12].value);
    
    if (!isNaN(current) && !isNaN(yearAgo) && yearAgo !== 0) {
      const yoyChange = ((current - yearAgo) / yearAgo) * 100;
      result.push({
        date: observations[i].date,
        value: Math.round(yoyChange * 100) / 100, // 2 decimal places
      });
    }
  }
  
  return result;
}

export async function GET() {
  try {
    // Calculate date range: last 10 years
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 11); // Extra year for YoY calculation
    
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    if (!FRED_API_KEY) {
      // Return demo data if no API key
      return NextResponse.json({
        cpi: getDemoCPIData(),
        fedFunds: getDemoFedFundsData(),
        source: "Demo Data (FRED_API_KEY not configured)",
        isDemo: true,
      });
    }

    // Fetch CPI data (CPIAUCSL - monthly)
    const cpiUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=${FRED_API_KEY}&file_type=json&observation_start=${startStr}&observation_end=${endStr}&frequency=m`;
    
    // Fetch Fed Funds Rate (FEDFUNDS - monthly)
    const fedFundsUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${FRED_API_KEY}&file_type=json&observation_start=${startStr}&observation_end=${endStr}&frequency=m`;

    const [cpiResponse, fedFundsResponse] = await Promise.all([
      fetch(cpiUrl, { next: { revalidate: 86400 } }), // Cache for 24 hours
      fetch(fedFundsUrl, { next: { revalidate: 86400 } }),
    ]);

    if (!cpiResponse.ok || !fedFundsResponse.ok) {
      throw new Error("Failed to fetch FRED data");
    }

    const cpiData: FREDResponse = await cpiResponse.json();
    const fedFundsData: FREDResponse = await fedFundsResponse.json();

    // Convert CPI to YoY percentage change
    const cpiYoY = calculateYoYChange(cpiData.observations);

    // Process Fed Funds Rate
    const fedFunds = fedFundsData.observations
      .filter((obs) => obs.value !== ".")
      .map((obs) => ({
        date: obs.date,
        value: parseFloat(obs.value),
      }));

    return NextResponse.json({
      cpi: cpiYoY,
      fedFunds,
      source: "Federal Reserve Economic Data (FRED)",
      isDemo: false,
    });
  } catch (error) {
    console.error("Error fetching FRED data:", error);

    return NextResponse.json({
      cpi: getDemoCPIData(),
      fedFunds: getDemoFedFundsData(),
      source: "Demo Data (API Error)",
      isDemo: true,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// Demo data for last 10 years (monthly)
function getDemoCPIData() {
  const data: { date: string; value: number }[] = [];
  const now = new Date();
  
  for (let i = 120; i >= 0; i--) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);
    
    // Simulate realistic CPI YoY data
    let baseValue = 2.0;
    const year = date.getFullYear();
    const month = date.getMonth();
    
    // 2015-2019: ~1.5-2.5%
    if (year >= 2015 && year <= 2019) baseValue = 1.8 + Math.sin(month / 3) * 0.5;
    // 2020: COVID dip
    else if (year === 2020) baseValue = month < 6 ? 1.5 - month * 0.2 : 1.0 + month * 0.1;
    // 2021-2022: Inflation spike
    else if (year === 2021) baseValue = 1.5 + month * 0.5;
    else if (year === 2022) baseValue = 7.0 + Math.sin(month / 2) * 1.5;
    // 2023-2024: Cooling
    else if (year === 2023) baseValue = 6.5 - month * 0.3;
    else if (year >= 2024) baseValue = 3.0 + Math.sin(month / 4) * 0.5;
    
    data.push({
      date: date.toISOString().split("T")[0],
      value: Math.round(baseValue * 100) / 100,
    });
  }
  
  return data;
}

function getDemoFedFundsData() {
  const data: { date: string; value: number }[] = [];
  const now = new Date();
  
  for (let i = 120; i >= 0; i--) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);
    
    let rate = 0.25;
    const year = date.getFullYear();
    const month = date.getMonth();
    
    // 2015-2018: Gradual increase
    if (year === 2015) rate = 0.25;
    else if (year === 2016) rate = 0.5;
    else if (year === 2017) rate = 1.0 + month * 0.1;
    else if (year === 2018) rate = 1.75 + month * 0.1;
    else if (year === 2019) rate = 2.5 - month * 0.1;
    // 2020: COVID cuts
    else if (year === 2020) rate = month < 3 ? 1.5 : 0.25;
    // 2021: Near zero
    else if (year === 2021) rate = 0.25;
    // 2022-2023: Aggressive hikes
    else if (year === 2022) rate = 0.25 + month * 0.4;
    else if (year === 2023) rate = 4.5 + Math.min(month * 0.25, 1.0);
    // 2024-2025: Holding/cutting
    else if (year >= 2024) rate = 5.25 - Math.min(month * 0.1, 0.75);
    
    data.push({
      date: date.toISOString().split("T")[0],
      value: Math.round(rate * 100) / 100,
    });
  }
  
  return data;
}

