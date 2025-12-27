import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Check if Supabase is configured
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Lazy initialization - only create client if env vars are present
let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) {
    return null;
  }
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl!, supabaseAnonKey!);
  }
  return supabaseClient;
}

// Supported assets type (must match page.tsx)
export type Asset = 'BTC' | 'ETH' | 'SOL' | 'XRP';

// Types for our tweet data
export interface StoredTweet {
  id: string;
  asset: Asset;
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

// Fetch stored tweets for a specific asset from Supabase
export async function getStoredTweetsForAsset(asset: Asset): Promise<StoredTweet[]> {
  const supabase = getSupabase();
  if (!supabase) {
    console.log('Supabase not configured, skipping fetch');
    return [];
  }

  const { data, error } = await supabase
    .from('tweets')
    .select('*')
    .eq('asset', asset)
    .order('timestamp', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching tweets from Supabase:', error);
    return [];
  }

  return data || [];
}

// Legacy function - fetch all tweets (for backward compatibility)
export async function getStoredTweets(): Promise<StoredTweet[]> {
  return getStoredTweetsForAsset('ETH');
}

// Save or update a tweet with price data for a specific asset
export async function saveTweetImpact(tweet: {
  id: string;
  asset: Asset;
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
  const supabase = getSupabase();
  if (!supabase) {
    console.log('Supabase not configured, skipping save');
    return false;
  }

  // Check if this tweet+asset combo already exists
  const { data: existing } = await supabase
    .from('tweets')
    .select('*')
    .eq('id', tweet.id)
    .eq('asset', tweet.asset)
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
        .eq('id', tweet.id)
        .eq('asset', tweet.asset);

      if (error) {
        console.error('Error updating tweet in Supabase:', error);
        return false;
      }
    }

    return true;
  }

  // Insert new tweet+asset record
  const { error } = await supabase.from('tweets').insert({
    id: tweet.id,
    asset: tweet.asset,
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

// ============================================
// MACRO EVENTS - Store historical price data
// ============================================

export interface StoredMacroEvent {
  id: string; // event ID like "fomc-2025-12-17"
  asset: Asset;
  baseline_price: number | null;
  window_1m: { price: number | null; change: number | null; locked: boolean } | null;
  window_10m: { price: number | null; change: number | null; locked: boolean } | null;
  window_30m: { price: number | null; change: number | null; locked: boolean } | null;
  window_1h: { price: number | null; change: number | null; locked: boolean } | null;
  updated_at: string;
}

// Fetch stored macro event prices for a specific asset
export async function getStoredMacroEventsForAsset(asset: Asset): Promise<StoredMacroEvent[]> {
  const supabase = getSupabase();
  if (!supabase) {
    console.log('[Supabase] Not configured, skipping macro events fetch');
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('macro_events')
      .select('*')
      .eq('asset', asset);

    if (error) {
      // Table might not exist yet - that's okay
      if (error.code === '42P01') {
        console.log('[Supabase] macro_events table does not exist yet');
        return [];
      }
      console.error('[Supabase] Error fetching macro events:', error.message);
      return [];
    }

    console.log(`[Supabase] Fetched ${data?.length || 0} macro events for ${asset}`);
    return data || [];
  } catch (err) {
    console.error('[Supabase] Exception fetching macro events:', err);
    return [];
  }
}

// Save or update macro event price data
export async function saveMacroEventPrices(event: {
  id: string;
  asset: Asset;
  baselinePrice: number | null;
  priceWindows: {
    '1m': { price: number | null; change: number | null; locked: boolean };
    '10m': { price: number | null; change: number | null; locked: boolean };
    '30m': { price: number | null; change: number | null; locked: boolean };
    '1h': { price: number | null; change: number | null; locked: boolean };
  };
}): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    console.log('[Supabase] Not configured, skipping macro event save');
    return false;
  }

  try {
    // First, delete any existing record
    await supabase
      .from('macro_events')
      .delete()
      .eq('id', event.id)
      .eq('asset', event.asset);

    // Then insert the new record
    const { error } = await supabase
      .from('macro_events')
      .insert({
        id: event.id,
        asset: event.asset,
        baseline_price: event.baselinePrice,
        window_1m: event.priceWindows['1m'],
        window_10m: event.priceWindows['10m'],
        window_30m: event.priceWindows['30m'],
        window_1h: event.priceWindows['1h'],
        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.error('[Supabase] Error inserting macro event:', error.message, error.code);
      return false;
    }

    console.log(`[Supabase] Saved macro event ${event.id} for ${event.asset}`);
    return true;
  } catch (err) {
    console.error('[Supabase] Exception saving macro event:', err);
    return false;
  }
}

// Convert stored macro event to app format
export function storedMacroEventToAppFormat(stored: StoredMacroEvent) {
  return {
    baselinePrice: stored.baseline_price,
    priceWindows: {
      '1m': stored.window_1m || { price: null, change: null, locked: false },
      '10m': stored.window_10m || { price: null, change: null, locked: false },
      '30m': stored.window_30m || { price: null, change: null, locked: false },
      '1h': stored.window_1h || { price: null, change: null, locked: false },
    },
  };
}

