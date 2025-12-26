"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion, LayoutGroup, AnimatePresence } from "framer-motion";

type ConnectionStatus = "connecting" | "connected" | "disconnected";
type Direction = "up" | "down";
type MoveSize = "small" | "medium" | "whale" | null;
type PriceSource = "hyperliquid" | "binance";

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

// Price gap threshold for alert (0.10%)
const GAP_ALERT_THRESHOLD = 0.10;

// Favicon SVGs as data URIs
const FAVICON_DEFAULT = "data:image/svg+xml," + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" fill="#000"/>
    <text x="16" y="22" font-family="system-ui" font-size="18" font-weight="bold" fill="#fff" text-anchor="middle">Ξ</text>
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

// ========== usePrice Hook ==========
interface UsePriceResult {
  price: number | null;
  formattedPrice: string | null;
  status: ConnectionStatus;
}

function usePrice(
  source: PriceSource,
  onPriceChange?: (price: number, prevPrice: number) => void
): UsePriceResult {
  const [price, setPrice] = useState<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Reset state when source changes
    setPrice(null);
    setStatus("connecting");
    prevPriceRef.current = null;

    // Clean up previous connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const connect = () => {
      setStatus("connecting");

      let ws: WebSocket;

      if (source === "hyperliquid") {
        ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
        
        ws.onopen = () => {
          setStatus("connected");
          ws.send(
            JSON.stringify({
              method: "subscribe",
              subscription: { type: "allMids" },
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.channel === "allMids" && data.data?.mids) {
              const ethMid = data.data.mids["ETH"];
              if (ethMid) {
                const newPrice = parseFloat(ethMid);
                if (prevPriceRef.current !== null && onPriceChange) {
                  onPriceChange(newPrice, prevPriceRef.current);
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
        // Binance
        ws = new WebSocket("wss://stream.binance.com:9443/ws/ethusdt@aggTrade");
        
        ws.onopen = () => {
          setStatus("connected");
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // Binance aggTrade format: { p: "price", ... }
            if (data.p) {
              const newPrice = parseFloat(data.p);
              if (prevPriceRef.current !== null && onPriceChange) {
                onPriceChange(newPrice, prevPriceRef.current);
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
        setStatus("disconnected");
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
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
  }, [source, onPriceChange]);

  const formattedPrice = useMemo(() => {
    if (price === null) return null;
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [price]);

  return { price, formattedPrice, status };
}

// ========== useShadowPrice Hook - Silent background feed ==========
function useShadowPrice(source: PriceSource): number | null {
  const [price, setPrice] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setPrice(null);

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const connect = () => {
      let ws: WebSocket;

      if (source === "hyperliquid") {
        ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
        
        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              method: "subscribe",
              subscription: { type: "allMids" },
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.channel === "allMids" && data.data?.mids) {
              const ethMid = data.data.mids["ETH"];
              if (ethMid) {
                setPrice(parseFloat(ethMid));
              }
            }
          } catch (e) {
            // Silent fail for shadow feed
          }
        };
      } else {
        ws = new WebSocket("wss://stream.binance.com:9443/ws/ethusdt@aggTrade");
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.p) {
              setPrice(parseFloat(data.p));
            }
          } catch (e) {
            // Silent fail for shadow feed
          }
        };
      }

      ws.onclose = () => {
        reconnectTimeoutRef.current = setTimeout(connect, 5000);
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
  }, [source]);

  return price;
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
async function fetchBinancePrice(timestamp: number, interval: string = "1m"): Promise<number | null> {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=${interval}&startTime=${timestamp}&limit=1`;
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
async function fetchMultiTimeframePricesClient(timestamp: number): Promise<{
  priceAtT: number | null;
  timeframes: Record<TimeframeKey, TimeframeData>;
  impactScore: number;
  impactDirection: "positive" | "negative" | "neutral";
}> {
  const now = Date.now();
  
  // Fetch base price
  const priceAtT = await fetchBinancePrice(timestamp);
  
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
  
  for (const config of TIMEFRAME_CONFIGS) {
    const targetTime = timestamp + config.ms;
    
    if (targetTime > now) {
      timeframes[config.key] = { price: null, change: null, pending: true };
      continue;
    }
    
    await delay(100); // Small delay to avoid rate limits
    const price = await fetchBinancePrice(targetTime, config.interval);
    
    let change: number | null = null;
    if (price !== null && priceAtT !== 0) {
      change = ((price - priceAtT) / priceAtT) * 100;
    }
    
    timeframes[config.key] = { price, change, pending: false };
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

  return { priceAtT, timeframes, impactScore, impactDirection };
}

function useNewsFeed() {
  const [tweets, setTweets] = useState<TweetWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [source, setSource] = useState<string>("");

  // Function to update a single tweet's price data (for refreshing pending timeframes)
  const updateTweetPrice = useCallback(async (tweetId: string, timestamp: number) => {
    const priceData = await fetchMultiTimeframePricesClient(timestamp);
    setTweets(prevTweets => 
      prevTweets.map(tweet => 
        tweet.id === tweetId 
          ? { ...tweet, ...priceData }
          : tweet
      )
    );
  }, []);

  useEffect(() => {
    async function fetchTweetsWithPrices() {
      try {
        setLoading(true);
        setError(null);

        console.log("Fetching tweets from API...");
        
        // Fetch tweets
        const tweetsRes = await fetch("/api/tweets");
        if (!tweetsRes.ok) {
          throw new Error(`Failed to fetch tweets: ${tweetsRes.status}`);
        }
        const tweetsData = await tweetsRes.json();

        console.log("Tweets API response:", tweetsData);

        if (tweetsData.error && (!tweetsData.tweets || tweetsData.tweets.length === 0)) {
          throw new Error(tweetsData.error);
        }

        const rawTweets = tweetsData.tweets || [];
        console.log(`Received ${rawTweets.length} tweets`);
        
        // Track if we're using demo data
        if (tweetsData.isDemo) {
          setIsDemo(true);
        }
        if (tweetsData.source) {
          setSource(tweetsData.source);
        }
        
        if (rawTweets.length === 0) {
          setTweets([]);
          setLoading(false);
          return;
        }

        const now = Date.now();

        // Initialize tweets without price data first (show UI immediately)
        const initialTweets: TweetWithPrice[] = rawTweets.map(
          (tweet: { id: string; text: string; createdAt: string; timestamp: number; url?: string }) => ({
            ...tweet,
            priceAtT: null,
            timeframes: { ...EMPTY_TIMEFRAMES },
            impactScore: 0,
            impactDirection: "neutral" as const,
          })
        );
        setTweets(initialTweets);
        setLoading(false);

        // Fetch price data client-side (Binance blocks server-side requests)
        console.log("Fetching prices client-side from Binance...");
        
        for (let i = 0; i < rawTweets.length; i++) {
          const tweet = rawTweets[i];
          
          // Skip if timestamp is invalid (0 or in the future)
          if (!tweet.timestamp || tweet.timestamp <= 0 || tweet.timestamp > now) {
            console.log(`Skipping tweet ${tweet.id}: invalid timestamp ${tweet.timestamp}`);
            continue;
          }
          
          try {
            console.log(`Fetching prices for tweet ${i + 1}/${rawTweets.length}: ${new Date(tweet.timestamp).toISOString()}`);
            
            // Fetch prices directly from Binance (client-side)
            const priceData = await fetchMultiTimeframePricesClient(tweet.timestamp);

            console.log(`Price data for tweet ${tweet.id}:`, priceData);

            // Update this specific tweet with price data
            setTweets(prevTweets =>
              prevTweets.map(t =>
                t.id === tweet.id
                  ? {
                      ...t,
                      ...priceData,
                    }
                  : t
              )
            );

            // Throttle: wait before next request
            if (i < rawTweets.length - 1) {
              await delay(PRICE_FETCH_DELAY_MS);
            }
          } catch (err) {
            console.error(`Failed to fetch price for tweet ${tweet.id}:`, err);
          }
        }
        
        console.log("Finished fetching all prices");
      } catch (err) {
        console.error("Error in fetchTweetsWithPrices:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    }

    fetchTweetsWithPrices();
  }, []);

  return { tweets, loading, error, updateTweetPrice, isDemo, source };
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

// Source Badge Component - shows next to price
interface SourceBadgeProps {
  source: PriceSource;
}

function SourceBadge({ source }: SourceBadgeProps) {
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

// Price Gap Display Component
interface PriceGapProps {
  primaryPrice: number | null;
  shadowPrice: number | null;
  primarySource: PriceSource;
}

function PriceGap({ primaryPrice, shadowPrice, primarySource }: PriceGapProps) {
  const gap = useMemo(() => {
    if (primaryPrice === null || shadowPrice === null) return null;
    // Calculate percentage difference: (primary - shadow) / shadow * 100
    const diff = ((primaryPrice - shadowPrice) / shadowPrice) * 100;
    return diff;
  }, [primaryPrice, shadowPrice]);

  if (gap === null) {
    return (
      <div className="flex items-center gap-2 text-white/20 text-xs tracking-widest">
        <span className="uppercase">Gap</span>
        <span className="tabular-nums">--</span>
      </div>
    );
  }

  const absGap = Math.abs(gap);
  const isAlert = absGap >= GAP_ALERT_THRESHOLD;
  const isPositive = gap > 0;
  const shadowSource = primarySource === "hyperliquid" ? "BN" : "HL";

  return (
    <div className={`flex items-center gap-3 text-xs tracking-widest ${isAlert ? "animate-pulse-yellow" : ""}`}>
      <span className="text-white/30 uppercase">
        {primarySource === "hyperliquid" ? "HL" : "BN"} vs {shadowSource}
      </span>
      <span 
        className={`tabular-nums font-medium ${
          isAlert 
            ? "text-yellow-400" 
            : isPositive 
              ? "text-emerald-400/60" 
              : "text-red-400/60"
        }`}
      >
        {isPositive ? "+" : ""}{gap.toFixed(3)}%
      </span>
      {isAlert && (
        <span className="text-yellow-400/80 text-[10px] uppercase tracking-wider">
          Wide Spread
        </span>
      )}
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

// News Sentiment Feed Component - Bloomberg Terminal Style with Multi-Timeframe Table
function NewsSentimentFeed() {
  const { tweets, loading, error, updateTweetPrice, isDemo, source } = useNewsFeed();
  
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
        <span className="text-neutral-500 text-xs uppercase">ETH/USD</span>
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

// ========== Main Component ==========

export default function Home() {
  const [source, setSource] = useState<PriceSource>("binance");
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
        faviconLinkRef.current.href = FAVICON_DEFAULT;
      }
    }, duration);
  }, []);

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
  }, [getMoveSize, getFlashDuration, getMotionBlurDuration, flashFavicon, playPriceSound, source]);

  // Use the main price hook
  const { price: primaryPrice, formattedPrice, status } = usePrice(source, handlePriceChange);

  // Reset audio throttle state when source changes
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
  }, [source]);

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

  // Initialize favicon link element
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = FAVICON_DEFAULT;
    faviconLinkRef.current = link;

    return () => {
      if (faviconLinkRef.current) {
        faviconLinkRef.current.href = FAVICON_DEFAULT;
      }
    };
  }, []);

  // Update document title
  useEffect(() => {
    if (status === "connected" && formattedPrice) {
      document.title = `$${formattedPrice} - ETH`;
    } else {
      document.title = "ETH Ticker";
    }
  }, [status, formattedPrice]);

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
        {/* Source Selector */}
        <SourceSelector source={source} onSourceChange={setSource} />

        {/* Audio unlock hint */}
        {!audioUnlocked && (
          <span className="text-white/30 text-xs tracking-widest uppercase animate-pulse absolute left-1/2 -translate-x-1/2">
            Click anywhere for audio
          </span>
        )}

        {/* WebSocket Status */}
        <div className="flex items-center gap-2">
          <span className="text-white/30 text-xs tracking-widest uppercase">
            WS
          </span>
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
          {/* ETH Label with Source Badge */}
          <div className="flex items-center gap-3">
            <span className="text-white/40 text-sm tracking-[0.3em] uppercase">
              ETH / USD
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

        {/* News Sentiment Feed Section */}
        <NewsSentimentFeed />
      </div>

      {/* Bottom attribution - Fixed */}
      <div className="fixed bottom-6 left-0 right-0 text-center text-white/10 text-xs tracking-widest uppercase">
        {source === "hyperliquid" ? "Hyperliquid" : "Binance"}
      </div>
    </main>
  );
}
