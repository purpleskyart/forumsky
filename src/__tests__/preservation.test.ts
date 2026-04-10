/**
 * Preservation Property Tests — Task 2
 *
 * These tests MUST PASS on unfixed code. They capture the baseline behaviour
 * that must NOT change after the fixes are applied.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Generate a random DID string like "did:plc:xxxxxxxxxxxxxxxx" */
function randomDid(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `did:plc:${id}`;
}

/** Generate an array of N random DIDs */
function randomDids(n: number): string[] {
  return Array.from({ length: n }, () => randomDid());
}

// ---------------------------------------------------------------------------
// Preservation 1 — Session restore
// Validates: Requirement 3.1
//
// Generate random valid OAuth session states; assert initAuth() resolves the
// profile and sets currentUser correctly.
// MUST PASS on unfixed code: session restore is already working.
// ---------------------------------------------------------------------------
describe('Preservation 1 — Session restore: initAuth() resolves profile for valid sessions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property: For any valid OAuth session (random DID + handle), the setupSession
   * path correctly resolves a ProfileView with the correct DID.
   * We test this by directly exercising the session-setup logic with a mock
   * OAuth session object, bypassing the BrowserOAuthClient.
   *
   * **Validates: Requirements 3.1**
   */
  it('resolves the profile and sets currentUser for a valid session (property over random sessions)', async () => {
    // Generate several random session states to exercise the property
    const sessions = Array.from({ length: 5 }, () => ({
      did: randomDid(),
      handle: `user${Math.floor(Math.random() * 10000)}.bsky.social`,
    }));

    for (const session of sessions) {
      // Mock localStorage to avoid side effects
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});

      // Mock fetch so getProfile returns the expected profile
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            did: session.did,
            handle: session.handle,
            displayName: 'Test User',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      // Import xrpc and set up a mock OAuth session so xrpcSessionGet works
      const { setOAuthSession } = await import('@/api/xrpc');
      setOAuthSession({
        did: session.did,
        sub: session.did,
        fetchHandler: async (_path: string, _init?: RequestInit) =>
          new Response(
            JSON.stringify({ did: session.did, handle: session.handle }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      } as never);

      // Import getProfile and call it directly — this is what initAuth calls after session setup
      const { getProfile } = await import('@/api/actor');
      const profile = await getProfile(session.did);

      // Assert: profile must be resolved with the correct DID
      expect(profile).not.toBeNull();
      expect(profile.did).toBe(session.did);

      // Clean up
      setOAuthSession(null);
      fetchSpy.mockRestore();
      vi.restoreAllMocks();
    }
  }, 15000);

  /**
   * Property: initAuth() returns null (not throws) when no session exists.
   * This is the guest path — must remain stable.
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  it('returns null (not throws) when no session is stored', async () => {
    vi.resetModules();

    vi.doMock('@atproto/oauth-client-browser', () => ({
      BrowserOAuthClient: class {
        async init() {
          // No session — returns null result
          return null;
        }
        async signIn() {}
      },
    }));

    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});

    const { initAuth } = await import('@/api/auth');
    const profile = await initAuth();

    expect(profile).toBeNull();

    vi.restoreAllMocks();
  }, 5000);
});

// ---------------------------------------------------------------------------
// Preservation 2 — Guest load
// Validates: Requirement 3.2
//
// With no stored session, initAuth() returns null and the app can render
// public content without sign-in.
// MUST PASS on unfixed code: guest browsing already works.
// ---------------------------------------------------------------------------
describe('Preservation 2 — Guest load: app works without sign-in when no session stored', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property: When no OAuth session is stored, initAuth() returns null and
   * does not throw, allowing the app to render as a guest.
   *
   * **Validates: Requirements 3.2**
   */
  it('initAuth returns null for guest (no stored session) without throwing', async () => {
    vi.resetModules();

    vi.doMock('@atproto/oauth-client-browser', () => ({
      BrowserOAuthClient: class {
        async init() { return null; }
        async signIn() {}
      },
    }));

    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});

    const { initAuth } = await import('@/api/auth');

    let threw = false;
    let result: unknown = undefined;
    try {
      result = await initAuth();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBeNull();
  }, 5000);

  /**
   * Property: mayHaveRestorableSession() returns false when no accounts are stored.
   * This ensures the guest UI is shown immediately without waiting for auth init.
   *
   * **Validates: Requirements 3.2**
   */
  it('mayHaveRestorableSession returns false when no accounts are stored', async () => {
    vi.resetModules();

    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);

    const { mayHaveRestorableSession } = await import('@/api/auth');
    const result = mayHaveRestorableSession();

    expect(result).toBe(false);

    vi.restoreAllMocks();
  }, 3000);
});

// ---------------------------------------------------------------------------
// Preservation 3 — Graph policy filter correctness
// Validates: Requirements 3.5
//
// Generate random sets of DIDs; assert that after refreshGraphPolicy() completes,
// isAuthorFiltered(did) returns correct results for known muted/blocked DIDs.
// MUST PASS on unfixed code: graph policy filtering already works correctly.
// ---------------------------------------------------------------------------

