# Initial Load Performance Bugfix Design

## Overview

The app's initial load is slow and sometimes never completes due to seven compounding issues.
This design formalises the bug condition, maps each root cause to a targeted fix, and defines
the testing strategy that validates both the fix and the preservation of existing behaviour.

The fix is intentionally minimal: no new frameworks, no architectural rewrites. Each change is
scoped to the smallest surface that eliminates the defect.

---

## Glossary

- **Bug_Condition (C)**: Any of the seven conditions that cause the initial load to hang, show
  a blank page, or waste network resources — as enumerated in the requirements document.
- **Property (P)**: The desired observable behaviour when the bug condition holds — the app
  reaches a usable state within a bounded time and surfaces errors when it cannot.
- **Preservation**: All existing behaviours that must remain unchanged: session restore, guest
  browsing, OAuth sign-in, graph policy filtering, and normal navigation.
- **`authInitDone`**: The `signal<boolean>` in `src/lib/store.ts` that gates guest/auth UI.
  Must always be set to `true` after `initAuth()` resolves, regardless of outcome.
- **`initAuth()`**: The function in `src/api/auth.ts` that calls `client.init()` and sets up
  the OAuth session. Currently has no timeout.
- **`refreshGraphPolicy()`**: The function in `src/lib/graph-policy.ts` that fetches mutes,
  blocks, and follows. Currently sequential; blocks feed render.
- **`xrpcGet` / `xrpcSessionGet`**: The fetch wrappers in `src/api/xrpc.ts`. Currently have
  no `AbortSignal` support and no in-flight deduplication.
- **`OfflineBanner`**: The component in `src/components/OfflineBanner.tsx` that already tracks
  `navigator.onLine` and `online`/`offline` events. Can be reused for pre-request gating.
- **`isOnline`**: A new exported signal (or plain getter) that exposes the online state from
  `OfflineBanner`'s logic so request code can read it without duplicating event listeners.

---

## Bug Details

### Bug Condition

The bug manifests across seven distinct sub-conditions, all of which contribute to a slow or
permanently broken initial load. The composite condition is:

```
FUNCTION isBugCondition(input)
  INPUT: input of type AppLoadContext {
    clientInitDurationMs: number,
    authInitDone: boolean,
    graphPolicyFetchStrategy: 'sequential' | 'parallel',
    fetchHasAbortController: boolean,
    loadPathErrorsVisible: boolean,
    offlineCheckedBeforeRequest: boolean,
    requestDeduplicationEnabled: boolean
  }
  OUTPUT: boolean

  RETURN (input.clientInitDurationMs > 5000 AND NOT input.authInitDone)
      OR (NOT input.authInitDone AND noSkeletonShown)
      OR (input.graphPolicyFetchStrategy = 'sequential')
      OR (NOT input.fetchHasAbortController)
      OR (NOT input.loadPathErrorsVisible)
      OR (NOT input.offlineCheckedBeforeRequest)
      OR (NOT input.requestDeduplicationEnabled)
END FUNCTION
```

### Examples

- **C1 — Auth timeout**: On a device with corrupted IndexedDB, `client.init()` never resolves.
  `authInitDone` stays `false` forever. The app shows a blank page indefinitely.
- **C2 — No skeleton**: On a fast device, `client.init()` takes 800 ms. The user sees a blank
  white page for that duration with no indication the app is loading.
- **C3 — Sequential graph policy**: After auth resolves, `refreshGraphPolicy()` fetches mutes,
  then blocks, then follows — each paginated. On a user with 500 follows this takes 8–16 s
  before the feed renders.
- **C4 — No AbortController**: The user navigates away from the feed while it is loading.
  The `cancelled` flag is set but the HTTP request continues. When it resolves, `setPosts` is
  called on the unmounted component, causing a React/Preact warning and potential state leak.
- **C5 — Silent errors**: `client.init()` throws (e.g. IndexedDB quota exceeded). The catch
  block swallows the error. The user sees a blank page with no message and no retry button.
- **C6 — No offline detection**: The device is offline. `xrpcGet` fires, retries 4 times with
  exponential backoff (~16 s total), then throws. The user waits 16 s before seeing anything.
