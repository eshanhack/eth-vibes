import { NextResponse } from "next/server";

// X API Bearer Token - set in environment variable
// Decode URL-encoded tokens if needed
const rawToken = process.env.X_BEARER_TOKEN || "";
const X_BEARER_TOKEN = decodeURIComponent(rawToken);
const TARGET_USERNAME = "DeItaone"; // Financial news account (capital D, capital I, not L)

// Cache configuration - cache tweets for 1 hour to avoid rate limits
// X API free tier has very strict limits (15 requests per 15 min window)
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
interface TweetData {
  id: string;
  text: string;
  createdAt: string;
  timestamp: number;
  url: string | null;
}
interface CachedData {
  tweets: TweetData[];
  timestamp: number;
  source: string;
}
let cachedTweets: CachedData | null = null;

// Demo tweets fallback
function generateDemoTweets() {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  
  const headlines = [
    "BREAKING: Fed Chair Powell signals potential rate cuts in Q1 2025",
    "BlackRock Bitcoin ETF sees record $500M daily inflow",
    "US CPI comes in at 2.9%, below expectations of 3.1%",
    "Ethereum spot ETF approval expected within 30 days - sources",
    "ECB cuts rates by 25bps, signals more easing ahead",
    "China announces $500B stimulus package for property sector",
    "NVIDIA beats earnings, guides higher on AI demand",
    "Goldman Sachs raises S&P 500 target to 6,500 for 2025",
    "US 10Y yield drops below 4% for first time since September",
    "Tether market cap hits $100B milestone",
    "Apple announces $100B buyback program, largest in history",
    "Bank of Japan signals end to negative rate policy",
    "US Jobless claims fall to 201K, lowest since October",
    "Microsoft Azure revenue up 29% on AI infrastructure demand",
    "Bitcoin breaks $100K resistance, eyes all-time highs",
    "Fed Waller: 'Soft landing still very much achievable'",
    "Oil drops 5% on surprise inventory build, OPEC+ uncertainty",
    "European stocks hit record highs on ECB dovish pivot",
    "Meta announces $40B AI infrastructure investment",
    "US Dollar index falls to 3-month low on rate cut expectations",
  ];
  
  return headlines.map((text, index) => {
    const hoursAgo = index * 4 + Math.floor(Math.random() * 3);
    const timestamp = now - (hoursAgo * HOUR);
    
    return {
      id: `demo-${index}-${timestamp}`,
      text: text,
      createdAt: new Date(timestamp).toISOString(),
      timestamp: timestamp,
      url: null,
    };
  });
}

// Store last error for debugging
let lastApiError: string | null = null;

// Fetch user ID from username
async function getUserId(username: string): Promise<string | null> {
  const url = `https://api.twitter.com/2/users/by/username/${username}`;
  
  console.log("Fetching user ID from:", url);
  console.log("Token length:", X_BEARER_TOKEN.length);
  console.log("Token starts with:", X_BEARER_TOKEN.substring(0, 20) + "...");
  
  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${X_BEARER_TOKEN}`,
      },
    });

    const responseText = await response.text();
    console.log(`User lookup response (${response.status}):`, responseText);

    if (!response.ok) {
      lastApiError = `Status ${response.status}: ${responseText}`;
      console.error("Failed to get user ID:", lastApiError);
      return null;
    }

    const data = JSON.parse(responseText);
    
    if (data.data?.id) {
      return data.data.id;
    }
    
    if (data.errors) {
      lastApiError = JSON.stringify(data.errors);
      console.error("API returned errors:", data.errors);
    }
    
    return null;
  } catch (error) {
    lastApiError = String(error);
    console.error("Error fetching user ID:", error);
    return null;
  }
}

// Fetch tweets from user
async function getUserTweets(userId: string): Promise<Record<string, unknown>[] | null> {
  // X API v2 - get user tweets
  // tweet.fields: created_at for timestamp
  // max_results: 10-100, we'll use 20
  const url = `https://api.twitter.com/2/users/${userId}/tweets?max_results=20&tweet.fields=created_at,text&exclude=retweets,replies`;
  
  console.log("Fetching tweets from:", url);
  
  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${X_BEARER_TOKEN}`,
      },
    });

    const responseText = await response.text();
    console.log(`Tweets response (${response.status}):`, responseText.substring(0, 500));

    if (!response.ok) {
      lastApiError = `Tweets fetch failed: ${response.status} - ${responseText}`;
      console.error(lastApiError);
      return null;
    }

    const data = JSON.parse(responseText);
    console.log(`Fetched ${data.data?.length || 0} tweets`);
    
    if (data.data && Array.isArray(data.data)) {
      return data.data;
    }
    
    lastApiError = "No tweets in response: " + responseText.substring(0, 200);
    return null;
  } catch (error) {
    lastApiError = `Tweets fetch error: ${String(error)}`;
    console.error("Error fetching tweets:", error);
    return null;
  }
}

// Transform X API response to our format
function transformTweets(tweets: Record<string, unknown>[], username: string) {
  return tweets.map((tweet) => {
    const id = tweet.id as string;
    const text = tweet.text as string || "";
    const createdAt = tweet.created_at as string || "";
    
    // Parse timestamp
    let timestamp = 0;
    if (createdAt) {
      const parsed = new Date(createdAt);
      timestamp = isNaN(parsed.getTime()) ? 0 : parsed.getTime();
      console.log(`Tweet ${id}: createdAt="${createdAt}" -> timestamp=${timestamp} (${new Date(timestamp).toISOString()})`);
    }

    return {
      id,
      text,
      createdAt,
      timestamp,
      url: `https://x.com/${username}/status/${id}`,
    };
  }).filter((tweet) => tweet.text.length > 0);
}

