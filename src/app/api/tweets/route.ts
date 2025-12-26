import { NextResponse } from "next/server";

// Apify token should be set in environment variable APIFY_TOKEN
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";
const TARGET_USER = "Deltaone";

// Demo tweets for when Twitter API is unavailable
// Using realistic @Deltaone style financial news headlines
function generateDemoTweets() {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  
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
    // Spread tweets over the past few days
    const hoursAgo = index * 4 + Math.floor(Math.random() * 3);
    const timestamp = now - (hoursAgo * HOUR);
    const demoId = `demo-${index}-${timestamp}`;
    
    return {
      id: demoId,
      text: text,
      createdAt: new Date(timestamp).toISOString(),
      timestamp: timestamp,
      url: null, // Demo tweets don't have real URLs
    };
  });
}

// Twitter scrapers that work WITHOUT login (post June 2023)
// Based on Apify's recommendation in their error message
const TWITTER_SCRAPERS = [
  // Tweet Flash - recommended by Apify for no-login scraping
  {
    id: "shanes~tweet-flash",
    name: "Tweet Flash (No Login)",
    buildInput: () => ({
      searchTerms: [`from:${TARGET_USER}`],
      maxTweets: 20,
      sort: "Latest",
    }),
  },
  // Alternative input format for Tweet Flash
  {
    id: "shanes~tweet-flash",
    name: "Tweet Flash (handle)",
    buildInput: () => ({
      handles: [TARGET_USER],
      maxTweets: 20,
    }),
  },
  // Easy Twitter Search Scraper - also recommended for no-login
  {
    id: "web.harvester~easy-twitter-search-scraper",
    name: "Easy Twitter Search Scraper",
    buildInput: () => ({
      searchQuery: `from:${TARGET_USER}`,
      maxTweets: 20,
      sortBy: "Latest",
    }),
  },
  // Rapid Twitter Scraper
  {
    id: "curious_coder~twitter-scraper",
    name: "Curious Coder Twitter Scraper",
    buildInput: () => ({
      searchTerms: [`from:${TARGET_USER}`],
      maxItems: 20,
    }),
  },
  // Tweet Scraper V2
  {
    id: "heymoon~tweet-scraper-v2",
    name: "Tweet Scraper V2",
    buildInput: () => ({
      searchQueries: [`from:${TARGET_USER}`],
      maxTweets: 20,
      sortType: "Latest",
    }),
  },
  // Nitter-based scraper (Nitter is a Twitter frontend that might still work)
  {
    id: "pocesar~nitter-scraper",
    name: "Nitter Scraper",
    buildInput: () => ({
      usernames: [TARGET_USER],
      maxTweets: 20,
    }),
  },
];