- **C7 — No deduplication**: `Home.tsx` and `Community.tsx` both mount simultaneously on the
  root route. Both call `searchPosts` for the same community tag. Two identical HTTP requests
  are made; the second is wasted.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A user with a valid, restorable OAuth session on a healthy device MUST continue to have their
  session restored and the authenticated feed rendered without re-login.
- Guest users MUST continue to see public community feeds without signing in.
- The OAuth sign-in flow (redirect → callback → session store) MUST be unaffected.
- When the device comes back online, normal network operations MUST resume automatically.
- Graph policy data (mutes, blocks, follows) MUST continue to correctly filter feed content.
- Components that unmount normally MUST continue to cancel pending fetches (existing
  `cancelled` flag pattern is preserved; `AbortController` is additive).
- On a fast device with a healthy network, load time MUST be the same or faster.

**Scope:**
All inputs that do NOT trigger any of the seven bug sub-conditions are unaffected by this fix.
This includes:
- Mouse and touch interactions with the UI.
- Keyboard navigation.
- Post creation, editing, and deletion flows.
- Profile and thread page loads (not in the initial load path).

---

## Hypothesized Root Cause

1. **No timeout on `client.init()`** (`src/api/auth.ts`): The `@atproto/oauth-client-browser`
   library reads from IndexedDB during `init()`. On corrupted or slow storage this call never
   settles. There is no `Promise.race()` or `AbortSignal.timeout()` guard.

2. **`authInitDone` gates all UI** (`src/components/Layout.tsx`): `sessionRestorePending()`
   returns `true` while `authInitDone` is `false`, so the layout renders nothing meaningful.
   No skeleton or spinner is shown during this window.

3. **Sequential paginated fetches** (`src/lib/graph-policy.ts`): The three `do…while` loops
   for mutes, blocks, and follows run one after another. Each loop `await`s the previous one
   before starting. On users with large social graphs this serialises 3–N round trips.
   Additionally, `refreshGraphPolicy()` is `await`ed in `Layout.tsx` before `authInitDone` is
   set, which means the feed cannot render until all three lists are fully fetched.

4. **`cancelled` flag without `AbortController`** (`src/pages/Home.tsx`, `Community.tsx`,
   `Activity.tsx`, and other load-path components): The flag prevents state updates after
   unmount but does not cancel the underlying HTTP connection. Stale requests consume
   connections and can trigger rate-limit retries.

5. **Silent error swallowing** (`src/components/Layout.tsx`, `src/pages/Community.tsx`,
   `src/pages/Activity.tsx`): `catch` blocks either do nothing or call `showToast` which
   auto-dismisses. There is no persistent error UI with a retry action on the critical load
   path.

6. **No pre-request online check** (`src/api/xrpc.ts`): `xrpcGet` and `xrpcSessionGet` fire
   unconditionally. The `OfflineBanner` component already tracks `navigator.onLine` but that
   state is not accessible to the request layer.

7. **No in-flight deduplication** (`src/api/xrpc.ts` / `src/lib/cache.ts`): Concurrent
   identical GET requests each create a new `fetch()` call. There is no map of pending
   promises keyed by URL.

---

## Correctness Properties

Property 1: Bug Condition — App Reaches Usable State Within Bounded Time

_For any_ app load where one or more of the seven bug sub-conditions holds (isBugCondition
returns true), the fixed code SHALL ensure the app reaches a visually usable state (skeleton
or content visible, `authInitDone = true`) within 5 seconds of page load, and SHALL display
a user-visible error message with a retry action if network requests fail.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

Property 2: Preservation — Existing Load-Path Behaviour Unchanged

_For any_ app load where none of the seven bug sub-conditions holds (isBugCondition returns
false — i.e. fast device, healthy IndexedDB, online, no duplicate requests), the fixed code
SHALL produce the same observable result as the original code: session restored, feed rendered,
graph policy applied, and no regressions in navigation or post interactions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

---

## Fix Implementation

### Fix 1 — Auth timeout (`src/api/auth.ts`)

**Function**: `initAuth()`

**Change**: Wrap `client.init()` in `Promise.race()` against a 5-second timeout promise.

