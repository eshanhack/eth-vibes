"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";

type ConnectionStatus = "connecting" | "connected" | "disconnected";
type Direction = "up" | "down";
type MoveSize = "small" | "medium" | "whale" | null;
type PriceSource = "hyperliquid" | "binance";

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

// ========== Main Component ==========

export default function Home() {
  const [source, setSource] = useState<PriceSource>("hyperliquid");
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

  // Shadow source is opposite of main source
  const shadowSource: PriceSource = source === "hyperliquid" ? "binance" : "hyperliquid";

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

  // Use the shadow price hook (background feed)
  const shadowPrice = useShadowPrice(shadowSource);

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-black">
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
      `}</style>

      {/* Top Bar */}
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
      
      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8">
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

        {/* Status */}
        <div className="text-white/20 text-xs tracking-widest uppercase">
          {status === "connected" && "Live"}
          {status === "connecting" && "Connecting..."}
          {status === "disconnected" && "Reconnecting..."}
        </div>
      </div>

      {/* Bottom section - Price Gap */}
      <div className="fixed bottom-6 flex flex-col items-center gap-2">
        <PriceGap 
          primaryPrice={primaryPrice} 
          shadowPrice={shadowPrice} 
          primarySource={source} 
        />
        <div className="text-white/10 text-xs tracking-widest uppercase">
          {source === "hyperliquid" ? "Hyperliquid" : "Binance"}
        </div>
      </div>
    </main>
  );
}
