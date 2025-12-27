"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion, LayoutGroup, AnimatePresence } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { 
  getStoredTweetsForAsset, 
  saveTweetImpact, 
  storedTweetToAppFormat,
  getStoredMacroEventsForAsset,
  saveMacroEventPrices,
  storedMacroEventToAppFormat,
} from "@/lib/supabase";

type ConnectionStatus = "connecting" | "connected" | "disconnected";
type Direction = "up" | "down";
type MoveSize = "small" | "medium" | "whale" | null;
type PriceSource = "hyperliquid" | "binance";

// Supported assets
type Asset = "BTC" | "ETH" | "SOL" | "XRP";

// Asset configuration
const ASSET_CONFIG: Record<Asset, {
  name: string;
  symbol: string;
  binanceSymbol: string;
  decimals: number;
  color: string;
}> = {
  BTC: { name: "Bitcoin", symbol: "BTC", binanceSymbol: "btcusdt", decimals: 2, color: "#F7931A" },
  ETH: { name: "Ethereum", symbol: "ETH", binanceSymbol: "ethusdt", decimals: 2, color: "#627EEA" },
  SOL: { name: "Solana", symbol: "SOL", binanceSymbol: "solusdt", decimals: 2, color: "#9945FF" },
  XRP: { name: "Ripple", symbol: "XRP", binanceSymbol: "xrpusdt", decimals: 4, color: "#23292F" },
};

// Timeframe weights for impact score calculation
// Lower timeframes weighted higher - immediate moves more likely caused by headline
const TIMEFRAME_WEIGHTS: Record<TimeframeKey, number> = {
  "1m": 4,   // Highest weight - immediate reaction
  "10m": 3,  // High weight - short-term impact
  "30m": 2,  // Medium weight
  "1h": 1,   // Lowest weight - could be other factors
};

// Timeframe keys for multi-timeframe analysis
type TimeframeKey = "1m" | "10m" | "30m" | "1h";

// Individual timeframe data
interface TimeframeData {
  price: number | null;
  change: number | null;
  pending: boolean;
}

// Tweet with multi-timeframe price data
interface TweetWithPrice {
  id: string;
  text: string;
  createdAt: string;
  timestamp: number;
  url?: string;
  priceAtT: number | null;
  timeframes: Record<TimeframeKey, TimeframeData>;
  impactScore: number;
  impactDirection: "positive" | "negative" | "neutral";
}

// Spring transition for digit roller - snappy, mechanical feel
const digitSpringTransition = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
};

// Audio throttle interval for Binance (max 5 sounds per second = 200ms)
const AUDIO_THROTTLE_MS = 200;

// Favicon generator functions
const getFaviconDefault = (symbol: string) => "data:image/svg+xml," + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" fill="#000"/>
    <text x="16" y="22" font-family="system-ui" font-size="${symbol.length > 2 ? 10 : 14}" font-weight="bold" fill="#fff" text-anchor="middle">${symbol}</text>
  </svg>
`);

const FAVICON_UP = "data:image/svg+xml," + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" fill="#000"/>
    <path d="M16 6 L26 20 L20 20 L20 26 L12 26 L12 20 L6 20 Z" fill="#10b981"/>
  </svg>
`);

const FAVICON_DOWN = "data:image/svg+xml," + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" fill="#000"/>
    <path d="M16 26 L26 12 L20 12 L20 6 L12 6 L12 12 L6 12 Z" fill="#ef4444"/>
  </svg>
`);

// Height of each digit in the roller (matches line-height)
const DIGIT_HEIGHT = 1.2; // in em units

// ========== usePriceFeed Hook - Unified price feed for all assets ==========
interface UsePriceFeedResult {
  price: number | null;
  formattedPrice: string | null;
  status: ConnectionStatus;
}

function usePriceFeed(
  asset: Asset,
  source: PriceSource,
  onPriceChange?: (price: number, prevPrice: number) => void
): UsePriceFeedResult {
  const [price, setPrice] = useState<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Use ref for callback to avoid stale closure issues
  const onPriceChangeRef = useRef(onPriceChange);
  onPriceChangeRef.current = onPriceChange;
  
  // Track current asset/source to prevent stale updates
  const currentAssetRef = useRef(asset);
  const currentSourceRef = useRef(source);
  
  const config = ASSET_CONFIG[asset];

  useEffect(() => {
    // Update refs
    currentAssetRef.current = asset;
    currentSourceRef.current = source;
    
    // Reset state when asset or source changes
    setPrice(null);
    setStatus("connecting");
    prevPriceRef.current = null;

    // Clean up previous connections
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Capture current values for closure
    const capturedAsset = asset;
    const capturedSource = source;
    const capturedConfig = config;

    // Connect to WebSocket
    const connect = () => {
      // Skip if asset/source changed
      if (currentAssetRef.current !== capturedAsset || currentSourceRef.current !== capturedSource) {
        return;
      }
      
      setStatus("connecting");

      let ws: WebSocket;

      if (capturedSource === "hyperliquid" && capturedAsset === "ETH") {
        // Hyperliquid only supports ETH
        ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
        
        ws.onopen = () => {
          if (currentAssetRef.current !== capturedAsset || currentSourceRef.current !== capturedSource) {
            ws.close();
            return;
          }
          setStatus("connected");
          ws.send(
            JSON.stringify({
              method: "subscribe",
              subscription: { type: "allMids" },
            })
          );
        };

        ws.onmessage = (event) => {
          // Skip if asset/source changed
          if (currentAssetRef.current !== capturedAsset || currentSourceRef.current !== capturedSource) {
            return;
          }
          
          try {
            const data = JSON.parse(event.data);
            if (data.channel === "allMids" && data.data?.mids) {
              const mid = data.data.mids[capturedAsset];
              if (mid) {
                const newPrice = parseFloat(mid);
                if (prevPriceRef.current !== null && onPriceChangeRef.current) {
                  onPriceChangeRef.current(newPrice, prevPriceRef.current);
                }
                prevPriceRef.current = newPrice;
                setPrice(newPrice);
              }
            }
          } catch (e) {
            console.error("Hyperliquid parse error:", e);
          }
        };
      } else {
        // Binance - supports all major tokens
        const symbol = capturedConfig.binanceSymbol || "ethusdt";
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@aggTrade`);
        
        ws.onopen = () => {
          if (currentAssetRef.current !== capturedAsset || currentSourceRef.current !== capturedSource) {
            ws.close();
            return;
          }
          setStatus("connected");
        };

        ws.onmessage = (event) => {
          // Skip if asset/source changed
          if (currentAssetRef.current !== capturedAsset || currentSourceRef.current !== capturedSource) {
            return;
          }
          
          try {
            const data = JSON.parse(event.data);
            if (data.p) {
              const newPrice = parseFloat(data.p);
              if (prevPriceRef.current !== null && onPriceChangeRef.current) {
                onPriceChangeRef.current(newPrice, prevPriceRef.current);
              }
              prevPriceRef.current = newPrice;
              setPrice(newPrice);
            }
          } catch (e) {
            console.error("Binance parse error:", e);
          }
        };
      }

      ws.onclose = () => {
        if (currentAssetRef.current === capturedAsset && currentSourceRef.current === capturedSource) {
          setStatus("disconnected");
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [asset, source, config]);

  const formattedPrice = useMemo(() => {
    if (price === null) return null;
    return price.toLocaleString("en-US", {
      minimumFractionDigits: config.decimals,
      maximumFractionDigits: config.decimals,
    });
  }, [price, config.decimals]);

  return { price, formattedPrice, status };
}

// ========== useNewsFeed Hook ==========
const PRICE_FETCH_DELAY_MS = 200; // Delay between price fetches to avoid rate limiting

// Helper function to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Default empty timeframes
const EMPTY_TIMEFRAMES: Record<TimeframeKey, TimeframeData> = {
  "1m": { price: null, change: null, pending: true },
  "10m": { price: null, change: null, pending: true },
  "30m": { price: null, change: null, pending: true },
  "1h": { price: null, change: null, pending: true },
};

// Timeframe configurations for client-side fetching
const TIMEFRAME_CONFIGS: { key: TimeframeKey; ms: number; interval: string }[] = [
  { key: "1m", ms: 60 * 1000, interval: "1m" },
  { key: "10m", ms: 10 * 60 * 1000, interval: "1m" },
  { key: "30m", ms: 30 * 60 * 1000, interval: "1m" },
  { key: "1h", ms: 60 * 60 * 1000, interval: "1h" },
];