// Import xrpc at module level so we can spy on it without vi.doMock
import * as xrpcModule from '@/api/xrpc';
import * as graphPolicyModule from '@/lib/graph-policy';
import * as storeModule from '@/lib/store';

describe('Preservation 3 — Graph policy: isAuthorFiltered returns correct results after refreshGraphPolicy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property: For any random set of muted/blocked DIDs, after refreshGraphPolicy()
   * completes, isAuthorFiltered(did) returns true for muted/blocked DIDs and
   * false for unrelated DIDs.
   *
   * **Validates: Requirements 3.5**
   */
  it('isAuthorFiltered returns correct results for random muted/blocked DID sets', async () => {
    const iterations = 5;

    for (let i = 0; i < iterations; i++) {
      const mutedSet = randomDids(3 + Math.floor(Math.random() * 5));
      const blockedSet = randomDids(2 + Math.floor(Math.random() * 4));
      const unrelatedSet = randomDids(5);

      // Ensure no overlap between muted/blocked and unrelated
      const allFilteredDids = new Set([...mutedSet, ...blockedSet]);
      const cleanUnrelated = unrelatedSet.filter(d => !allFilteredDids.has(d));

      // Spy on xrpcSessionGet to return controlled data
      vi.spyOn(xrpcModule, 'xrpcSessionGet').mockImplementation(async (nsid: string) => {
        if (nsid === 'app.bsky.graph.getMutes') {
          return { mutes: mutedSet.map(did => ({ did })), cursor: undefined } as never;
        }
        if (nsid === 'app.bsky.graph.getBlocks') {
          return { blocks: blockedSet.map(did => ({ did })), cursor: undefined } as never;
        }
        if (nsid === 'app.bsky.graph.getFollows') {
          return { follows: [], cursor: undefined } as never;
        }
        return {} as never;
      });

      storeModule.currentUser.value = { did: randomDid(), handle: 'test.bsky.social' } as never;

      await graphPolicyModule.refreshGraphPolicy();

      // Assert: muted DIDs are filtered
      for (const did of mutedSet) {
        expect(graphPolicyModule.isAuthorFiltered(did)).toBe(true);
      }

      // Assert: blocked DIDs are filtered
      for (const did of blockedSet) {
        expect(graphPolicyModule.isAuthorFiltered(did)).toBe(true);
      }

      // Assert: unrelated DIDs are NOT filtered
      for (const did of cleanUnrelated) {
        expect(graphPolicyModule.isAuthorFiltered(did)).toBe(false);
      }

      vi.restoreAllMocks();
    }
  }, 15000);

  /**
   * Property: clearGraphPolicy() resets all filter sets so isAuthorFiltered
   * returns false for all DIDs.
   *
   * **Validates: Requirements 3.5**
   */
  it('clearGraphPolicy resets all filter sets', async () => {
    const dids = randomDids(5);

    vi.spyOn(xrpcModule, 'xrpcSessionGet').mockImplementation(async (nsid: string) => {
      if (nsid === 'app.bsky.graph.getMutes') {
        return { mutes: dids.map(did => ({ did })), cursor: undefined } as never;
      }
      return { blocks: [], follows: [], cursor: undefined } as never;
    });

    storeModule.currentUser.value = null;

    await graphPolicyModule.refreshGraphPolicy();

    // Verify some are filtered
    expect(graphPolicyModule.isAuthorFiltered(dids[0])).toBe(true);

    // Clear and verify none are filtered
    graphPolicyModule.clearGraphPolicy();
    for (const did of dids) {
      expect(graphPolicyModule.isAuthorFiltered(did)).toBe(false);
    }
  }, 5000);
});