```
FUNCTION initAuth()
  timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 5000))
  result = await Promise.race([client.init(), timeoutPromise])
  IF result?.session THEN
    return setupSession(result.session)
  RETURN null
  // authInitDone is set in Layout's .finally() — no change needed there
END FUNCTION
```

- The timeout resolves `null` (not rejects) so the existing `catch` in `Layout.tsx` is not
  triggered for a timeout; the app simply continues as a guest.
- `authInitDone.value = true` is already set in the `.finally()` block in `Layout.tsx` and
  requires no change.

**Files changed**: `src/api/auth.ts`

---

### Fix 2 — Auth init skeleton (`src/components/Layout.tsx`)

**Change**: While `authInitDone` is `false` and `mayHaveRestorableSession()` is `true`, render
a full-page skeleton/spinner instead of the blank content area.

```
FUNCTION Layout({ children })
  IF NOT authInitDone.value AND mayHaveRestorableSession() THEN
    RETURN <AppLoadingSkeleton />
  RETURN <existing layout JSX>
END FUNCTION
```

A new minimal component `AppLoadingSkeleton` (or inline JSX) renders a centred spinner with
`aria-label="Loading…"`. It reuses existing CSS skeleton classes where possible.

**Files changed**: `src/components/Layout.tsx`  
**New component** (inline or extracted): `AppLoadingSkeleton`

---

### Fix 3 — Concurrent graph policy + non-blocking (`src/lib/graph-policy.ts`)

**Change**: Replace the three sequential `do…while` loops with `Promise.all()` so all three
lists are fetched concurrently. Additionally, in `Layout.tsx`, change `await refreshGraphPolicy()`
to `void refreshGraphPolicy()` so it does not block `authInitDone` from being set.

```
FUNCTION refreshGraphPolicy()
  [mutesResult, blocksResult, followsResult] = await Promise.all([
    fetchAllMutes(),
    fetchAllBlocks(),
    fetchAllFollows(currentUser.value?.did)
  ])
  mutedDids.value = mutesResult
  blockedDids.value = blocksResult
  followingDids.value = followsResult
END FUNCTION
```

Each `fetchAll*` helper encapsulates the existing paginated `do…while` loop for that list.

In `Layout.tsx`:
```
// Before:
await refreshGraphPolicy();
authInitDone.value = true;

// After:
void refreshGraphPolicy();   // fire-and-forget; signals update when ready
authInitDone.value = true;   // set immediately so feed can render
```

**Files changed**: `src/lib/graph-policy.ts`, `src/components/Layout.tsx`

---

### Fix 4 — AbortController in load-path components

**Change**: Replace the `let cancelled = false` pattern with `AbortController`. Pass
`signal` to `fetch` calls via the XRPC helpers.

**`src/api/xrpc.ts`**: Add an optional `signal?: AbortSignal` parameter to `xrpcGet` and
`xrpcSessionGet`. Forward it to the underlying `fetch()` call.

```
FUNCTION xrpcGet(nsid, params, signal?)
  ...
  res = await fetch(urlStr, { headers: ..., cache: 'no-store', signal })
  ...
END FUNCTION
```

**`src/pages/Home.tsx`**, **`src/pages/Community.tsx`**, **`src/pages/Activity.tsx`**,
and any other load-path component that uses `useEffect` with a `cancelled` flag:

```
useEffect(() => {
  const controller = new AbortController();
  const load = async () => {
    const res = await xrpcGet(nsid, params, controller.signal);
    ...
  };
  void load();
  return () => controller.abort();
}, [...deps]);
```

The `cancelled` flag checks (`if (cancelled) return`) can be removed where the `AbortSignal`
makes them redundant, but may be kept for clarity.

**Files changed**: `src/api/xrpc.ts`, `src/pages/Home.tsx`, `src/pages/Community.tsx`,
`src/pages/Activity.tsx`

---

### Fix 5 — Surface load-path errors (`src/components/Layout.tsx`, load-path pages)

**Change**: On critical load-path failures (auth init, initial feed fetch), render a persistent
inline error message with a "Retry" button instead of silently swallowing the error.

In `Layout.tsx`, add an `authError` state:

```
FUNCTION Layout({ children })
  [authError, setAuthError] = useState(null)

  useEffect(() => {
    initAuth()
      .then(profile => { ... })
      .catch(err => {
        setAuthError(err.message || 'Failed to initialise. Please retry.')
        clearGraphPolicy()
      })
      .finally(() => { authInitDone.value = true })
  }, [])

  IF authError THEN
    RETURN <ErrorPanel message={authError} onRetry={() => window.location.reload()} />
  ...
END FUNCTION
```

In `Community.tsx` and `Activity.tsx`, the existing `setError` / `showToast` pattern is
extended to also render a persistent retry button in the page body (not just a toast).

**Files changed**: `src/components/Layout.tsx`, `src/pages/Community.tsx`,
`src/pages/Activity.tsx`

---

### Fix 6 — Offline detection before requests (`src/api/xrpc.ts`, `src/lib/store.ts`)

**Change**: Export an `isOnline` signal from `src/lib/store.ts` (or a dedicated
`src/lib/network-status.ts`) that mirrors `navigator.onLine` and updates on `online`/`offline`
events. Check this signal at the top of `xrpcGet` and `xrpcSessionGet` before firing any
request.

```
// src/lib/store.ts (addition)
export const isOnline = signal(typeof navigator !== 'undefined' ? navigator.onLine : true);
if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => { isOnline.value = true; });
  window.addEventListener('offline', () => { isOnline.value = false; });
}
```

```
// src/api/xrpc.ts (addition at top of xrpcGet / xrpcSessionGet)
import { isOnline } from '@/lib/store';
if (!isOnline.value) {
  throw new XRPCError(0, 'Offline', 'You are offline. Please check your connection.');
}
```

The `OfflineBanner` component already handles its own `online`/`offline` listeners for
display purposes and does not need to change. The new `isOnline` signal is a separate,
lightweight source of truth for the request layer.

**Files changed**: `src/lib/store.ts`, `src/api/xrpc.ts`

---

### Fix 7 — In-flight request deduplication (`src/api/xrpc.ts`)

**Change**: Add a `Map<string, Promise<unknown>>` in `xrpc.ts` that caches in-flight GET
requests keyed by the full URL string. A second call with the same URL while the first is
pending returns the same promise. The entry is removed when the promise settles.

```
// src/api/xrpc.ts
const inFlight = new Map<string, Promise<unknown>>();

FUNCTION xrpcGet(nsid, params, signal?)
  url = buildUrl(nsid, params)
  key = url.toString()

  IF inFlight.has(key) THEN
    RETURN inFlight.get(key) as Promise<T>
  END IF

  promise = fetchWithRetry(url, signal).finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  RETURN promise
END FUNCTION
```

Deduplication applies only to unauthenticated `xrpcGet`. Authenticated `xrpcSessionGet`
calls are user-specific and session-bound; deduplication there is out of scope for this fix
(and would require per-session keying).

**Files changed**: `src/api/xrpc.ts`

---

## Testing Strategy

### Validation Approach

Testing follows a two-phase approach:

1. **Exploratory** — run tests against the *unfixed* code to confirm the bug manifests and
   understand the root cause.
2. **Fix + Preservation** — run tests against the *fixed* code to verify the bug is gone and
   no existing behaviour regressed.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each of the seven sub-conditions on unfixed
code. Confirm or refute the root cause hypotheses.

**Test Cases**:
1. **Auth hang test**: Mock `client.init()` to never resolve. Assert that `authInitDone` never
   becomes `true` within 10 s on unfixed code. (Will fail — hangs indefinitely.)
2. **Blank page test**: Mock `client.init()` to resolve after 800 ms. Assert that a skeleton
   or spinner is visible within 100 ms of mount on unfixed code. (Will fail — blank page.)
3. **Sequential graph policy test**: Spy on `xrpcSessionGet`. Assert that the second call
   starts before the first resolves on unfixed code. (Will fail — calls are sequential.)
4. **AbortController test**: Mount a component, trigger a fetch, unmount immediately. Assert
   that the underlying `fetch()` was aborted on unfixed code. (Will fail — no abort.)
5. **Silent error test**: Mock `client.init()` to throw. Assert that an error message is
   visible in the DOM on unfixed code. (Will fail — error is swallowed.)