// Client-side function to fetch price from Binance directly
async function fetchBinancePrice(
  timestamp: number, 
  interval: string = "1m",
  symbol: string = "ETHUSDT"
): Promise<number | null> {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${timestamp}&limit=1`;
    const response = await fetch(url);
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      return parseFloat(data[0][4]); // Close price
    }
    
    return null;
  } catch {
    return null;
  }
}

// Client-side function to fetch multi-timeframe prices
async function fetchMultiTimeframePricesClient(
  timestamp: number,
  asset: Asset = "ETH"
): Promise<{
  priceAtT: number | null;
  timeframes: Record<TimeframeKey, TimeframeData>;
  impactScore: number;
  impactDirection: "positive" | "negative" | "neutral";
}> {
  const now = Date.now();
  const config = ASSET_CONFIG[asset];
  const symbol = config.binanceSymbol.toUpperCase();
  
  // Fetch base price
  const priceAtT = await fetchBinancePrice(timestamp, "1m", symbol);
  
  if (priceAtT === null) {
    return {
      priceAtT: null,
      timeframes: {
        "1m": { price: null, change: null, pending: false },
        "10m": { price: null, change: null, pending: false },
        "30m": { price: null, change: null, pending: false },
        "1h": { price: null, change: null, pending: false },
      },
      impactScore: 0,
      impactDirection: "neutral",
    };
  }

  // Fetch each timeframe
  const timeframes: Record<TimeframeKey, TimeframeData> = {} as Record<TimeframeKey, TimeframeData>;
  
  for (const tfConfig of TIMEFRAME_CONFIGS) {
    const targetTime = timestamp + tfConfig.ms;
    
    if (targetTime > now) {
      timeframes[tfConfig.key] = { price: null, change: null, pending: true };
      continue;
    }
    
    await delay(100); // Small delay to avoid rate limits
    const price = await fetchBinancePrice(targetTime, tfConfig.interval, symbol);
    
    let change: number | null = null;
    if (price !== null && priceAtT !== 0) {
      change = ((price - priceAtT) / priceAtT) * 100;
    }
    
    timeframes[tfConfig.key] = { price, change, pending: false };
  }

  // Calculate weighted impact score - lower timeframes weighted higher
  let weightedPositive = 0;
  let weightedNegative = 0;
  let weightedMagnitude = 0;
  let totalWeight = 0;

  for (const [key, tf] of Object.entries(timeframes) as [TimeframeKey, TimeframeData][]) {
    if (tf.change !== null) {
      const weight = TIMEFRAME_WEIGHTS[key];
      totalWeight += weight;
      weightedMagnitude += Math.abs(tf.change) * weight;
      if (tf.change > 0) weightedPositive += weight;
      else if (tf.change < 0) weightedNegative += weight;
    }
  }

  // Direction based on weighted votes
  const impactDirection = weightedPositive > weightedNegative ? "positive" : 
                          weightedNegative > weightedPositive ? "negative" : "neutral";
  
  // Score = weighted average magnitude * consistency factor
  // Consistency factor rewards when all timeframes agree on direction
  const consistencyFactor = totalWeight > 0 
    ? Math.max(weightedPositive, weightedNegative) / totalWeight 
    : 0;
  const avgWeightedMagnitude = totalWeight > 0 ? weightedMagnitude / totalWeight : 0;
  const impactScore = avgWeightedMagnitude * consistencyFactor;

  return { priceAtT, timeframes, impactScore, impactDirection };
}

function useNewsFeed(selectedAsset: Asset = "ETH") {
  const [tweets, setTweets] = useState<TweetWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [source, setSource] = useState<string>("");
  
  // Track raw tweets separately so we can re-fetch prices when asset changes
  const [rawTweets, setRawTweets] = useState<{ id: string; text: string; createdAt: string; timestamp: number; url?: string }[]>([]);
  // Track current asset for cancellation
  const currentAssetRef = useRef(selectedAsset);
  // Track if we're fetching prices
  const fetchingPricesRef = useRef(false);
  // Cache for stored tweets by asset (to avoid re-fetching from Supabase)
  const cachedTweetsByAssetRef = useRef<Map<Asset, Map<string, ReturnType<typeof storedTweetToAppFormat>>>>(new Map());

  // Function to update a single tweet's price data and save to Supabase
  const updateTweetPrice = useCallback(async (tweetId: string, timestamp: number) => {
    const priceData = await fetchMultiTimeframePricesClient(timestamp, selectedAsset);
    
    setTweets(prevTweets => {
      const updatedTweets = prevTweets.map(tweet => 
        tweet.id === tweetId 
          ? { ...tweet, ...priceData }
          : tweet
      );
      
      // Save to Supabase for all assets
      const updatedTweet = updatedTweets.find(t => t.id === tweetId);
      if (updatedTweet) {
        saveTweetImpact({
          id: updatedTweet.id,
          asset: selectedAsset,
          text: updatedTweet.text,
          createdAt: updatedTweet.createdAt,
          timestamp: updatedTweet.timestamp,
          url: updatedTweet.url || null,
          priceAtT: updatedTweet.priceAtT,
          timeframes: updatedTweet.timeframes,
          impactScore: updatedTweet.impactScore,
          impactDirection: updatedTweet.impactDirection,
        }).catch(err => console.error("Failed to save to Supabase:", err));
      }
      
      return updatedTweets;
    });
  }, [selectedAsset]);

  // Initial fetch of tweets (only once)
  useEffect(() => {
    async function fetchTweets() {
      try {
        setLoading(true);
        setError(null);

        // Fetch fresh tweets from X API
        console.log("Fetching tweets from X API...");
        const tweetsRes = await fetch("/api/tweets");
        if (!tweetsRes.ok) {
          throw new Error(`Failed to fetch tweets: ${tweetsRes.status}`);
        }
        const tweetsData = await tweetsRes.json();

        console.log("Tweets API response:", tweetsData);

        if (tweetsData.error && (!tweetsData.tweets || tweetsData.tweets.length === 0)) {
          throw new Error(tweetsData.error);
        }

        const fetchedTweets = tweetsData.tweets || [];
        setRawTweets(fetchedTweets);
        console.log(`Received ${fetchedTweets.length} tweets from X API`);
        
        if (tweetsData.isDemo) {
          setIsDemo(true);
        }
        if (tweetsData.source) {
          setSource(tweetsData.source);
        }
        
        setLoading(false);
        
      } catch (err) {
        console.error("Error in fetchTweets:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    }

    fetchTweets();
  }, []);

  // Fetch prices when rawTweets or selectedAsset changes
  useEffect(() => {
    if (rawTweets.length === 0) {
      return;
    }

    // Update current asset ref for cancellation
    currentAssetRef.current = selectedAsset;
    
    async function fetchPrices() {
      const asset = selectedAsset;
      const now = Date.now();
      
      console.log(`Starting price fetch for ${asset}...`);
      fetchingPricesRef.current = true;

      // Try to get cached data from Supabase for this asset
      let cachedMap = cachedTweetsByAssetRef.current.get(asset);
      
      if (!cachedMap) {
        console.log(`Fetching cached ${asset} prices from Supabase...`);
        const storedTweets = await getStoredTweetsForAsset(asset);
        cachedMap = new Map(storedTweets.map(t => [t.id, storedTweetToAppFormat(t)]));
        cachedTweetsByAssetRef.current.set(asset, cachedMap);
        console.log(`Found ${storedTweets.length} cached ${asset} tweets in Supabase`);
      }

      // Check if asset changed during Supabase fetch
      if (currentAssetRef.current !== asset) {
        console.log(`Asset changed during cache fetch, stopping`);
        return;
      }

      // Initialize tweets - use cached data if available, otherwise pending
      const initializedTweets: TweetWithPrice[] = rawTweets.map(tweet => {
        const cached = cachedMap?.get(tweet.id);
        if (cached && cached.priceAtT !== null) {
          // Use cached data
          return {
            ...tweet,
            priceAtT: cached.priceAtT,
            timeframes: cached.timeframes,
            impactScore: cached.impactScore,
            impactDirection: cached.impactDirection,
          } as TweetWithPrice;
        }
        // No cache, initialize with pending
        return {
          ...tweet,
          priceAtT: null,
          timeframes: { ...EMPTY_TIMEFRAMES },
          impactScore: 0,
          impactDirection: "neutral" as const,
        };
      });

      setTweets(initializedTweets);

      // Fetch prices only for tweets that need it
      for (let i = 0; i < initializedTweets.length; i++) {
        // Check if asset changed mid-fetch
        if (currentAssetRef.current !== asset) {
          console.log(`Asset changed from ${asset} to ${currentAssetRef.current}, stopping price fetch`);
          return;
        }

        const tweet = initializedTweets[i];
        
        // Skip if timestamp is invalid
        if (!tweet.timestamp || tweet.timestamp <= 0 || tweet.timestamp > now) {
          continue;
        }

        // Skip if already has complete data from cache
        const needsFetch = 
          tweet.priceAtT === null ||
          tweet.timeframes["1m"].pending ||
          tweet.timeframes["10m"].pending ||
          tweet.timeframes["30m"].pending ||
          tweet.timeframes["1h"].pending;

        if (!needsFetch) {
          console.log(`Tweet ${i + 1}/${initializedTweets.length} has cached ${asset} data, skipping`);
          continue;
        }
        
        try {
          console.log(`Fetching ${asset} prices for tweet ${i + 1}/${initializedTweets.length}`);
          
          const priceData = await fetchMultiTimeframePricesClient(tweet.timestamp, asset);

          // Check again if asset changed
          if (currentAssetRef.current !== asset) {
            console.log(`Asset changed during fetch, stopping`);
            return;
          }

          // Update this specific tweet with price data
          setTweets(prevTweets =>
            prevTweets.map(t => t.id === tweet.id ? { ...t, ...priceData } : t)
          );

          // Update local cache
          const rawTweet = rawTweets.find(t => t.id === tweet.id);
          if (rawTweet) {
            cachedMap?.set(tweet.id, {
              id: rawTweet.id,
              text: rawTweet.text,
              createdAt: rawTweet.createdAt,
              timestamp: rawTweet.timestamp,
              url: rawTweet.url || null,
              ...priceData,
            });
          }

          // Save to Supabase for all assets
          saveTweetImpact({
            id: tweet.id,
            asset: asset,
            text: tweet.text,
            createdAt: tweet.createdAt,
            timestamp: tweet.timestamp,
            url: tweet.url || null,
            priceAtT: priceData.priceAtT,
            timeframes: priceData.timeframes,
            impactScore: priceData.impactScore,
            impactDirection: priceData.impactDirection,
          }).catch(err => console.error("Failed to save to Supabase:", err));

          // Throttle between requests
          if (i < initializedTweets.length - 1) {
            await delay(PRICE_FETCH_DELAY_MS);
          }
        } catch (err) {
          console.error(`Failed to fetch price for tweet ${tweet.id}:`, err);
        }
      }
      
      fetchingPricesRef.current = false;
      console.log(`Finished fetching ${asset} prices`);
    }

    fetchPrices();
    
  }, [rawTweets, selectedAsset]);

  return { tweets, loading, error, updateTweetPrice, isDemo, source, selectedAsset };
}

// ========== Components ==========

interface DigitColumnProps {
  digit: string;
  colorClass: string;
  moveSize: MoveSize;
  priceDirection: Direction | null;
}

function DigitColumn({ 
  digit, 
  colorClass, 
  moveSize,
  priceDirection,
}: DigitColumnProps) {
  const digitValue = parseInt(digit, 10);
  const yOffset = -digitValue * DIGIT_HEIGHT;

  const getGlowStyle = (): React.CSSProperties => {
    if (!priceDirection) return {};
    
    const isUp = priceDirection === "up";
    const baseColor = isUp ? "52, 211, 153" : "248, 113, 113";
    
    let glowIntensity = 0;
    let brightness = 1;
    
    if (moveSize === "small") {
      glowIntensity = 0.3;
      brightness = 1.05;
    } else if (moveSize === "medium") {
      glowIntensity = 0.5;
      brightness = 1.1;
    } else if (moveSize === "whale") {
      glowIntensity = 0.8;
      brightness = 1.2;
    }
    
    if (glowIntensity === 0) return {};
    
    return {
      textShadow: `
        0 0 ${10 * glowIntensity}px rgba(${baseColor}, ${glowIntensity}),
        0 0 ${20 * glowIntensity}px rgba(${baseColor}, ${glowIntensity * 0.8}),
        0 0 ${40 * glowIntensity}px rgba(${baseColor}, ${glowIntensity * 0.6})
      `,
      filter: `brightness(${brightness})`,
    };
  };

  const motionBlurClass = moveSize === "whale" ? "motion-blur-active" : "";

  return (
    <div 
      className={`relative overflow-hidden ${motionBlurClass}`}
      style={{ height: `${DIGIT_HEIGHT}em` }}
    >
      <motion.div
        className={`flex flex-col ${colorClass}`}
        style={getGlowStyle()}
        animate={{ y: `${yOffset}em` }}
        transition={digitSpringTransition}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <div
            key={num}
            className="flex items-center justify-center"
            style={{ height: `${DIGIT_HEIGHT}em`, lineHeight: `${DIGIT_HEIGHT}em` }}
          >
            {num}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

interface StaticCharProps {
  char: string;
  colorClass: string;
}

function StaticChar({ char, colorClass }: StaticCharProps) {
  return (
    <span 
      className={colorClass}
      style={{ lineHeight: `${DIGIT_HEIGHT}em` }}
    >
      {char}
    </span>
  );
}

interface DigitRollerProps {
  value: string;
  colorClass: string;
  moveSize: MoveSize;
  priceDirection: Direction | null;
}

function DigitRoller({ 
  value, 
  colorClass, 
  moveSize,
  priceDirection,
}: DigitRollerProps) {
  const characters = useMemo(() => value.split(""), [value]);

  return (
    <div className="flex items-center font-bold tracking-tight tabular-nums">
      {characters.map((char, index) => {
        const isDigit = /\d/.test(char);
        
        if (isDigit) {
          return (
            <DigitColumn
              key={`digit-${index}`}
              digit={char}
              colorClass={colorClass}
              moveSize={moveSize}
              priceDirection={priceDirection}
            />
          );
        }
        
        return (
          <StaticChar
            key={`static-${index}`}
            char={char}
            colorClass={colorClass}
          />
        );
      })}
    </div>
  );
}

// Source Selector Component
interface SourceSelectorProps {
  source: PriceSource;
  onSourceChange: (source: PriceSource) => void;
}

function SourceSelector({ source, onSourceChange }: SourceSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-white/5 rounded-lg">
      <button
        onClick={() => onSourceChange("hyperliquid")}
        className={`px-3 py-1.5 text-xs tracking-wider uppercase rounded transition-all duration-200 ${
          source === "hyperliquid"
            ? "bg-white/10 text-white"
            : "text-white/40 hover:text-white/60"
        }`}
      >
        Hyperliquid
      </button>
      <button
        onClick={() => onSourceChange("binance")}
        className={`px-3 py-1.5 text-xs tracking-wider uppercase rounded transition-all duration-200 ${
          source === "binance"
            ? "bg-white/10 text-white"
            : "text-white/40 hover:text-white/60"
        }`}
      >
        Binance
      </button>
        </div>
  );
}

// Asset Selector Dropdown Component
interface AssetSelectorProps {
  asset: Asset;
  onAssetChange: (asset: Asset) => void;
}

const ASSETS: Asset[] = ["BTC", "ETH", "SOL", "XRP"];

function AssetSelector({ asset, onAssetChange }: AssetSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const config = ASSET_CONFIG[asset];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10 hover:border-white/20 transition-all duration-200"
      >
        <div 
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <span className="text-white text-xs tracking-wider font-medium">
          {asset}
        </span>
        <svg 
          className={`w-3 h-3 text-white/50 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            
            {/* Dropdown */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 mt-1 w-40 bg-neutral-900 border border-white/10 rounded-lg overflow-hidden z-50 shadow-xl"
            >
              {ASSETS.map((a) => {
                const assetConfig = ASSET_CONFIG[a];
                const isSelected = a === asset;
                
                return (
                  <button
                    key={a}
                    onClick={() => {
                      onAssetChange(a);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-150 ${
                      isSelected 
                        ? "bg-white/10 text-white" 
                        : "text-white/60 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <div 
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: assetConfig.color }}
                    />
                    <div className="flex-1">
                      <span className="text-xs tracking-wider font-medium">{a}</span>
                      <span className="text-[10px] text-white/40 ml-2">{assetConfig.name}</span>
                    </div>
                    {isSelected && (
                      <svg className="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Source Badge Component - shows next to price
interface SourceBadgeProps {
  source: PriceSource;
  asset: Asset;
}

function SourceBadge({ source }: { source: PriceSource }) {
  if (source === "hyperliquid") {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 rounded border border-emerald-500/20">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-emerald-400/80 text-[10px] tracking-wider uppercase font-medium">HL</span>
      </div>
    );
  }
  
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 rounded border border-yellow-500/20">
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L6 8.5L12 6L18 8.5L12 2Z" fill="#F3BA2F"/>
        <path d="M12 6L6 8.5L12 15L18 8.5L12 6Z" fill="#F3BA2F"/>
        <path d="M6 12.5L12 19L12 15L6 12.5Z" fill="#F3BA2F"/>
        <path d="M18 12.5L12 19L12 15L18 12.5Z" fill="#F3BA2F"/>
      </svg>
      <span className="text-yellow-500/80 text-[10px] tracking-wider uppercase font-medium">BN</span>
    </div>
  );
}

// Tweet Card Component - Bloomberg Terminal Row Style
// Format: [Timestamp] | [Tweet Text] | [Price At Tweet] → [Price +10m] | [Glow Icon %]
// Timeframe configuration
const TIMEFRAMES: { key: TimeframeKey; label: string; threshold: number }[] = [
  { key: "1m", label: "1M", threshold: 60 * 1000 },
  { key: "10m", label: "10M", threshold: 10 * 60 * 1000 },
  { key: "30m", label: "30M", threshold: 30 * 60 * 1000 },
  { key: "1h", label: "1H", threshold: 60 * 60 * 1000 },
];

// Price Change Cell Component
function PriceChangeCell({ data, hasPendingData }: { data: TimeframeData; hasPendingData: boolean }) {
  if (data.pending) {
    return (
      <div className="flex items-center justify-center gap-1">
        <motion.div
          className="w-1.5 h-1.5 bg-amber-500 rounded-full"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="text-amber-500/60 text-[9px]">PEND</span>
      </div>
    );
  }

  if (data.change === null) {
    return <span className="text-neutral-600">—</span>;
  }

  const isPositive = data.change > 0;
  const isNegative = data.change < 0;
  const magnitude = Math.abs(data.change);
  
  // Dynamic glow intensity based on magnitude
  const glowIntensity = Math.min(magnitude * 0.3, 1);
  
  const getStyle = (): React.CSSProperties => {
    if (isPositive) {
      return {
        color: '#34d399',
        textShadow: `0 0 ${4 + glowIntensity * 8}px rgba(52, 211, 153, ${0.4 + glowIntensity * 0.4})`,
      };
    }
    if (isNegative) {
      return {
        color: '#ef4444',
        textShadow: `0 0 ${4 + glowIntensity * 8}px rgba(239, 68, 68, ${0.4 + glowIntensity * 0.4})`,
      };
    }
    return { color: '#737373' };
  };

  return (
    <span 
      className="font-bold tabular-nums text-[11px]"
      style={getStyle()}
    >
      {isPositive ? '▲' : isNegative ? '▼' : '●'}
      {isPositive ? '+' : ''}{data.change.toFixed(2)}%
    </span>
  );
}

interface TweetRowProps {
  tweet: TweetWithPrice;
  onRefresh?: (tweetId: string, timestamp: number) => void;
}

function TweetRow({ tweet, onRefresh }: TweetRowProps) {
  // Ensure timeframes exists with fallback
  const timeframes = tweet.timeframes || EMPTY_TIMEFRAMES;
  
  // Format timestamp as HH:MM
  const formattedTime = useMemo(() => {
    const date = new Date(tweet.createdAt);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }, [tweet.createdAt]);

  // Format date as MM/DD
  const formattedDate = useMemo(() => {
    const date = new Date(tweet.createdAt);
    return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
  }, [tweet.createdAt]);

  // Check if any timeframes are still pending
  const hasPendingData = useMemo(() => {
    return Object.values(timeframes).some(tf => tf?.pending);
  }, [timeframes]);

  // Calculate row highlight based on impact
  const rowStyle = useMemo((): React.CSSProperties => {
    const { impactScore, impactDirection } = tweet;
    
    if (impactDirection === "neutral" || impactScore < 0.1) {
      return {};
    }

    // Scale opacity based on impact score (0.1 to 2.0+ range)
    const opacity = Math.min(impactScore * 0.15, 0.3);
    
    if (impactDirection === "positive") {
      return {
        background: `linear-gradient(90deg, rgba(52, 211, 153, ${opacity}) 0%, rgba(52, 211, 153, ${opacity * 0.3}) 100%)`,
        boxShadow: impactScore > 1 ? `inset 0 0 20px rgba(52, 211, 153, ${opacity * 0.5})` : undefined,
      };
    }
    
    if (impactDirection === "negative") {
      return {
        background: `linear-gradient(90deg, rgba(239, 68, 68, ${opacity}) 0%, rgba(239, 68, 68, ${opacity * 0.3}) 100%)`,
        boxShadow: impactScore > 1 ? `inset 0 0 20px rgba(239, 68, 68, ${opacity * 0.5})` : undefined,
      };
    }
    
    return {};
  }, [tweet.impactScore, tweet.impactDirection]);

  // Truncate tweet text
  const truncatedText = useMemo(() => {
    const maxLength = 80;
    if (tweet.text.length <= maxLength) return tweet.text;
    return tweet.text.slice(0, maxLength) + '...';
  }, [tweet.text]);

  // Build tweet URL
  const tweetUrl = tweet.url || (tweet.id ? `https://x.com/DeItaone/status/${tweet.id}` : null);

  return (
    <motion.tr
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      transition={{ 
        layout: { type: "spring", stiffness: 300, damping: 30 },
        opacity: { duration: 0.2 }
      }}
      className="border-b border-neutral-800/50 hover:bg-white/[0.02] transition-all duration-200"
      style={rowStyle}
    >
      {/* Timestamp Cell */}
      <td className="py-2 px-2 border-r border-neutral-800/30">
        <div className="flex flex-col">
          <span className="text-amber-500 text-[10px] font-bold tabular-nums">{formattedTime}</span>
          <span className="text-neutral-600 text-[9px] tabular-nums">{formattedDate}</span>
        </div>
      </td>

      {/* Tweet Headline Cell */}
      <td className="py-2 px-2 border-r border-neutral-800/30 max-w-[280px]">
        {tweetUrl ? (
          <a 
            href={tweetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white text-[10px] leading-tight font-mono hover:text-amber-400 transition-colors cursor-pointer block"
            title={tweet.text}
          >
            {truncatedText}
          </a>
        ) : (
          <span 
            className="text-white text-[10px] leading-tight font-mono block"
            title={tweet.text}
          >
            {truncatedText}
          </span>
        )}
      </td>

      {/* Price at T Cell */}
      <td className="py-2 px-2 border-r border-neutral-800/30 text-center">
        {tweet.priceAtT !== null ? (
          <span className="text-neutral-400 text-[10px] tabular-nums font-mono">
            ${tweet.priceAtT.toFixed(0)}
          </span>
        ) : (
          <span className="text-neutral-600 text-[10px]">—</span>
        )}
      </td>

      {/* Timeframe Cells */}
      {TIMEFRAMES.map(({ key }) => (
        <td key={key} className="py-2 px-1.5 border-r border-neutral-800/30 text-center min-w-[65px]">
          <PriceChangeCell data={timeframes[key] || { price: null, change: null, pending: true }} hasPendingData={hasPendingData} />
        </td>
      ))}

      {/* Impact Score Cell */}
      <td className="py-2 px-2 text-center">
        {tweet.impactScore > 0 ? (
          <div className="flex items-center justify-center gap-1">
            <span 
              className={`text-[10px] font-bold tabular-nums ${
                tweet.impactDirection === "positive" ? "text-emerald-400" :
                tweet.impactDirection === "negative" ? "text-red-400" :
                "text-neutral-500"
              }`}
              style={{
                textShadow: tweet.impactScore > 0.5 
                  ? `0 0 8px ${tweet.impactDirection === "positive" ? "rgba(52, 211, 153, 0.5)" : "rgba(239, 68, 68, 0.5)"}`
                  : undefined
              }}
            >
              {tweet.impactScore.toFixed(1)}
            </span>
            {hasPendingData && (
              <motion.div
                className="w-1 h-1 bg-amber-500 rounded-full"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
        </div>
        ) : hasPendingData ? (
          <motion.div
            className="flex items-center justify-center gap-0.5"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <span className="text-amber-500/60 text-[9px]">CALC</span>
          </motion.div>
        ) : (
          <span className="text-neutral-600 text-[10px]">—</span>
        )}
      </td>
    </motion.tr>
  );
}

// Sort configuration type - supports timeframes, time, and score columns
type SortColumn = TimeframeKey | "time" | "score";
interface SortConfig {
  column: SortColumn;
  direction: "desc" | "asc";
}

// ========== Macro Alpha Table Component ==========

interface MacroEvent {
  id: string;
  name: string;
  currency: string;
  country: string;
  date: string;
  timestamp: number;
  previous: number | null;
  forecast: number | null;
  actual: number | null;
  impact: string;
  unit: string;
}

interface MacroEventWithTracking extends MacroEvent {
  baselinePrice: number | null;
  priceWindows: {
    "1m": { price: number | null; change: number | null; locked: boolean };
    "10m": { price: number | null; change: number | null; locked: boolean };
    "30m": { price: number | null; change: number | null; locked: boolean };
    "1h": { price: number | null; change: number | null; locked: boolean };
  };
  status: "upcoming" | "released" | "tracking" | "complete";
}

// Format countdown time with days, hours, minutes, seconds
function formatCountdown(ms: number): string {
  if (ms <= 0) return "0d 00:00:00";
  
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${days}d ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// Format time ago
function formatTimeAgo(ms: number): string {
  const absMs = Math.abs(ms);
  const minutes = Math.floor(absMs / 60000);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  return `${minutes}m ago`;
}

// Macro window config
const MACRO_WINDOWS = [
  { key: "1m" as const, ms: 60 * 1000, label: "1M" },
  { key: "10m" as const, ms: 10 * 60 * 1000, label: "10M" },
  { key: "30m" as const, ms: 30 * 60 * 1000, label: "30M" },
  { key: "1h" as const, ms: 60 * 60 * 1000, label: "1H" },
];

// Fetch historical price from Binance klines for a specific timestamp
async function fetchBinanceHistoricalPrice(
  symbol: string,
  timestamp: number
): Promise<number | null> {
  try {
    // Use 1m klines, fetch 1 candle starting at the timestamp
    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${timestamp}&limit=1`
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.length === 0) return null;
    // Return close price of the candle
    return parseFloat(data[0][4]);
  } catch {
    return null;
  }
}

// Backfill macro event prices using Binance historical data
async function backfillMacroEventPrices(
  event: MacroEvent,
  asset: Asset
): Promise<{ baselinePrice: number | null; priceWindows: MacroEventWithTracking["priceWindows"] }> {
  const config = ASSET_CONFIG[asset];
  const symbol = config.binanceSymbol.toUpperCase();
  const DELAY_MS = 200; // Throttle to avoid rate limits
  
  const emptyWindows: MacroEventWithTracking["priceWindows"] = {
    "1m": { price: null, change: null, locked: false },
    "10m": { price: null, change: null, locked: false },
    "30m": { price: null, change: null, locked: false },
    "1h": { price: null, change: null, locked: false },
  };
  
  // Fetch baseline price at event release time
  const baselinePrice = await fetchBinanceHistoricalPrice(symbol, event.timestamp);
  if (baselinePrice === null) {
    return { baselinePrice: null, priceWindows: emptyWindows };
  }
  
  await new Promise((r) => setTimeout(r, DELAY_MS));
  
  const priceWindows: MacroEventWithTracking["priceWindows"] = { ...emptyWindows };
  const now = Date.now();
  
  // Fetch price at each window
  for (const window of MACRO_WINDOWS) {
    const windowTime = event.timestamp + window.ms;
    
    // Only fetch if the window time has passed
    if (windowTime <= now) {
      const price = await fetchBinanceHistoricalPrice(symbol, windowTime);
      if (price !== null) {
        const change = ((price - baselinePrice) / baselinePrice) * 100;
        priceWindows[window.key] = {
          price,
          change,
          locked: true,
        };
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  
  return { baselinePrice, priceWindows };
}

function useMacroEvents(asset: Asset) {
  const [events, setEvents] = useState<MacroEventWithTracking[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const currentAssetRef = useRef(asset);
  const backfillInProgressRef = useRef(false);

  // Fetch current price from Binance
  const fetchCurrentPrice = useCallback(async () => {
    const config = ASSET_CONFIG[asset];
    const symbol = config.binanceSymbol.toUpperCase();
    try {
      const response = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
      );
      if (!response.ok) return null;
      const data = await response.json();
      return parseFloat(data.price);
    } catch {
      return null;
    }
  }, [asset]);

  // Initial fetch and backfill
  useEffect(() => {
    currentAssetRef.current = asset;
    backfillInProgressRef.current = false;
    
    async function fetchAndBackfill() {
      setLoading(true);
      
      try {
        // 1. Fetch macro events from API
        const response = await fetch("/api/macro-events");
        const data = await response.json();
        
        if (data.isDemo) setIsDemo(true);
        
        // 2. Fetch stored prices from Supabase for this asset
        const storedPrices = await getStoredMacroEventsForAsset(asset);
        const storedMap = new Map(storedPrices.map((s) => [s.id, storedMacroEventToAppFormat(s)]));
        
        const now = Date.now();
        
        // 3. Create events with tracking, using stored data where available
        const eventsWithTracking: MacroEventWithTracking[] = data.events.map(
          (event: MacroEvent) => {
            const isReleased = event.actual !== null || event.timestamp <= now;
            const stored = storedMap.get(event.id);
            
            if (stored && stored.baselinePrice !== null) {
              // Use cached data
              return {
                ...event,
                baselinePrice: stored.baselinePrice,
                priceWindows: stored.priceWindows,
                status: "complete" as const,
              };
            }
            
            return {
              ...event,
              baselinePrice: null,
              priceWindows: {
                "1m": { price: null, change: null, locked: false },
                "10m": { price: null, change: null, locked: false },
                "30m": { price: null, change: null, locked: false },
                "1h": { price: null, change: null, locked: false },
              },
              status: isReleased ? "released" : "upcoming",
            };
          }
        );
        
        setEvents(eventsWithTracking);
        setLoading(false);
        
        // 4. Backfill historical prices for events without cached data
        if (backfillInProgressRef.current) return;
        backfillInProgressRef.current = true;
        
        const eventsToBackfill = eventsWithTracking.filter(
          (e) => e.status === "released" && e.baselinePrice === null
        );
        
        for (const event of eventsToBackfill) {
          // Check if asset changed
          if (currentAssetRef.current !== asset) {
            backfillInProgressRef.current = false;
            return;
          }
          
          const { baselinePrice, priceWindows } = await backfillMacroEventPrices(event, asset);
          
          if (baselinePrice !== null) {
            // Update local state
            setEvents((prev) =>
              prev.map((e) =>
                e.id === event.id
                  ? { ...e, baselinePrice, priceWindows, status: "complete" as const }
                  : e
              )
            );
            
            // Save to Supabase
            await saveMacroEventPrices({
              id: event.id,
              asset,
              baselinePrice,
              priceWindows,
            });
          }
        }
        
        backfillInProgressRef.current = false;
      } catch (error) {
        console.error("Failed to fetch macro events:", error);
        setLoading(false);
      }
    }
    
    fetchAndBackfill();
  }, [asset]);

  // Update countdowns and track live prices every second
  useEffect(() => {
    const interval = setInterval(async () => {
      const now = Date.now();
      
      setEvents((prevEvents) => {
        const updated = prevEvents.map((event) => {
          // Skip if complete or upcoming
          if (event.status === "complete") return event;
          
          // Check if just released
          if (event.status === "upcoming" && event.timestamp <= now) {
            return { ...event, status: "released" as const };
          }
          
          return event;
        });
        
        return updated;
      });
      
      // Fetch current price for live tracking
      const currentPrice = await fetchCurrentPrice();
      if (currentPrice === null) return;
      
      setEvents((prevEvents) => {
        const now = Date.now();
        
        return prevEvents.map((event) => {
          // Skip if complete or upcoming
          if (event.status === "complete" || event.status === "upcoming") return event;
          
          // Set baseline price when event just released (live tracking)
          if (event.baselinePrice === null && event.status === "released") {
            return { ...event, baselinePrice: currentPrice, status: "tracking" as const };
          }
          
          // Update unlocked windows for live tracking
          if (event.status === "tracking" && event.baselinePrice !== null) {
            const timeSinceRelease = now - event.timestamp;
            const newWindows = { ...event.priceWindows };
            let changed = false;
            let allLocked = true;
            
            for (const window of MACRO_WINDOWS) {
              if (!newWindows[window.key].locked) {
                const change = ((currentPrice - event.baselinePrice) / event.baselinePrice) * 100;
                const shouldLock = timeSinceRelease >= window.ms;
                newWindows[window.key] = {
                  price: currentPrice,
                  change,
                  locked: shouldLock,
                };
                changed = true;
                if (!shouldLock) allLocked = false;
              }
            }
            
            if (changed) {
              const newStatus = allLocked ? "complete" as const : "tracking" as const;
              const updatedEvent = { ...event, priceWindows: newWindows, status: newStatus };
              
              // Save to Supabase when tracking completes
              if (newStatus === "complete") {
                saveMacroEventPrices({
                  id: event.id,
                  asset: currentAssetRef.current,
                  baselinePrice: event.baselinePrice,
                  priceWindows: newWindows,
                });
              }
              
              return updatedEvent;
            }
          }
          
          return event;
        });
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [fetchCurrentPrice]);

  return { events, loading, isDemo };
}

// Calculate impact score for macro event based on price changes
function calculateMacroImpact(event: MacroEventWithTracking): { score: number; direction: "positive" | "negative" | "neutral"; maxMove: number } {
  const windows = event.priceWindows;
  
  // Collect all valid changes with weights (favor earlier timeframes)
  const weights = { "1m": 4, "10m": 3, "30m": 2, "1h": 1 };
  let weightedSum = 0;
  let totalWeight = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let maxMove = 0;
  
  for (const key of ["1m", "10m", "30m", "1h"] as const) {
    const change = windows[key].change;
    if (change !== null && windows[key].locked) {
      const weight = weights[key];
      const absChange = Math.abs(change);
      weightedSum += absChange * weight;
      totalWeight += weight;
      maxMove = Math.max(maxMove, absChange);
      if (change > 0) positiveCount++;
      if (change < 0) negativeCount++;
    }
  }
  
  if (totalWeight === 0) return { score: 0, direction: "neutral", maxMove: 0 };
  
  // Average magnitude weighted by timeframe
  const avgMagnitude = weightedSum / totalWeight;
  
  // Direction is based on majority of timeframes
  const direction = positiveCount > negativeCount ? "positive" : negativeCount > positiveCount ? "negative" : "neutral";
  
  // Score: 0-1 scale based on magnitude (2% move = 0.5 score, 4%+ = 1.0)
  const score = Math.min(avgMagnitude / 4, 1);
  
  return { score, direction, maxMove };
}

// Macro Event Row Component
function MacroEventRow({ event, now }: { event: MacroEventWithTracking; now: number }) {
  const timeUntil = event.timestamp - now;
  const timeSinceRelease = now - event.timestamp;
  const isUpcoming = event.status === "upcoming";
  const isTracking = event.status === "tracking";
  const hasActual = event.actual !== null;
  
  // Historical event = released more than 1 hour ago without baseline capture
  const isHistorical = !isUpcoming && timeSinceRelease > 60 * 60 * 1000 && event.baselinePrice === null;
  
  // Calculate impact score for row shading
  const { score: impactScore, direction: impactDirection, maxMove } = useMemo(
    () => calculateMacroImpact(event),
    [event]
  );
  
  // Row background color based on impact (only show for moves > 1%)
  const getRowStyle = (): React.CSSProperties => {
    // Only shade if max move exceeds 1%
    if (isUpcoming || isHistorical || maxMove < 1) return {};
    
    // Opacity scales with impact score (0.08 to 0.30 for visible shading)
    // Starts at 1% move, maxes out around 3-4%
    const opacity = 0.08 + impactScore * 0.22;
    
    if (impactDirection === "positive") {
      return { backgroundColor: `rgba(34, 197, 94, ${opacity})` }; // green-500
    } else if (impactDirection === "negative") {
      return { backgroundColor: `rgba(239, 68, 68, ${opacity})` }; // red-500
    }
    return {};
  };
  
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`border-b border-neutral-800/30 ${
        isTracking ? "bg-amber-500/5" : ""
      } ${isHistorical ? "opacity-60" : ""}`}
      style={getRowStyle()}
    >
      {/* Event Name */}
      <td className="py-2.5 px-3 border-r border-neutral-800/30">
        <div className="flex flex-col">
          <span className="text-white text-[11px] font-medium leading-tight">
            {event.name}
          </span>
          <span className="text-neutral-500 text-[9px]">
            {event.currency} • {event.impact}
          </span>
    </div>
      </td>
      
      {/* Countdown / Actual */}
      <td className="py-2.5 px-3 border-r border-neutral-800/30 text-center min-w-[130px]">
        {(() => {
          // Format print value with 1 decimal place
          const formatPrint = (val: number | null) => {
            if (val === null) return "—";
            // For large numbers like NFP (thousands), show no decimals
            if (Math.abs(val) >= 100) return val.toFixed(0);
            // For percentages and small numbers, show 1 decimal
            return val.toFixed(1);
          };
          
          return isUpcoming ? (
            <div className="flex flex-col items-center">
              <span className="text-cyan-400 text-sm font-mono tabular-nums tracking-wider">
                {formatCountdown(timeUntil)}
              </span>
              <span className="text-neutral-600 text-[8px] uppercase">Until Release</span>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              {hasActual ? (
                <>
                  <span className="text-white text-sm font-bold tabular-nums">
                    {formatPrint(event.actual)}{event.unit}
                  </span>
                  <div className="flex gap-2 text-[9px] text-neutral-500">
                    <span>F: {formatPrint(event.forecast)}{event.unit}</span>
                    <span>P: {formatPrint(event.previous)}{event.unit}</span>
                  </div>
                  <span className="text-neutral-600 text-[8px] mt-0.5">
                    {new Date(event.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="text-amber-400 text-[10px] font-medium">RELEASED</span>
                  <span className="text-neutral-600 text-[8px]">
                    {new Date(event.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
      </td>
      
      {/* Price Windows */}
      {MACRO_WINDOWS.map(({ key }) => {
        const window = event.priceWindows[key];
        const hasValue = window.change !== null && event.baselinePrice !== null;
        const isPositive = (window.change ?? 0) > 0;
        const isLocked = window.locked;
        
        // Format prices compactly (e.g., "3,450" or "0.1234")
        const formatCompactPrice = (price: number | null) => {
          if (price === null) return "—";
          if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
          if (price >= 100) return price.toFixed(1);
          if (price >= 1) return price.toFixed(2);
          return price.toFixed(4);
        };
        
        return (
          <td key={key} className="py-2.5 px-2 border-r border-neutral-800/30 text-center min-w-[85px]">
            {isUpcoming || isHistorical ? (
              <span className="text-neutral-700 text-[10px]">—</span>
            ) : hasValue ? (
              <div className="flex flex-col items-center gap-0.5">
                <span
                  className={`text-[11px] font-bold tabular-nums ${
                    isPositive ? "text-emerald-400" : "text-red-400"
                  } ${!isLocked ? "animate-pulse" : ""}`}
                  style={{
                    textShadow: isLocked && Math.abs(window.change!) > 0.5
                      ? `0 0 8px ${isPositive ? "rgba(52, 211, 153, 0.5)" : "rgba(239, 68, 68, 0.5)"}`
                      : undefined,
                  }}
                >
                  {isPositive ? "+" : ""}{window.change!.toFixed(2)}%
                </span>
                {isLocked && window.price !== null && event.baselinePrice !== null && (
                  <span className="text-[8px] text-neutral-500 tabular-nums">
                    {formatCompactPrice(event.baselinePrice)} → {formatCompactPrice(window.price)}
                  </span>
                )}
              </div>
            ) : (
              <motion.div
                className="flex items-center justify-center gap-1"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                <span className="text-amber-500/60 text-[9px]">WAIT</span>
              </motion.div>
            )}
          </td>
        );
      })}
    </motion.tr>
  );
}

// Main Macro Alpha Table Component
interface MacroAlphaTableProps {
  selectedAsset?: Asset;
}

function MacroAlphaTable({ selectedAsset = "ETH" }: MacroAlphaTableProps) {
  const { events, loading, isDemo } = useMacroEvents(selectedAsset);
  const [now, setNow] = useState(Date.now());
  
  // Update "now" every second for countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  
  // Filter to show upcoming and recent events (past 40 days + next 40 days)
  const visibleEvents = useMemo(() => {
    const cutoff = Date.now() - 40 * 24 * 60 * 60 * 1000; // Past 40 days
    return events
      .filter((e) => e.timestamp > cutoff || e.status === "tracking")
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [events]);

  if (loading) {
    return (
      <div className="w-full bg-black border border-neutral-800 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between py-2 px-3 border-b border-neutral-700 bg-neutral-900/30">
          <span className="text-cyan-500 font-bold text-sm tracking-wider">MACRO ALPHA</span>
        </div>
        <div className="p-8 flex items-center justify-center">
          <div className="flex items-center gap-2 text-neutral-500">
            <motion.div
              className="w-2 h-2 bg-cyan-500 rounded-full"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <span className="text-sm">Loading economic calendar...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-black border border-neutral-800 rounded-lg overflow-hidden">
      {/* Title Bar */}
      <div className="flex items-center justify-between py-2 px-3 border-b border-neutral-700 bg-neutral-900/30">
        <div className="flex items-center gap-3">
          <span className="text-cyan-500 font-bold text-sm tracking-wider">MACRO ALPHA</span>
          <span className="text-white font-bold text-sm">ECON CALENDAR</span>
          {isDemo && (
            <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-[9px] font-bold rounded border border-yellow-500/30">
              DEMO
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500 text-xs uppercase">{selectedAsset}/USD</span>
          <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 text-[10px] font-bold rounded border border-cyan-500/30">
            LIVE TRACKING
          </span>
        </div>
      </div>
      
      {/* Table */}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-neutral-700 bg-neutral-900/50">
              <th className="py-2 px-3 text-neutral-400 text-[10px] font-bold uppercase tracking-wider border-r border-neutral-800/30">
                Event
              </th>
              <th className="py-2 px-3 text-neutral-400 text-[10px] font-bold uppercase tracking-wider border-r border-neutral-800/30 text-center">
                Time / Actual
              </th>
              {MACRO_WINDOWS.map(({ label }) => (
                <th
                  key={label}
                  className="py-2 px-2 text-neutral-400 text-[10px] font-bold uppercase tracking-wider border-r border-neutral-800/30 text-center"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {visibleEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-neutral-500 text-sm">
                    No upcoming macro events
                  </td>
                </tr>
              ) : (
                visibleEvents.map((event) => (
                  <MacroEventRow key={event.id} event={event} now={now} />
                ))
              )}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      
      {/* Footer */}
      <div className="border-t border-neutral-700 py-2 px-3 flex items-center justify-between bg-neutral-900/50">
        <span className="text-neutral-500 text-[10px] font-mono">
          {visibleEvents.length} Events
        </span>
        <div className="flex items-center gap-3 text-[9px]">
          <span className="flex items-center gap-1">
            <span className="text-cyan-400">⏱</span>
            <span className="text-neutral-600">COUNTDOWN</span>
          </span>
          <span className="flex items-center gap-1">
            <motion.div
              className="w-1.5 h-1.5 bg-amber-500 rounded-full"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span className="text-neutral-600">TRACKING</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-emerald-400">✓</span>
            <span className="text-neutral-600">LOCKED</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// News Sentiment Feed Component - Bloomberg Terminal Style with Multi-Timeframe Table
interface NewsSentimentFeedProps {
  selectedAsset?: Asset;
}

function NewsSentimentFeed({ selectedAsset = "ETH" }: NewsSentimentFeedProps) {
  const { tweets, loading, error, updateTweetPrice, isDemo, source } = useNewsFeed(selectedAsset);
  
  // Sort state - default to time, latest to oldest (desc)
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    column: "time",
    direction: "desc",
  });
  
  // High impact filter state - show only tweets with >= 1% move in 10m
  const [showOnlyHighImpact, setShowOnlyHighImpact] = useState(false);

  // Handle column header click to toggle sorting
  const handleSort = useCallback((column: SortColumn) => {
    setSortConfig(prev => {
      if (prev.column === column) {
        // Toggle direction if same column
        return { column, direction: prev.direction === "desc" ? "asc" : "desc" };
      }
      // New column, start with desc (highest/latest first)
      return { column, direction: "desc" };
    });
  }, []);
  
  // Filter tweets based on high impact filter
  // Shows tweets where ANY of 1m, 10m, or 1h timeframes hit >= 1% move
  const filteredTweets = useMemo(() => {
    if (!showOnlyHighImpact) return tweets;
    return tweets.filter(t => {
      const change1m = t.timeframes["1m"]?.change;
      const change10m = t.timeframes["10m"]?.change;
      const change1h = t.timeframes["1h"]?.change;
      
      const has1mImpact = change1m !== null && change1m !== undefined && Math.abs(change1m) >= 1;
      const has10mImpact = change10m !== null && change10m !== undefined && Math.abs(change10m) >= 1;
      const has1hImpact = change1h !== null && change1h !== undefined && Math.abs(change1h) >= 1;
      
      return has1mImpact || has10mImpact || has1hImpact;
    });
  }, [tweets, showOnlyHighImpact]);

  // Sort tweets based on current sort config (operates on filtered tweets)
  const sortedTweets = useMemo(() => {
    if (!sortConfig.column) return filteredTweets;
    
    return [...filteredTweets].sort((a, b) => {
      let comparison: number;
      
      // Handle different column types
      if (sortConfig.column === "time") {
        // Sort by timestamp
        const aTime = a.timestamp || 0;
        const bTime = b.timestamp || 0;
        comparison = sortConfig.direction === "desc" 
          ? bTime - aTime  // Latest first
          : aTime - bTime; // Oldest first
      } else if (sortConfig.column === "score") {
        // Sort by impact score
        const aScore = a.impactScore || 0;
        const bScore = b.impactScore || 0;
        comparison = sortConfig.direction === "desc"
          ? bScore - aScore  // Highest first
          : aScore - bScore; // Lowest first
      } else {
        // Sort by timeframe percentage change
        const aChange = a.timeframes[sortConfig.column]?.change;
        const bChange = b.timeframes[sortConfig.column]?.change;
        
        // Handle null/undefined values - push them to the end
        if (aChange === null || aChange === undefined) return 1;
        if (bChange === null || bChange === undefined) return -1;
        
        comparison = sortConfig.direction === "desc"
          ? bChange - aChange  // Highest first
          : aChange - bChange; // Lowest first
      }
      
      // Secondary sort: if same value, sort by impact score (higher first)
      if (comparison === 0 && sortConfig.column !== "score") {
        return (b.impactScore || 0) - (a.impactScore || 0);
      }
      
      return comparison;
    });
  }, [filteredTweets, sortConfig]);

  // Bloomberg-style title bar
  const TitleBar = () => (
    <div className="flex items-center justify-between py-2 px-3 border-b border-neutral-700 bg-neutral-900/30">
      <div className="flex items-center gap-3">
        <span className="text-amber-500 font-bold text-sm tracking-wider">NEWS ALPHA</span>
        <span className="text-white font-bold text-sm">@DELTAONE</span>
        {isDemo && (
          <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-[9px] font-bold rounded border border-yellow-500/30">
            DEMO
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* High Impact Filter Toggle */}
        <button
          onClick={() => setShowOnlyHighImpact(!showOnlyHighImpact)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all duration-300 ${
            showOnlyHighImpact
              ? "bg-amber-500/30 text-amber-400 border border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.4)]"
              : "bg-neutral-800/50 text-neutral-500 border border-neutral-700 hover:border-neutral-600 hover:text-neutral-400"
          }`}
        >
          <span className={showOnlyHighImpact ? "animate-pulse" : ""}>⚡</span>
          <span>1% Filter</span>
          {showOnlyHighImpact && (
            <span className="ml-1 text-[8px] opacity-75">ON</span>
          )}
        </button>
        <span className="text-neutral-700">|</span>
        <span className="text-neutral-500 text-xs uppercase">{selectedAsset}/USD</span>
        <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 text-[10px] font-bold rounded border border-cyan-500/30">
          MULTI-TF ANALYSIS
        </span>
      </div>
    </div>
  );

  // Loading skeleton
  if (loading) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4">
        <div className="bg-black border border-neutral-800">
          <TitleBar />
          <div className="p-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-2 py-3 border-b border-neutral-800/30">
                <div className="w-16 h-8 bg-neutral-800/50 rounded animate-pulse" />
                <div className="flex-1 h-6 bg-neutral-800/50 rounded animate-pulse" />
                {[...Array(7)].map((_, j) => (
                  <div key={j} className="w-14 h-6 bg-neutral-800/50 rounded animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        </div>
    </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4">
        <div className="bg-black border border-neutral-800">
          <TitleBar />
          <div className="py-8 px-3 text-center">
            <div className="text-red-500 text-sm font-bold mb-2">
              ■ ERROR: FEED UNAVAILABLE
            </div>
            <p className="text-neutral-500 text-xs font-mono">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (tweets.length === 0) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4">
        <div className="bg-black border border-neutral-800">
          <TitleBar />
          <div className="py-8 px-3 text-center">
            <p className="text-neutral-500 text-sm font-mono">NO DATA AVAILABLE</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4">
      <div className="bg-black border border-neutral-800">
        <TitleBar />
        
        {/* Data Table */}
        <div className="overflow-x-auto max-h-[55vh] overflow-y-auto scrollbar-thin">
          <LayoutGroup>
            <table className="w-full border-collapse font-mono text-xs">
              {/* Table Header */}
              <thead className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-700">
                <tr>
                  <th className="py-2 px-2 text-left text-[9px] uppercase tracking-wider border-r border-neutral-800/30 w-[60px]">
                    <button
                      onClick={() => handleSort("time")}
                      className={`flex items-center gap-0.5 transition-colors hover:text-neutral-300 cursor-pointer ${
                        sortConfig.column === "time" ? "text-neutral-300" : "text-neutral-500"
                      }`}
                    >
                      <span>TIME</span>
                      {sortConfig.column === "time" && (
                        <span className="text-[8px]">
                          {sortConfig.direction === "desc" ? "▼" : "▲"}
                        </span>
                      )}
                    </button>
                  </th>
                  <th className="py-2 px-2 text-left text-[9px] text-neutral-500 uppercase tracking-wider border-r border-neutral-800/30 min-w-[200px]">
                    HEADLINE
                  </th>
                  <th className="py-2 px-2 text-center text-[9px] text-neutral-500 uppercase tracking-wider border-r border-neutral-800/30 w-[60px]">
                    PRICE@T
                  </th>
                  {TIMEFRAMES.map(({ key, label }) => (
                    <th 
                      key={key} 
                      className="py-2 px-1.5 text-center text-[9px] uppercase tracking-wider border-r border-neutral-800/30 w-[65px]"
                    >
                      <button
                        onClick={() => handleSort(key)}
                        className={`flex items-center justify-center gap-0.5 w-full transition-colors hover:text-amber-400 cursor-pointer ${
                          sortConfig.column === key ? "text-amber-400" : "text-amber-500/80"
                        }`}
                      >
                        <span>Δ{label}</span>
                        {sortConfig.column === key && (
                          <span className="text-[8px]">
                            {sortConfig.direction === "desc" ? "▼" : "▲"}
                          </span>
                        )}
                      </button>
                    </th>
                  ))}
                  <th className="py-2 px-2 text-center text-[9px] uppercase tracking-wider w-[50px]">
                    <button
                      onClick={() => handleSort("score")}
                      className={`flex items-center justify-center gap-0.5 w-full transition-colors hover:text-cyan-400 cursor-pointer ${
                        sortConfig.column === "score" ? "text-cyan-400" : "text-cyan-500/80"
                      }`}
                    >
                      <span>SCORE</span>
                      {sortConfig.column === "score" && (
                        <span className="text-[8px]">
                          {sortConfig.direction === "desc" ? "▼" : "▲"}
                        </span>
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              
              {/* Table Body */}
              <tbody>
                <AnimatePresence mode="popLayout">
                  {sortedTweets.map((tweet) => (
                    <TweetRow key={tweet.id} tweet={tweet} onRefresh={updateTweetPrice} />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </LayoutGroup>
        </div>
        
        {/* Bloomberg-style footer */}
        <div className="border-t border-neutral-700 py-2 px-3 flex items-center justify-between bg-neutral-900/50">
          <div className="flex items-center gap-4">
            <span className="text-neutral-500 text-[10px] font-mono uppercase">
              {showOnlyHighImpact ? (
                <span>
                  <span className="text-amber-400">{sortedTweets.length}</span>
                  <span className="text-neutral-600">/{tweets.length}</span>
                  {" "}High Impact
                </span>
              ) : (
                <span>{tweets.length} Headlines</span>
              )}
            </span>
            <span className="text-neutral-700 text-[10px]">|</span>
            <span className="text-neutral-600 text-[10px] font-mono">
              {source || "BINANCE KLINES"}
            </span>
            <span className="text-neutral-700 text-[10px]">|</span>
            <span className="text-neutral-500 text-[9px] font-mono">
              1M • 10M • 30M • 1H
            </span>
          </div>
          <div className="flex items-center gap-4">
            {/* Legend */}
            <div className="flex items-center gap-3 text-[9px]">
              <span className="flex items-center gap-1">
                <span className="text-emerald-400">▲</span>
                <span className="text-neutral-600">UP</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-red-400">▼</span>
                <span className="text-neutral-600">DOWN</span>
              </span>
              <span className="flex items-center gap-1">
                <motion.div 
                  className="w-1.5 h-1.5 bg-amber-500 rounded-full"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                <span className="text-neutral-600">PENDING</span>
              </span>
            </div>
            <span className="text-neutral-700">|</span>
            <div className="flex items-center gap-2">
              {isDemo ? (
                <>
                  <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                  <span className="text-yellow-500/80 text-[10px] font-mono uppercase">
                    Demo
                  </span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-emerald-500/80 text-[10px] font-mono uppercase">
                    Live
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== Macro Historical Chart Component ==========

interface FREDDataPoint {
  date: string;
  value: number;
}

interface ChartDataPoint {
  date: string;
  month: string;
  cpi: number | null;
  fedFunds: number | null;
}

function useFREDData() {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const response = await fetch("/api/fred-data");
        const result = await response.json();
        
        setIsDemo(result.isDemo);
        
        // Merge CPI and Fed Funds data by date
        const dateMap = new Map<string, ChartDataPoint>();
        
        // Process CPI data
        result.cpi.forEach((point: FREDDataPoint) => {
          const date = new Date(point.date);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
          const monthLabel = date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          
          dateMap.set(monthKey, {
            date: monthKey,
            month: monthLabel,
            cpi: point.value,
            fedFunds: null,
          });
        });
        
        // Process Fed Funds data
        result.fedFunds.forEach((point: FREDDataPoint) => {
          const date = new Date(point.date);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
          const monthLabel = date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          
          const existing = dateMap.get(monthKey);
          if (existing) {
            existing.fedFunds = point.value;
          } else {
            dateMap.set(monthKey, {
              date: monthKey,
              month: monthLabel,
              cpi: null,
              fedFunds: point.value,
            });
          }
        });
        
        // Sort by date and convert to array
        const sortedData = Array.from(dateMap.values())
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-120); // Last 10 years
        
        setData(sortedData);
      } catch (error) {
        console.error("Failed to fetch FRED data:", error);
      }
      setLoading(false);
    }
    
    fetchData();
  }, []);

  return { data, loading, isDemo };
}

// Custom Tooltip Component
function CustomChartTooltip({ 
  active, 
  payload, 
  label,
  showCPI,
  showFedFunds,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
  showCPI: boolean;
  showFedFunds: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const cpiValue = payload.find((p) => p.dataKey === "cpi")?.value;
  const fedFundsValue = payload.find((p) => p.dataKey === "fedFunds")?.value;

  return (
    <div className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2 shadow-xl">
      <div className="text-neutral-400 text-[10px] font-mono mb-1">{label}</div>
      {showCPI && cpiValue !== undefined && (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#FFB900" }} />
          <span className="text-[#FFB900] text-xs font-mono font-bold">
            CPI: {cpiValue.toFixed(2)}%
          </span>
        </div>
      )}
      {showFedFunds && fedFundsValue !== undefined && (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#00FFFF" }} />
          <span className="text-[#00FFFF] text-xs font-mono font-bold">
            Fed Funds: {fedFundsValue.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
}

function MacroHistoricalChart() {
  const { data, loading, isDemo } = useFREDData();
  const [showCPI, setShowCPI] = useState(true);
  const [showFedFunds, setShowFedFunds] = useState(true);

  if (loading) {
    return (
      <div className="w-full bg-black border border-neutral-800 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between py-2 px-3 border-b border-neutral-700 bg-neutral-900/30">
          <span className="text-cyan-500 font-bold text-sm tracking-wider">MACRO TRENDS</span>
        </div>
        <div className="h-[400px] flex items-center justify-center">
          <div className="flex items-center gap-2 text-neutral-500">
            <motion.div
              className="w-2 h-2 bg-cyan-500 rounded-full"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
            <span className="text-sm font-mono">Loading FRED data...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-black border border-neutral-800 rounded-lg overflow-hidden">
      {/* Title Bar */}
      <div className="flex items-center justify-between py-2 px-3 border-b border-neutral-700 bg-neutral-900/30">
        <div className="flex items-center gap-3">
          <span className="text-cyan-500 font-bold text-sm tracking-wider">MACRO TRENDS</span>
          <span className="text-white font-bold text-sm">HISTORICAL</span>
          {isDemo && (
            <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-[9px] font-bold rounded border border-yellow-500/30">
              DEMO
            </span>
          )}
        </div>
        
        {/* Legend / Toggle Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCPI(!showCPI)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
              showCPI 
                ? "bg-[#FFB900]/20 text-[#FFB900] border border-[#FFB900]/30" 
                : "bg-neutral-800/50 text-neutral-500 border border-neutral-700"
            }`}
          >
            <div 
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: showCPI ? "#FFB900" : "#666" }}
            />
            CPI YoY
          </button>
          <button
            onClick={() => setShowFedFunds(!showFedFunds)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${
              showFedFunds 
                ? "bg-[#00FFFF]/20 text-[#00FFFF] border border-[#00FFFF]/30" 
                : "bg-neutral-800/50 text-neutral-500 border border-neutral-700"
            }`}
          >
            <div 
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: showFedFunds ? "#00FFFF" : "#666" }}
            />
            Fed Funds
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[400px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 10, right: showFedFunds && showCPI ? 60 : 20, left: 20, bottom: 10 }}
          >
            <CartesianGrid 
              strokeDasharray="0" 
              stroke="#262626" 
              vertical={false}
            />
            
            {/* Left Y-Axis - CPI */}
            <YAxis
              yAxisId="left"
              orientation="left"
              tick={{ fill: "#CCCCCC", fontSize: 10, fontFamily: "monospace" }}
              tickLine={{ stroke: "#444" }}
              axisLine={{ stroke: "#444" }}
              tickFormatter={(value) => `${value}%`}
              domain={["auto", "auto"]}
              hide={!showCPI}
            />
            
            {/* Right Y-Axis - Fed Funds */}
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "#CCCCCC", fontSize: 10, fontFamily: "monospace" }}
              tickLine={{ stroke: "#444" }}
              axisLine={{ stroke: "#444" }}
              tickFormatter={(value) => `${value}%`}
              domain={["auto", "auto"]}
              hide={!showFedFunds || !showCPI}
            />
            
            <XAxis
              dataKey="month"
              tick={{ fill: "#CCCCCC", fontSize: 10, fontFamily: "monospace" }}
              tickLine={{ stroke: "#444" }}
              axisLine={{ stroke: "#444" }}
              interval={11}
              angle={0}
            />
            
            <Tooltip
              content={<CustomChartTooltip showCPI={showCPI} showFedFunds={showFedFunds} />}
              cursor={{ stroke: "#FFFFFF", strokeWidth: 1, strokeDasharray: "none" }}
            />
            
            {/* 2% Fed Target Reference Line */}
            {showCPI && (
              <ReferenceLine
                y={2}
                yAxisId="left"
                stroke="#FFB900"
                strokeDasharray="4 4"
                strokeOpacity={0.3}
              />
            )}
            
            {/* CPI Line */}
            {showCPI && (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="cpi"
                stroke="#FFB900"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#FFB900", stroke: "#000", strokeWidth: 2 }}
                connectNulls
              />
            )}
            
            {/* Fed Funds Line */}
            {showFedFunds && (
              <Line
                yAxisId={showCPI ? "right" : "left"}
                type="stepAfter"
                dataKey="fedFunds"
                stroke="#00FFFF"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#00FFFF", stroke: "#000", strokeWidth: 2 }}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Footer */}
      <div className="border-t border-neutral-700 py-2 px-3 flex items-center justify-between bg-neutral-900/50">
        <span className="text-neutral-500 text-[10px] font-mono">
          {data.length} Months
        </span>
        <div className="flex items-center gap-3 text-[9px]">
          <span className="text-neutral-600">
            Source: {isDemo ? "Demo Data" : "FRED (St. Louis Fed)"}
          </span>
          <span className="text-neutral-700">|</span>
          <span className="text-[#FFB900]/50">— CPI 2% Target</span>
        </div>
      </div>
    </div>
  );
}

// ========== Main Component ==========

export default function Home() {
  const [source, setSource] = useState<PriceSource>("binance");
  const [asset, setAsset] = useState<Asset>("ETH");
  const [priceDirection, setPriceDirection] = useState<Direction | null>(null);
  const [moveSize, setMoveSize] = useState<MoveSize>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const faviconTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const faviconLinkRef = useRef<HTMLLinkElement | null>(null);
  const motionBlurTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Audio throttle state for Binance
  const lastAudioTimeRef = useRef<number>(0);
  const pendingAudioRef = useRef<{ direction: Direction; bps: number } | null>(null);
  const audioThrottleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate move size from bps
  const getMoveSize = useCallback((bps: number): MoveSize => {
    if (bps < 1) return "small";
    if (bps <= 5) return "medium";
    return "whale";
  }, []);

  // Get flash duration based on move size
  const getFlashDuration = useCallback((size: MoveSize): number => {
    switch (size) {
      case "small": return 150;
      case "medium": return 500;
      case "whale": return 1500;
      default: return 300;
    }
  }, []);

  // Get motion blur duration based on move size
  const getMotionBlurDuration = useCallback((size: MoveSize): number => {
    switch (size) {
      case "whale": return 200;
      default: return 0;
    }
  }, []);

  // Core sound playing function
  const playSoundCore = useCallback((direction: Direction, bps: number) => {
    if (!audioContextRef.current) return;
    
    const ctx = audioContextRef.current;
    
    if (ctx.state === "suspended") {
      ctx.resume();
      return;
    }
    
    const now = ctx.currentTime;
    const frequency = direction === "up" ? 800 : 400;

    let duration: number;
    let volume: number;
    let waveType: OscillatorType;
    let useAlarmEffect = false;

    if (bps < 1) {
      duration = 0.08;
      volume = 0.15;
      waveType = "sine";
    } else if (bps <= 5) {
      duration = 0.15;
      volume = 0.25;
      waveType = "sine";
    } else {
      duration = 0.5;
      volume = 0.4;
      waveType = "triangle";
      useAlarmEffect = true;
    }

    try {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = waveType;
      oscillator.frequency.setValueAtTime(frequency, now);

      if (useAlarmEffect) {
        const highFreq = frequency * 1.25;
        const lowFreq = frequency;
        const oscillations = 3;
        const stepDuration = duration / (oscillations * 2);
        
        for (let i = 0; i < oscillations; i++) {
          const t = now + i * stepDuration * 2;
          oscillator.frequency.setValueAtTime(lowFreq, t);
          oscillator.frequency.linearRampToValueAtTime(highFreq, t + stepDuration);
          oscillator.frequency.linearRampToValueAtTime(lowFreq, t + stepDuration * 2);
        }
      }

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume, now + 0.005);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

      oscillator.start(now);
      oscillator.stop(now + duration + 0.01);
    } catch (e) {
      console.error("Audio error:", e);
    }
  }, []);

  // Throttled audio player - used for Binance mode
  const playPriceSoundThrottled = useCallback((direction: Direction, bps: number) => {
    const now = Date.now();
    const timeSinceLastAudio = now - lastAudioTimeRef.current;
    
    // If we can play immediately
    if (timeSinceLastAudio >= AUDIO_THROTTLE_MS) {
      playSoundCore(direction, bps);
      lastAudioTimeRef.current = now;
      pendingAudioRef.current = null;
      
      if (audioThrottleTimeoutRef.current) {
        clearTimeout(audioThrottleTimeoutRef.current);
        audioThrottleTimeoutRef.current = null;
      }
    } else {
      // Queue/update pending audio - keep the larger move
      if (!pendingAudioRef.current || bps > pendingAudioRef.current.bps) {
        pendingAudioRef.current = { direction, bps };
      }
      
      // Schedule to play the pending audio
      if (!audioThrottleTimeoutRef.current) {
        const delay = AUDIO_THROTTLE_MS - timeSinceLastAudio;
        audioThrottleTimeoutRef.current = setTimeout(() => {
          if (pendingAudioRef.current) {
            playSoundCore(pendingAudioRef.current.direction, pendingAudioRef.current.bps);
            lastAudioTimeRef.current = Date.now();
            pendingAudioRef.current = null;
          }
          audioThrottleTimeoutRef.current = null;
        }, delay);
      }
    }
  }, [playSoundCore]);

  // Play price sound - chooses between throttled and direct based on source
  const playPriceSound = useCallback((direction: Direction, bps: number, currentSource: PriceSource) => {
    if (currentSource === "binance") {
      playPriceSoundThrottled(direction, bps);
    } else {
      playSoundCore(direction, bps);
    }
  }, [playSoundCore, playPriceSoundThrottled]);

  // Flash favicon
  const flashFavicon = useCallback((direction: Direction, duration: number) => {
    if (!faviconLinkRef.current) return;

    if (faviconTimeoutRef.current) {
      clearTimeout(faviconTimeoutRef.current);
    }

    faviconLinkRef.current.href = direction === "up" ? FAVICON_UP : FAVICON_DOWN;

    faviconTimeoutRef.current = setTimeout(() => {
      if (faviconLinkRef.current) {
        faviconLinkRef.current.href = getFaviconDefault(asset);
      }
    }, duration);
  }, [asset]);

  // Track max bps in current flash window for intensity
  const maxBpsInWindowRef = useRef<number>(0);
  const intensityResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle price change from usePrice hook
  const handlePriceChange = useCallback((newPrice: number, prevPrice: number) => {
    const priceDiff = newPrice - prevPrice;
    if (priceDiff === 0) return;

    const bps = Math.abs(priceDiff / prevPrice) * 10000;
    const direction: Direction = priceDiff > 0 ? "up" : "down";
    
    // Track max bps for intensity - ensures big moves show even with rapid updates
    maxBpsInWindowRef.current = Math.max(maxBpsInWindowRef.current, bps);
    const effectiveBps = maxBpsInWindowRef.current;
    
    const size = getMoveSize(effectiveBps);
    const duration = getFlashDuration(size);
    const motionBlurDuration = getMotionBlurDuration(size);
    
    // Clear previous flash timeout
    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
    }
    if (motionBlurTimeoutRef.current) {
      clearTimeout(motionBlurTimeoutRef.current);
    }
    
    // Clear intensity reset timeout and set a new one
    if (intensityResetTimeoutRef.current) {
      clearTimeout(intensityResetTimeoutRef.current);
    }
    intensityResetTimeoutRef.current = setTimeout(() => {
      maxBpsInWindowRef.current = 0;
    }, duration);
    
    setPriceDirection(direction);
    setMoveSize(size);
    flashFavicon(direction, duration);
    playPriceSound(direction, bps, source);
    
    if (size === "whale") {
      setIsSliding(true);
      motionBlurTimeoutRef.current = setTimeout(() => {
        setIsSliding(false);
      }, motionBlurDuration);
    }
    
    flashTimeoutRef.current = setTimeout(() => {
      setPriceDirection(null);
      setMoveSize(null);
    }, duration);
  }, [getMoveSize, getFlashDuration, getMotionBlurDuration, flashFavicon, playPriceSound, source, asset]);

  // Use the main price feed hook
  const { price: primaryPrice, formattedPrice, status } = usePriceFeed(asset, source, handlePriceChange);

  // Reset audio throttle state when source or asset changes
  useEffect(() => {
    lastAudioTimeRef.current = 0;
    pendingAudioRef.current = null;
    maxBpsInWindowRef.current = 0;
    if (audioThrottleTimeoutRef.current) {
      clearTimeout(audioThrottleTimeoutRef.current);
      audioThrottleTimeoutRef.current = null;
    }
    if (intensityResetTimeoutRef.current) {
      clearTimeout(intensityResetTimeoutRef.current);
      intensityResetTimeoutRef.current = null;
    }
    // Reset price direction and move size
    setPriceDirection(null);
    setMoveSize(null);
  }, [source, asset]);

  // Initialize AudioContext and unlock on first user interaction
  useEffect(() => {
    const unlockAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      if (audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().then(() => {
          setAudioUnlocked(true);
        });
      } else {
        setAudioUnlocked(true);
      }
      document.removeEventListener("click", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
      document.removeEventListener("touchstart", unlockAudio);
    };

    document.addEventListener("click", unlockAudio);
    document.addEventListener("keydown", unlockAudio);
    document.addEventListener("touchstart", unlockAudio);

    return () => {
      document.removeEventListener("click", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
      document.removeEventListener("touchstart", unlockAudio);
    };
  }, []);

  // Initialize and update favicon link element
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = getFaviconDefault(asset);
    faviconLinkRef.current = link;

    return () => {
      if (faviconLinkRef.current) {
        faviconLinkRef.current.href = getFaviconDefault(asset);
      }
    };
  }, [asset]);

  // Update document title
  useEffect(() => {
    if (status === "connected" && formattedPrice) {
      document.title = `$${formattedPrice} - ${asset}`;
    } else {
      document.title = `${asset} Ticker`;
    }
  }, [status, formattedPrice, asset]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      if (faviconTimeoutRef.current) clearTimeout(faviconTimeoutRef.current);
      if (motionBlurTimeoutRef.current) clearTimeout(motionBlurTimeoutRef.current);
      if (audioThrottleTimeoutRef.current) clearTimeout(audioThrottleTimeoutRef.current);
      if (intensityResetTimeoutRef.current) clearTimeout(intensityResetTimeoutRef.current);
    };
  }, []);

  // Get text color class based on direction and move size
  const getPriceColorClass = () => {
    if (!priceDirection) return "text-white";
    
    const isUp = priceDirection === "up";
    
    switch (moveSize) {
      case "small":
        return isUp ? "text-emerald-400/70" : "text-red-400/70";
      case "medium":
        return isUp ? "text-emerald-400" : "text-red-400";
      case "whale":
        return isUp ? "text-emerald-300" : "text-red-300";
      default:
        return "text-white";
    }
  };

  return (
    <main className="min-h-screen bg-black overflow-x-hidden">
      {/* Motion blur and gap alert styles */}
      <style jsx global>{`
        .motion-blur-active {
          animation: motion-blur-fade 200ms ease-out forwards;
        }
        
        @keyframes motion-blur-fade {
          0% {
            filter: blur(3px);
          }
          100% {
            filter: blur(0px);
          }
        }

        @keyframes pulse-yellow {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        .animate-pulse-yellow {
          animation: pulse-yellow 1s ease-in-out infinite;
        }

        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }

        .scrollbar-thin::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 2px;
        }

        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
        }

        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>

      {/* Top Bar - Fixed */}
      <div className="fixed top-6 left-0 right-0 px-6 flex items-center justify-between z-20">
        {/* Asset Selector + Source Selector */}
        <div className="flex items-center gap-3">
          <AssetSelector asset={asset} onAssetChange={setAsset} />
          <SourceSelector source={source} onSourceChange={setSource} />
        </div>

        {/* Audio unlock hint */}
        {!audioUnlocked && (
          <span className="text-white/30 text-xs tracking-widest uppercase animate-pulse absolute left-1/2 -translate-x-1/2">
            Click anywhere for audio
          </span>
        )}

        {/* WebSocket Status */}
        <div className="flex items-center gap-2">
          <span className="text-white/30 text-xs tracking-widest uppercase">WS</span>
          <span 
            className={`h-2.5 w-2.5 rounded-full ${
              status === "connected" 
                ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" 
                : status === "connecting" 
                ? "bg-yellow-500 animate-pulse-slow" 
                : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
            }`}
          />
        </div>
      </div>

      {/* Subtle grid background */}
      <div 
        className="pointer-events-none fixed inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />
      
      {/* Main Content - Scrollable */}
      <div className="relative z-10 pt-24 pb-32">
        {/* Price Ticker Section */}
        <div className="flex flex-col items-center gap-8 mb-16">
          {/* Asset Label with Source Badge */}
          <div className="flex items-center gap-3">
            <span className="text-white/40 text-sm tracking-[0.3em] uppercase">
              {asset} / USD
            </span>
            <SourceBadge source={source} />
          </div>

          {/* Price Display with Digit Roller */}
          <div className={`flex items-center gap-2 text-7xl md:text-9xl ${isSliding ? 'motion-blur-container' : ''}`}>
            {/* Static $ sign */}
            <span 
              className="text-white/30 text-4xl md:text-6xl font-medium tabular-nums"
              style={{ lineHeight: `${DIGIT_HEIGHT}em` }}
            >
              $
            </span>
            
            {/* Digit Roller */}
            {formattedPrice ? (
              <DigitRoller
                value={formattedPrice}
                colorClass={getPriceColorClass()}
                moveSize={moveSize}
                priceDirection={priceDirection}
              />
            ) : (
              <span 
                className="text-white/20 animate-pulse-slow font-bold tracking-tight tabular-nums"
                style={{ lineHeight: `${DIGIT_HEIGHT}em` }}
              >
                0,000.00
              </span>
            )}
          </div>

          {/* Status + Price Gap */}
          <div className="text-white/20 text-xs tracking-widest uppercase">
            {status === "connected" && "Live"}
            {status === "connecting" && "Connecting..."}
            {status === "disconnected" && "Reconnecting..."}
          </div>
        </div>

        {/* Alpha Tables Section - Side by Side on Large Screens */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 px-4 max-w-[1800px] mx-auto">
          {/* Macro Alpha Table */}
          <MacroAlphaTable selectedAsset={asset} />
          
          {/* News Sentiment Feed */}
          <NewsSentimentFeed selectedAsset={asset} />
        </div>
        
        {/* Macro Historical Trends Chart */}
        <div className="mt-6 px-4 max-w-[1800px] mx-auto">
          <MacroHistoricalChart />
        </div>
      </div>

      {/* Bottom attribution - Fixed */}
      <div className="fixed bottom-6 left-0 right-0 text-center text-white/10 text-xs tracking-widest uppercase">
        {source === "hyperliquid" ? "Hyperliquid" : "Binance"}
      </div>
    </main>
  );
}