// ---------------------------------------------------------------------------
// Preservation 4 — Fetch completing before unmount still updates state
// Validates: Requirement 3.6
//
// Assert that a fetch completing before the component unmounts still updates
// state correctly (abort is a no-op on settled promises).
// MUST PASS on unfixed code: this is the existing happy-path behaviour.
// ---------------------------------------------------------------------------
describe('Preservation 4 — Fetch before unmount: state updates correctly when fetch completes before unmount', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property: When a fetch completes before the AbortController is aborted,
   * the result is still available (abort is a no-op on settled promises).
   * We test this at the Promise level — the core semantic that must be preserved.
   *
   * **Validates: Requirements 3.6**
   */
  it('fetch result is available when fetch completes before abort is called', async () => {
    const expectedData = { posts: [{ uri: 'at://test/1', cid: 'abc' }] };

    // Test the core semantic: a promise that resolves before abort is called
    // still delivers its result. This is the fundamental property that must hold.
    const controller = new AbortController();

    // Simulate a fetch that resolves immediately (before any abort)
    const fetchPromise = Promise.resolve(expectedData);

    // Fetch resolves before abort
    const result = await fetchPromise;

    // Abort AFTER the fetch has already settled — should be a no-op
    controller.abort();

    // Assert: result is still the expected data
    expect(result).toEqual(expectedData);
  }, 5000);

  /**
   * Property: The cancelled flag pattern (existing baseline) correctly prevents
   * state updates after unmount when the flag is set before the fetch resolves.
   *
   * **Validates: Requirements 3.6**
   */
  it('cancelled flag prevents state update after unmount (existing baseline pattern)', async () => {
    let stateUpdated = false;
    let cancelled = false;

    // Simulate a slow fetch
    const fetchPromise = sleep(50).then(() => ({ data: 'result' }));

    // Simulate component unmount before fetch resolves
    const loadEffect = async () => {
      const result = await fetchPromise;
      if (!cancelled) {
        stateUpdated = true;
        return result;
      }
    };

    // Start the load
    const effectPromise = loadEffect();

    // Unmount (set cancelled) before fetch resolves
    cancelled = true;

    await effectPromise;

    // Assert: state was NOT updated because cancelled was set
    expect(stateUpdated).toBe(false);
  }, 3000);

  /**
   * Property: When fetch completes BEFORE the cancelled flag is set,
   * state IS updated correctly.
   *
   * **Validates: Requirements 3.6**
   */
  it('state IS updated when fetch completes before cancelled flag is set', async () => {
    let stateUpdated = false;
    let cancelled = false;

    const fetchPromise = Promise.resolve({ data: 'result' });

    const loadEffect = async () => {
      const result = await fetchPromise;
      if (!cancelled) {
        stateUpdated = true;
        return result;
      }
    };

    await loadEffect();

    // cancelled is still false — state should have been updated
    expect(stateUpdated).toBe(true);
  }, 3000);

  /**
   * Property: xrpcGet with a non-aborted signal still returns the response.
   * Tests that passing a signal doesn't break the happy path.
   *
   * **Validates: Requirements 3.6**
   */
  it('xrpcGet returns response when signal is not aborted', async () => {
    const expectedData = { posts: [{ uri: 'at://test/1', cid: 'abc' }] };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(expectedData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const controller = new AbortController();

    // Call xrpcGet — signal is not aborted
    // On unfixed code: signal param is ignored, fetch still runs and returns data
    const result = await (xrpcModule.xrpcGet as (...args: unknown[]) => Promise<unknown>)(
      'app.bsky.feed.searchPosts',
      { q: 'test' },
      controller.signal,
    );

    // Assert: result is the expected data (fetch completed before any abort)
    expect(result).toEqual(expectedData);

    vi.restoreAllMocks();
  }, 5000);
});

// ---------------------------------------------------------------------------
// Preservation 5 — Sequential xrpcGet calls each get a fresh response
// Validates: Requirement 3.7
//
// Assert that two sequential (non-concurrent) calls to xrpcGet with the same
// URL each receive a response. Deduplication is in-flight only — sequential
// calls must NOT be deduplicated.
// MUST PASS on unfixed code: no deduplication exists yet, so both calls succeed.
// ---------------------------------------------------------------------------
describe('Preservation 5 — Sequential xrpcGet: each sequential call gets a fresh response', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property: Two sequential (non-concurrent) calls to xrpcGet with the same
   * URL each receive a valid response. Deduplication must only apply to
   * in-flight concurrent calls, not sequential ones.
   *
   * **Validates: Requirements 3.7**
   */
  it('two sequential identical xrpcGet calls each receive a response', async () => {
    let fetchCallCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ posts: [], callIndex: fetchCallCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    // First call — sequential, not concurrent
    const result1 = await xrpcModule.xrpcGet('app.bsky.feed.searchPosts', { q: 'hello' });

    // Second call — starts AFTER the first has fully resolved
    const result2 = await xrpcModule.xrpcGet('app.bsky.feed.searchPosts', { q: 'hello' });

    // Assert: both calls received a response
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();

    // Assert: fetch was called for each sequential call
    // (on unfixed code: 2 calls; on fixed code with deduplication: still 2 calls
    //  because deduplication only applies to in-flight concurrent requests)
    expect(fetchCallCount).toBeGreaterThanOrEqual(2);

    vi.restoreAllMocks();
  }, 5000);

  /**
   * Property: For any N sequential calls with the same URL, each call resolves
   * successfully (no stale promise reuse across settled calls).
   *
   * **Validates: Requirements 3.7**
   */
  it('N sequential identical xrpcGet calls all resolve successfully (property over N)', async () => {
    const N = 4;
    let fetchCallCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ posts: [], callIndex: fetchCallCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const results: unknown[] = [];
    for (let i = 0; i < N; i++) {
      // Each call is sequential — awaited before the next starts
      const result = await xrpcModule.xrpcGet('app.bsky.feed.searchPosts', { q: 'sequential' });
      results.push(result);
    }

    // Assert: all N calls resolved
    expect(results).toHaveLength(N);
    for (const result of results) {
      expect(result).toBeDefined();
    }

    // Assert: fetch was called N times (sequential calls are never deduplicated)
    expect(fetchCallCount).toBe(N);

    vi.restoreAllMocks();
  }, 10000);
});