export async function GET() {
  console.log("\n========================================");
  console.log("Fetching tweets for @" + TARGET_USERNAME);
  console.log("Using Official X API v2");
  console.log("========================================");
  
  // Check cache first to avoid rate limits
  if (cachedTweets && (Date.now() - cachedTweets.timestamp) < CACHE_DURATION_MS) {
    console.log("Returning cached tweets (age: " + Math.round((Date.now() - cachedTweets.timestamp) / 1000) + "s)");
    return NextResponse.json({
      tweets: cachedTweets.tweets,
      source: cachedTweets.source + " (cached)",
      count: cachedTweets.tweets.length,
      isDemo: false,
      cached: true,
      cacheAge: Math.round((Date.now() - cachedTweets.timestamp) / 1000),
    });
  }
  
  // Check for bearer token
  if (!X_BEARER_TOKEN) {
    console.log("No X_BEARER_TOKEN set - returning demo data");
    const demoTweets = generateDemoTweets();
    return NextResponse.json({
      tweets: demoTweets,
      source: "Demo Data (X_BEARER_TOKEN not configured)",
      count: demoTweets.length,
      isDemo: true
    });
  }

  try {
    // Step 1: Get user ID
    console.log("Step 1: Looking up user ID for @" + TARGET_USERNAME);
    const userId = await getUserId(TARGET_USERNAME);
    
    if (!userId) {
      console.error("Could not find user ID for @" + TARGET_USERNAME);
      const demoTweets = generateDemoTweets();
      return NextResponse.json({
        tweets: demoTweets,
        source: "Demo Data (User lookup failed)",
        count: demoTweets.length,
        isDemo: true,
        debug: {
          username: TARGET_USERNAME,
          tokenConfigured: X_BEARER_TOKEN.length > 0,
          tokenLength: X_BEARER_TOKEN.length,
          apiError: lastApiError,
        }
      });
    }
    
    console.log("Found user ID:", userId);

    // Step 2: Get user's tweets
    console.log("Step 2: Fetching tweets for user ID:", userId);
    const rawTweets = await getUserTweets(userId);
    
    if (!rawTweets || rawTweets.length === 0) {
      console.error("No tweets returned from API");
      const demoTweets = generateDemoTweets();
      return NextResponse.json({
        tweets: demoTweets,
        source: "Demo Data (No tweets found)",
        count: demoTweets.length,
        isDemo: true,
        debug: {
          userId,
          apiError: lastApiError,
        }
      });
    }

    // Step 3: Transform to our format
    const tweets = transformTweets(rawTweets, TARGET_USERNAME);
    console.log(`Successfully processed ${tweets.length} tweets`);
    
    if (tweets.length > 0) {
      console.log("First tweet:", {
        text: tweets[0].text.substring(0, 100) + "...",
        createdAt: tweets[0].createdAt,
      });
    }

    // Cache the results
    cachedTweets = {
      tweets,
      timestamp: Date.now(),
      source: "X API v2 (Official)",
    };
    console.log("Cached tweets for 5 minutes");

    return NextResponse.json({
      tweets,
      source: "X API v2 (Official)",
      count: tweets.length,
      isDemo: false
    });
    
  } catch (error) {
    console.error("Fatal error fetching tweets:", error);
    const demoTweets = generateDemoTweets();
    return NextResponse.json({
      tweets: demoTweets,
      source: "Demo Data (API Error)",
      count: demoTweets.length,
      isDemo: true,
      error: String(error)
    });
  }
}