async function tryFetchWithActor(actorConfig: typeof TWITTER_SCRAPERS[0]): Promise<Record<string, unknown>[] | null> {
  const apiUrl = `https://api.apify.com/v2/acts/${actorConfig.id}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`;
  const input = actorConfig.buildInput();

  console.log(`\n=== Trying: ${actorConfig.name} ===`);
  console.log("Actor ID:", actorConfig.id);
  console.log("Input:", JSON.stringify(input, null, 2));

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed with status ${response.status}:`, errorText.substring(0, 500));
      return null;
    }

    const items = await response.json();
    console.log(`Returned ${Array.isArray(items) ? items.length : 0} items`);
    
    if (Array.isArray(items) && items.length > 0) {
      // Log first item structure for debugging
      console.log("First item keys:", Object.keys(items[0]));
      console.log("First item sample:", JSON.stringify(items[0]).substring(0, 500));
      return items;
    }
    
    console.log("No items returned");
    return null;
  } catch (error) {
    console.error(`Error:`, error);
    return null;
  }
}

function transformTweets(items: Record<string, unknown>[]) {
  return items.map((item) => {
    // Try different field names for the tweet text
    const text = (item.full_text as string) || 
                 (item.text as string) || 
                 (item.content as string) ||
                 (item.tweet as string) ||
                 (item.body as string) ||
                 (item.tweetText as string) ||
                 "";
    
    // Try different field names for created time
    let createdAtRaw = (item.created_at as string) || 
                       (item.createdAt as string) || 
                       (item.timestamp as string) ||
                       (item.date as string) ||
                       (item.tweetedAt as string) ||
                       (item.postedAt as string) ||
                       (item.time as string) ||
                       (item.datetime as string) ||
                       "";
    
    // Try different field names for ID
    const id = (item.id as string) || 
               (item.id_str as string) || 
               (item.tweetId as string) ||
               (item.tweet_id as string) ||
               String(Date.now() + Math.random());
    
    // Get URL if available
    const url = (item.url as string) ||
                (item.tweetUrl as string) ||
                (item.link as string) ||
                null;

    // Parse timestamp - try multiple formats
    let timestamp = 0;
    if (createdAtRaw) {
      const parsed = new Date(createdAtRaw);
      timestamp = isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }
    
    // If timestamp is 0, try parsing from URL or id
    if (timestamp === 0 && item.url) {
      const urlStr = item.url as string;
      const match = urlStr.match(/status\/(\d+)/);
      if (match) {
        // Twitter snowflake ID contains timestamp
        try {
          const snowflakeId = BigInt(match[1]);
          const twitterEpoch = BigInt(1288834974657);
          timestamp = Number((snowflakeId >> BigInt(22)) + twitterEpoch);
        } catch (e) {
          console.error("Failed to parse snowflake ID:", e);
        }
      }
    }

    // If still no timestamp and we have a string ID that looks like a snowflake
    if (timestamp === 0 && id && /^\d{18,}$/.test(String(id))) {
      try {
        const snowflakeId = BigInt(id);
        const twitterEpoch = BigInt(1288834974657);
        timestamp = Number((snowflakeId >> BigInt(22)) + twitterEpoch);
      } catch (e) {
        console.error("Failed to parse ID as snowflake:", e);
      }
    }

    return {
      id: String(id),
      text,
      createdAt: createdAtRaw || (timestamp > 0 ? new Date(timestamp).toISOString() : ""),
      timestamp,
      url,
    };
  }).filter((tweet) => tweet.text.length > 0);
}

export async function GET() {
  console.log("\n========================================");
  console.log("Fetching tweets for @" + TARGET_USER);
  console.log("Using no-login scrapers (post June 2023)");
  console.log("========================================");
  
  // If no API token, return demo data immediately
  if (!APIFY_TOKEN) {
    console.log("No APIFY_TOKEN set - returning demo data");
    const demoTweets = generateDemoTweets();
    return NextResponse.json({
      tweets: demoTweets,
      source: "Demo Data (APIFY_TOKEN not configured)",
      count: demoTweets.length,
      isDemo: true
    });
  }
  
  try {
    let items: Record<string, unknown>[] | null = null;
    let successfulScraper = "";

    // Try each scraper until one works
    for (const scraper of TWITTER_SCRAPERS) {
      items = await tryFetchWithActor(scraper);
      if (items && items.length > 0) {
        successfulScraper = scraper.name;
        console.log(`\n✓ SUCCESS with: ${scraper.name}`);
        break;
      }
    }

    if (!items || items.length === 0) {
      console.error("\n✗ All Twitter scrapers failed or returned no data");
      console.error("Twitter requires login for most content since June 2023");
      console.log("Returning demo data for UI testing...");
      
      // Return demo data so the UI can be tested
      // These are sample financial news headlines with realistic timestamps
      const demoTweets = generateDemoTweets();
      
      return NextResponse.json(
        { 
          tweets: demoTweets,
          source: "Demo Data (Twitter API unavailable)",
          count: demoTweets.length,
          isDemo: true
        },
        { status: 200 }
      );
    }

    const tweets = transformTweets(items);
    console.log(`\nFinal processed tweets: ${tweets.length}`);
    console.log(`Source: ${successfulScraper}`);
    
    // Log first tweet for verification
    if (tweets.length > 0) {
      console.log("Sample tweet:", {
        text: tweets[0].text.substring(0, 100) + "...",
        createdAt: tweets[0].createdAt,
        timestamp: tweets[0].timestamp,
      });
    }

    return NextResponse.json({ 
      tweets,
      source: successfulScraper,
      count: tweets.length 
    });
  } catch (error) {
    console.error("Fatal error fetching tweets:", error);
    return NextResponse.json(
      { error: "Failed to fetch tweets", details: String(error) },
      { status: 500 }
    );
  }
}