6. **Offline test**: Set `navigator.onLine = false`. Assert that `xrpcGet` throws immediately
   without calling `fetch` on unfixed code. (Will fail — fetch is called anyway.)
7. **Deduplication test**: Call `xrpcGet` twice with the same URL concurrently. Assert that
   `fetch` is called only once on unfixed code. (Will fail — two fetches are made.)

**Expected Counterexamples**:
- `authInitDone` never set → app stuck in loading state.
- No skeleton rendered → blank page during auth init.
- `xrpcSessionGet` call timestamps show sequential ordering.
- `fetch` mock called twice for identical URL.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces
the expected behaviour.

```
FOR ALL input WHERE isBugCondition(input) DO
  result := runFixedAppLoad(input)
  ASSERT result.authInitDoneWithin5s = true
  ASSERT result.skeletonShownDuringInit = true
  ASSERT result.graphPolicyFetchedConcurrently = true
  ASSERT result.staleFetchesAborted = true
  ASSERT result.errorVisibleOnFailure = true
  ASSERT result.offlineErrorImmediateOnNoNetwork = true
  ASSERT result.duplicateFetchCount = 1
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code
produces the same result as the original code.

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalAppLoad(input) = fixedAppLoad(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many random session states, network conditions, and component mount orders.
- It catches edge cases (e.g. rapid mount/unmount cycles) that manual tests miss.
- It provides strong guarantees that the `AbortController` and deduplication changes do not
  alter behaviour on the happy path.

**Test Cases**:
1. **Session restore preservation**: Generate random valid OAuth session states. Assert that
   `initAuth()` still resolves the profile and sets `currentUser` correctly after the fix.
2. **Guest load preservation**: Assert that with no stored session, the app renders public
   community content without requiring sign-in, same as before.
3. **Graph policy filter preservation**: After `refreshGraphPolicy()` completes (now
   concurrent), assert that `isAuthorFiltered(did)` returns the same results as before for
   a known set of muted/blocked DIDs.
4. **AbortController non-interference**: Assert that a fetch that completes before the
   component unmounts still updates state correctly (abort is a no-op on settled promises).
5. **Deduplication non-interference**: Assert that two sequential (not concurrent) calls to
   `xrpcGet` with the same URL each get a fresh response (deduplication only applies to
   in-flight concurrent calls).

### Unit Tests

- `initAuth()` with a 5 s timeout mock: resolves `null` and does not throw.
- `initAuth()` with a fast-resolving mock: returns the profile as before.
- `refreshGraphPolicy()`: assert `Promise.all` is used (spy on `xrpcSessionGet`; all three
  calls start before any resolves).
- `xrpcGet` with `signal` already aborted: throws `AbortError` without calling `fetch`.
- `xrpcGet` with `navigator.onLine = false`: throws `XRPCError(0, 'Offline', ...)`.
- `xrpcGet` called twice concurrently with same URL: `fetch` called exactly once.
- `Layout` with `authInitDone = false` and `mayHaveRestorableSession() = true`: renders
  skeleton, not blank page.
- `Layout` with `initAuth` throwing: renders error panel with retry button.

### Property-Based Tests

- Generate random `clientInitDurationMs` values (0–30 000 ms). For any value > 5 000,
  assert `authInitDone` becomes `true` within 5 100 ms of mount.
- Generate random sets of DIDs for mutes/blocks/follows. Assert that concurrent
  `refreshGraphPolicy()` produces the same `mutedDids`, `blockedDids`, `followingDids`
  sets as the sequential version.
- Generate random sequences of mount/unmount events for `Community`. Assert that no
  `setState` call occurs after unmount (i.e. `AbortController.abort()` was called).
- Generate random pairs of identical GET URLs fired concurrently. Assert `fetch` call count
  equals 1 for each unique URL.

### Integration Tests

- Full app boot with mocked slow IndexedDB: app reaches usable state within 5 s.
- Full app boot with `navigator.onLine = false`: offline banner visible immediately, no
  fetch calls made.
- Navigate to community feed, navigate away before load completes: no console errors about
  state updates on unmounted components.
- Two components mounting simultaneously with the same community tag: network tab shows one
  request, not two.
- Auth init throws: error panel with "Retry" button visible; clicking retry reloads the page.
