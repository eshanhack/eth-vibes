"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";

type ConnectionStatus = "connecting" | "connected" | "disconnected";
type Direction = "up" | "down";
type MoveSize = "small" | "medium" | "whale" | null;

// Spring transition for digit roller - snappy, mechanical feel
const digitSpringTransition = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
};

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

// Individual digit column component
interface DigitColumnProps {
  digit: string;
  colorClass: string;
  moveSize: MoveSize;
  priceDirection: Direction | null;
  index: number;
  onFirstDigitAnimationStart?: () => void;
}

function DigitColumn({ 
  digit, 
  colorClass, 
  moveSize,
  priceDirection,
  index,
  onFirstDigitAnimationStart
}: DigitColumnProps) {
  const digitValue = parseInt(digit, 10);
  const prevDigitRef = useRef(digitValue);
  const isFirstDigit = index === 0;
  
  // Calculate Y offset - each digit takes DIGIT_HEIGHT em
  const yOffset = -digitValue * DIGIT_HEIGHT;

  // Calculate intensity-based glow
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

  // Check if digit changed and trigger callback
  useEffect(() => {
    if (prevDigitRef.current !== digitValue) {
      if (isFirstDigit && onFirstDigitAnimationStart) {
        onFirstDigitAnimationStart();
      }
      prevDigitRef.current = digitValue;
    }
  }, [digitValue, isFirstDigit, onFirstDigitAnimationStart]);

  // Motion blur for whale moves
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

// Static character component (for , .)
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

// Digit Roller component
interface DigitRollerProps {
  value: string;
  colorClass: string;
  moveSize: MoveSize;
  priceDirection: Direction | null;
  onFirstDigitAnimationStart?: () => void;
}

function DigitRoller({ 
  value, 
  colorClass, 
  moveSize,
  priceDirection,
  onFirstDigitAnimationStart
}: DigitRollerProps) {
  const characters = useMemo(() => value.split(""), [value]);
  let digitIndex = 0;

  return (
    <div className="flex items-center font-bold tracking-tight tabular-nums">
      {characters.map((char, index) => {
        const isDigit = /\d/.test(char);
        
        if (isDigit) {
          const currentDigitIndex = digitIndex;
          digitIndex++;
          return (
            <DigitColumn
              key={`digit-${index}`}
              digit={char}
              colorClass={colorClass}
              moveSize={moveSize}
              priceDirection={priceDirection}
              index={currentDigitIndex}
              onFirstDigitAnimationStart={currentDigitIndex === 0 ? onFirstDigitAnimationStart : undefined}
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

export default function Home() {
  const [ethPrice, setEthPrice] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [priceDirection, setPriceDirection] = useState<Direction | null>(null);
  const [moveSize, setMoveSize] = useState<MoveSize>(null);
  const [currentBps, setCurrentBps] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isSliding, setIsSliding] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastDirectionRef = useRef<Direction>("up");
  const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const faviconTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const faviconLinkRef = useRef<HTMLLinkElement | null>(null);
  const motionBlurTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingAudioRef = useRef<{ direction: Direction; bps: number } | null>(null);

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

  // Change favicon temporarily
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

  // Update document title based on connection status and price
  useEffect(() => {
    if (status === "connected" && ethPrice) {
      document.title = `$${ethPrice} - ETH`;
    } else {
      document.title = "ETH Ticker";
    }
  }, [status, ethPrice]);

  // Initialize AudioContext on user interaction
  const enableAudio = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
    setAudioEnabled(true);
  }, []);

  // Play price sound - now triggered by animation start
  const playPriceSound = useCallback((direction: Direction, bps: number) => {
    if (!audioContextRef.current || !audioEnabled) return;

    const ctx = audioContextRef.current;
    const now = ctx.currentTime;

    const frequency = direction === "up" ? 800 : 400;

    let duration: number;
    let volume: number;
    let waveType: OscillatorType;
    let useAlarmEffect = false;

    if (bps < 1) {
      duration = 0.08;
      volume = 0.08;
      waveType = "sine";
    } else if (bps <= 5) {
      duration = 0.5;
      volume = 0.2;
      waveType = "sine";
    } else {
      duration = 1.0;
      volume = 0.4;
      waveType = "triangle";
      useAlarmEffect = true;
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = waveType;
    oscillator.frequency.setValueAtTime(frequency, now);

    if (useAlarmEffect) {
      const highFreq = frequency * 1.25;
      const lowFreq = frequency;
      const oscillations = 4;
      const stepDuration = duration / (oscillations * 2);
      
      for (let i = 0; i < oscillations; i++) {
        const t = now + i * stepDuration * 2;
        oscillator.frequency.setValueAtTime(lowFreq, t);
        oscillator.frequency.linearRampToValueAtTime(highFreq, t + stepDuration);
        oscillator.frequency.linearRampToValueAtTime(lowFreq, t + stepDuration * 2);
      }
    }

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
    
    if (useAlarmEffect) {
      gainNode.gain.setValueAtTime(volume, now + duration * 0.7);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
    } else {
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
    }

    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }, [audioEnabled]);

  // Callback when first digit starts animating - triggers synced audio
  const handleFirstDigitAnimationStart = useCallback(() => {
    if (pendingAudioRef.current) {
      playPriceSound(pendingAudioRef.current.direction, pendingAudioRef.current.bps);
      pendingAudioRef.current = null;
    }
  }, [playPriceSound]);

  // Calculate move size from bps
  const getMoveSize = (bps: number): MoveSize => {
    if (bps < 1) return "small";
    if (bps <= 5) return "medium";
    return "whale";
  };

  // Get flash duration based on move size
  const getFlashDuration = (size: MoveSize): number => {
    switch (size) {
      case "small": return 150;
      case "medium": return 500;
      case "whale": return 1500;
      default: return 300;
    }
  };

  // Get motion blur duration based on move size
  const getMotionBlurDuration = (size: MoveSize): number => {
    switch (size) {
      case "whale": return 200;
      default: return 0;
    }
  };

  useEffect(() => {
    const connect = () => {
      setStatus("connecting");
      const ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
      wsRef.current = ws;

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
              const price = parseFloat(ethMid);
              
              if (prevPriceRef.current !== null) {
                const priceDiff = price - prevPriceRef.current;
                const bps = Math.abs(priceDiff / prevPriceRef.current) * 10000;
                const size = getMoveSize(bps);
                const duration = getFlashDuration(size);
                const motionBlurDuration = getMotionBlurDuration(size);
                
                if (flashTimeoutRef.current) {
                  clearTimeout(flashTimeoutRef.current);
                }
                if (motionBlurTimeoutRef.current) {
                  clearTimeout(motionBlurTimeoutRef.current);
                }
                
                const direction: Direction = priceDiff > 0 ? "up" : "down";
                
                if (priceDiff !== 0) {
                  setPriceDirection(direction);
                  lastDirectionRef.current = direction;
                  setMoveSize(size);
                  setCurrentBps(bps);
                  flashFavicon(direction, duration);
                  
                  pendingAudioRef.current = { direction, bps };
                  
                  if (size === "whale") {
                    setIsSliding(true);
                    motionBlurTimeoutRef.current = setTimeout(() => {
                      setIsSliding(false);
                    }, motionBlurDuration);
                  }
                  
                  flashTimeoutRef.current = setTimeout(() => {
                    setPriceDirection(null);
                    setMoveSize(null);
                    setCurrentBps(0);
                  }, duration);
                }
              }
              
              prevPriceRef.current = price;
              setEthPrice(price.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }));
            }
          }
        } catch (e) {
          console.error("Error parsing message:", e);
        }
      };

      ws.onclose = () => {
        setStatus("disconnected");
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      if (faviconTimeoutRef.current) {
        clearTimeout(faviconTimeoutRef.current);
      }
      if (motionBlurTimeoutRef.current) {
        clearTimeout(motionBlurTimeoutRef.current);
      }
    };
  }, [flashFavicon]);

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
      {/* Motion blur styles */}
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
      `}</style>

      {/* WebSocket Status Indicator - Top Right Corner */}
      <div className="fixed top-6 right-6 flex items-center gap-2 z-20">
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
        {/* ETH Label */}
        <div className="flex items-center gap-3">
          <span className="text-white/40 text-sm tracking-[0.3em] uppercase">
            ETH / USD
          </span>
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
          {ethPrice ? (
            <DigitRoller
              value={ethPrice}
              colorClass={getPriceColorClass()}
              moveSize={moveSize}
              priceDirection={priceDirection}
              onFirstDigitAnimationStart={handleFirstDigitAnimationStart}
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

        {/* Audio Toggle Button */}
        <button
          onClick={enableAudio}
          className={`mt-4 px-6 py-3 text-xs tracking-[0.2em] uppercase transition-all duration-300 border ${
            audioEnabled
              ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
              : "border-white/20 text-white/50 hover:border-white/40 hover:text-white/80 hover:bg-white/5"
          }`}
        >
          {audioEnabled ? (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
              Audio On
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
              Start Audio
            </span>
          )}
        </button>
      </div>

      {/* Bottom attribution */}
      <div className="fixed bottom-6 text-white/10 text-xs tracking-widest">
        HYPERLIQUID
      </div>
    </main>
  );
}
