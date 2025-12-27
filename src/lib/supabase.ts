import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for our tweet data
export interface StoredTweet {
  id: string;
  text: string;
  created_at: string;
  timestamp: number;
  url: string | null;
  price_at_t: number | null;
  timeframe_1m: { price: number | null; change: number | null; pending: boolean } | null;
  timeframe_10m: { price: number | null; change: number | null; pending: boolean } | null;
  timeframe_30m: { price: number | null; change: number | null; pending: boolean } | null;
  timeframe_1h: { price: number | null; change: number | null; pending: boolean } | null;
  impact_score: number;
  impact_direction: 'positive' | 'negative' | 'neutral';
  updated_at: string;
}

// Fetch all stored tweets from Supabase
export async function getStoredTweets(): Promise<StoredTweet[]> {
  const { data, error } = await supabase
    .from('tweets')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching tweets from Supabase:', error);
    return [];
  }

  return data || [];
}

// Save or update a tweet in Supabase
export async function saveTweetImpact(tweet: {
  id: string;
  text: string;
  createdAt: string;
  timestamp: number;
  url: string | null;
  priceAtT: number | null;
  timeframes: {
    '1m': { price: number | null; change: number | null; pending: boolean };
    '10m': { price: number | null; change: number | null; pending: boolean };
    '30m': { price: number | null; change: number | null; pending: boolean };
    '1h': { price: number | null; change: number | null; pending: boolean };
  };
  impactScore: number;
  impactDirection: 'positive' | 'negative' | 'neutral';
}): Promise<boolean> {
  // First, check if this tweet already exists
  const { data: existing } = await supabase
    .from('tweets')
    .select('*')
    .eq('id', tweet.id)
    .single();

  if (existing) {
    // Only update timeframes that were pending and are now completed
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Update price_at_t if it was null
    if (existing.price_at_t === null && tweet.priceAtT !== null) {
      updates.price_at_t = tweet.priceAtT;
    }

    // Update each timeframe only if it was pending
    if (existing.timeframe_1m?.pending && !tweet.timeframes['1m'].pending) {
      updates.timeframe_1m = tweet.timeframes['1m'];
    }
    if (existing.timeframe_10m?.pending && !tweet.timeframes['10m'].pending) {
      updates.timeframe_10m = tweet.timeframes['10m'];
    }
    if (existing.timeframe_30m?.pending && !tweet.timeframes['30m'].pending) {
      updates.timeframe_30m = tweet.timeframes['30m'];
    }
    if (existing.timeframe_1h?.pending && !tweet.timeframes['1h'].pending) {
      updates.timeframe_1h = tweet.timeframes['1h'];
    }

    // Recalculate impact score if any timeframes were updated
    if (Object.keys(updates).length > 1) {
      updates.impact_score = tweet.impactScore;
      updates.impact_direction = tweet.impactDirection;

      const { error } = await supabase
        .from('tweets')
        .update(updates)
        .eq('id', tweet.id);

      if (error) {
        console.error('Error updating tweet in Supabase:', error);
        return false;
      }
    }

    return true;
  }

  // Insert new tweet
  const { error } = await supabase.from('tweets').insert({
    id: tweet.id,
    text: tweet.text,
    created_at: tweet.createdAt,
    timestamp: tweet.timestamp,
    url: tweet.url,
    price_at_t: tweet.priceAtT,
    timeframe_1m: tweet.timeframes['1m'],
    timeframe_10m: tweet.timeframes['10m'],
    timeframe_30m: tweet.timeframes['30m'],
    timeframe_1h: tweet.timeframes['1h'],
    impact_score: tweet.impactScore,
    impact_direction: tweet.impactDirection,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Error inserting tweet to Supabase:', error);
    return false;
  }

  return true;
}

// Convert stored tweet to app format
export function storedTweetToAppFormat(stored: StoredTweet) {
  return {
    id: stored.id,
    text: stored.text,
    createdAt: stored.created_at,
    timestamp: stored.timestamp,
    url: stored.url,
    priceAtT: stored.price_at_t,
    timeframes: {
      '1m': stored.timeframe_1m || { price: null, change: null, pending: true },
      '10m': stored.timeframe_10m || { price: null, change: null, pending: true },
      '30m': stored.timeframe_30m || { price: null, change: null, pending: true },
      '1h': stored.timeframe_1h || { price: null, change: null, pending: true },
    },
    impactScore: stored.impact_score || 0,
    impactDirection: stored.impact_direction || 'neutral',
  };
}

