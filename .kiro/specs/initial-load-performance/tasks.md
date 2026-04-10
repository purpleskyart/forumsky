# Implementation Plan

- [x] 1. Write bug condition exploration tests (BEFORE implementing any fix)
  - **Property 1: Bug Condition** - Seven Initial Load Defects
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior — they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate each of the seven sub-conditions
  - **Scoped PBT Approach**: For deterministic sub-conditions, scope each property to the concrete failing case to ensure reproducibility
  - Write the following seven sub-tests (can be a single test file, e.g. `src/__tests__/bug-condition.test.ts`):
    1. **Auth hang**: Mock `client.init()` to never resolve; assert `authInitDone` becomes `true` within 6 s — FAILS (hangs forever on unfixed code)
    2. **Blank page**: Mock `client.init()` to resolve after 800 ms; assert a skeleton/spinner is in the DOM within 100 ms of mount — FAILS (blank page on unfixed code)
    3. **Sequential graph policy**: Spy on `xrpcSessionGet`; assert the second call starts before the first resolves — FAILS (calls are sequential on unfixed code)
    4. **No AbortController**: Mount a component, trigger a fetch, unmount immediately; assert the underlying `fetch()` was aborted — FAILS (no abort on unfixed code)
    5. **Silent error**: Mock `client.init()` to throw; assert an error message is visible in the DOM — FAILS (error swallowed on unfixed code)
    6. **No offline check**: Set `navigator.onLine = false`; assert `xrpcGet` throws immediately without calling `fetch` — FAILS (fetch is called anyway on unfixed code)
    7. **No deduplication**: Call `xrpcGet` twice concurrently with the same URL; assert `fetch` is called exactly once — FAILS (two fetches on unfixed code)
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: All seven sub-tests FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found (e.g. "authInitDone never set", "fetch called twice for same URL")
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2. Write preservation property tests (BEFORE implementing any fix)
  - **Property 2: Preservation** - Existing Load-Path Behaviour Unchanged
  - **IMPORTANT**: Follow observation-first methodology — run unfixed code with non-buggy inputs first
  - Observe: on a fast device with healthy IndexedDB and a valid session, `initAuth()` resolves the profile and sets `currentUser` correctly
  - Observe: with no stored session, the app renders public community content without sign-in
  - Observe: after `refreshGraphPolicy()` completes, `isAuthorFiltered(did)` returns correct results for known muted/blocked DIDs
  - Observe: a fetch that completes before unmount still updates state correctly
  - Observe: two sequential (non-concurrent) calls to `xrpcGet` with the same URL each get a fresh response
  - Write property-based tests capturing these observed behaviors (e.g. `src/__tests__/preservation.test.ts`):
    1. Generate random valid OAuth session states; assert `initAuth()` still resolves the profile after the fix
    2. Assert guest load renders public content without sign-in (no stored session)
    3. Generate random sets of DIDs; assert concurrent `refreshGraphPolicy()` produces the same `mutedDids`/`blockedDids`/`followingDids` as the sequential version
    4. Assert a fetch completing before unmount still updates state (abort is a no-op on settled promises)
    5. Assert two sequential identical `xrpcGet` calls each receive a response (deduplication is in-flight only)
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: All preservation tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Fix 1 — Auth timeout (`src/api/auth.ts`)

  - [x] 3.1 Wrap `client.init()` in `Promise.race()` with a 5-second timeout
    - In `initAuth()`, create `timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 5000))`
    - Replace `await client.init()` with `await Promise.race([client.init(), timeoutPromise])`
    - Timeout resolves `null` (not rejects) so the existing `catch` in `Layout.tsx` is not triggered
    - `authInitDone.value = true` is already set in `Layout.tsx`'s `.finally()` — no change needed there
    - _Bug_Condition: isBugCondition(input) where input.clientInitDurationMs > 5000 AND NOT input.authInitDone_
    - _Expected_Behavior: authInitDone becomes true within 5 s; app continues as guest on timeout_
    - _Preservation: fast-path session restore (clientInitDurationMs ≤ 5000) is unaffected_
    - _Requirements: 2.1, 3.1_

- [x] 4. Fix 2 — Loading skeleton (`src/components/Layout.tsx`)

  - [x] 4.1 Show `AppLoadingSkeleton` while `authInitDone` is false and session restore is pending
    - Add an `AppLoadingSkeleton` component (inline or extracted) that renders a centred spinner with `aria-label="Loading…"`, reusing existing CSS skeleton classes
    - In `Layout`, add: `if (!authInitDone.value && mayHaveRestorableSession()) return <AppLoadingSkeleton />`
    - Place this guard before the main layout JSX return
    - _Bug_Condition: NOT authInitDone AND noSkeletonShown_
    - _Expected_Behavior: skeleton visible within 100 ms of mount during auth init_
    - _Preservation: when authInitDone is true or no restorable session, layout renders normally_
    - _Requirements: 2.2, 3.2_

- [x] 5. Fix 3 — Concurrent graph policy + non-blocking (`src/lib/graph-policy.ts`, `src/components/Layout.tsx`)

  - [x] 5.1 Refactor `refreshGraphPolicy()` to use `Promise.all()` for concurrent fetches
    - Extract the mutes `do…while` loop into a `fetchAllMutes()` helper returning `Promise<Set<string>>`
    - Extract the blocks `do…while` loop into a `fetchAllBlocks()` helper returning `Promise<Set<string>>`
    - Extract the follows `do…while` loop into a `fetchAllFollows(selfDid)` helper returning `Promise<Set<string>>`
    - Replace the three sequential loops with `const [m, b, f] = await Promise.all([fetchAllMutes(), fetchAllBlocks(), fetchAllFollows(self)])`
    - Assign results to `mutedDids.value`, `blockedDids.value`, `followingDids.value`
    - _Bug_Condition: graphPolicyFetchStrategy = 'sequential'_
    - _Expected_Behavior: all three lists fetched concurrently; total time ≈ max(individual times) not sum_
    - _Preservation: mutedDids/blockedDids/followingDids contain the same DIDs as before_
    - _Requirements: 2.3, 3.5_

  - [x] 5.2 Fire `refreshGraphPolicy()` as non-blocking in `Layout.tsx`
    - Change `await refreshGraphPolicy()` to `void refreshGraphPolicy()` in the `.then()` handler
    - Move `authInitDone.value = true` to execute immediately after firing graph policy (not after it resolves)
    - Ensure `clearGraphPolicy()` in the else/catch branches is unchanged
    - _Bug_Condition: graphPolicyFetchStrategy = 'sequential' (also blocks authInitDone)_
    - _Expected_Behavior: feed renders immediately after auth; graph policy signals update when ready_
    - _Preservation: graph policy data still loads and filters correctly once resolved_
    - _Requirements: 2.3, 3.5_

- [x] 6. Fix 4 — AbortController in load-path components

  - [x] 6.1 Add optional `signal?` parameter to `xrpcGet` and `xrpcSessionGet` in `src/api/xrpc.ts`
    - Add `signal?: AbortSignal` as a third parameter to `xrpcGet(nsid, params, signal?)`
    - Forward `signal` to the `fetch()` call: `fetch(urlStr, { headers: ..., cache: 'no-store', signal })`
    - Add `signal?: AbortSignal` as a third parameter to `xrpcSessionGet(nsid, params, signal?)`
    - Forward `signal` to `oauthSession.fetchHandler(path, { method: 'GET', headers: ..., signal })`
    - _Bug_Condition: NOT fetchHasAbortController_
    - _Expected_Behavior: passing an aborted signal causes fetch to throw AbortError immediately_
    - _Preservation: callers that omit signal continue to work exactly as before_
    - _Requirements: 2.4, 3.6_

  - [x] 6.2 Replace `cancelled` flag with `AbortController` in `src/pages/Home.tsx`
    - In the community previews `useEffect`, replace `let cancelled = false` with `const controller = new AbortController()`
    - Pass `controller.signal` to any `xrpcGet`/`xrpcSessionGet` calls (via `swr` or direct)
    - Change cleanup from `cancelled = true` to `controller.abort()`
    - Repeat for the following-feed preview `useEffect`
    - _Requirements: 2.4, 3.6_

  - [x] 6.3 Replace `cancelled` flag with `AbortController` in `src/pages/Community.tsx`
    - In the main feed load `useEffect`, replace `let cancelled = false` with `const controller = new AbortController()`
    - Pass `controller.signal` through to `searchByTag`, `getTimeline`, and any other fetch calls in the load path
    - Change cleanup from `cancelled = true` to `controller.abort()`
    - _Requirements: 2.4, 3.6_

  - [x] 6.4 Replace `cancelled` flag with `AbortController` in `src/pages/Activity.tsx`
    - In the notifications `useEffect`, replace `let cancelled = false` with `const controller = new AbortController()`
    - Pass `controller.signal` to `listNotifications` and `getPosts` calls
    - Change cleanup from `cancelled = true` to `controller.abort()`
    - _Requirements: 2.4, 3.6_

- [~] 7. Fix 5 — Surface load-path errors

  - [ ] 7.1 Add persistent error panel with retry in `src/components/Layout.tsx`
    - Add `const [authError, setAuthError] = useState<string | null>(null)` state
    - In the `initAuth()` `.catch()` handler, call `setAuthError(err.message || 'Failed to initialise. Please retry.')`
    - Add an `ErrorPanel` component (inline or extracted) that renders the error message and a "Retry" button calling `window.location.reload()`
    - Render `<ErrorPanel>` when `authError` is non-null, before the skeleton/layout guards
    - _Bug_Condition: NOT loadPathErrorsVisible_
    - _Expected_Behavior: persistent error message with retry button visible when auth init throws_
    - _Preservation: normal auth init (no throw) renders layout as before_
    - _Requirements: 2.5, 3.3_

  - [~] 7.2 Extend error UI in `src/pages/Community.tsx`
    - The existing `error` state and `setError` calls are already present
    - Add a persistent retry button to the error render path (not just `showToast`)
    - Render an inline error panel with the error message and a "Retry" button that re-triggers the load effect (e.g. increment a `retryCount` state dep)
    - _Requirements: 2.5_

  - [~] 7.3 Extend error UI in `src/pages/Activity.tsx`
    - The existing `showToast` on error is present but not persistent
    - Add an `error` state; set it in the catch block alongside `showToast`
    - Render an inline error panel with the error message and a "Retry" button when `error` is non-null
    - _Requirements: 2.5_

- [~] 8. Fix 6 — Offline detection (`src/lib/store.ts`, `src/api/xrpc.ts`)

  - [~] 8.1 Add `isOnline` signal to `src/lib/store.ts`
    - Add `export const isOnline = signal(typeof navigator !== 'undefined' ? navigator.onLine : true)`
    - Register `window.addEventListener('online', () => { isOnline.value = true })` and `window.addEventListener('offline', () => { isOnline.value = false })` at module level (guarded by `typeof window !== 'undefined'`)
    - _Bug_Condition: NOT offlineCheckedBeforeRequest_
    - _Expected_Behavior: isOnline reflects navigator.onLine and updates on network events_
    - _Preservation: OfflineBanner continues to use its own local state; no double-listener conflict_
    - _Requirements: 2.6, 3.4_

  - [~] 8.2 Check `isOnline` at the top of `xrpcGet` and `xrpcSessionGet` in `src/api/xrpc.ts`
    - Import `isOnline` from `@/lib/store`
    - At the top of `xrpcGet`, before the retry loop: `if (!isOnline.value) throw new XRPCError(0, 'Offline', 'You are offline. Please check your connection.')`
    - Apply the same guard at the top of `xrpcSessionGet`
    - _Expected_Behavior: offline throws immediately without calling fetch; no 16 s retry cycle_
    - _Requirements: 2.6, 3.4_

- [~] 9. Fix 7 — Request deduplication (`src/api/xrpc.ts`)

  - [~] 9.1 Add in-flight `Map` to `xrpcGet` for concurrent request deduplication
    - Add `const inFlight = new Map<string, Promise<unknown>>()` at module scope in `xrpc.ts`
    - At the start of `xrpcGet`, build the full URL string `key`
    - If `inFlight.has(key)`, return `inFlight.get(key) as Promise<T>`
    - Otherwise, create the fetch promise, call `inFlight.set(key, promise)`, attach `.finally(() => inFlight.delete(key))`, and return it
    - Deduplication applies only to `xrpcGet` (unauthenticated); `xrpcSessionGet` is out of scope
    - _Bug_Condition: NOT requestDeduplicationEnabled_
    - _Expected_Behavior: concurrent identical GET calls share one fetch; fetch called exactly once per unique in-flight URL_
    - _Preservation: sequential (non-concurrent) identical calls each get a fresh fetch after the first settles_
    - _Requirements: 2.7, 3.7_

- [~] 10. Verify bug condition exploration tests now pass

  - [~] 10.1 Re-run the exploration tests from task 1 against fixed code
    - **Property 1: Expected Behavior** - Seven Initial Load Defects Resolved
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior; passing them confirms the fixes work
    - **EXPECTED OUTCOME**: All seven sub-tests PASS (confirms all bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [~] 10.2 Re-run preservation tests from task 2 against fixed code
    - **Property 2: Preservation** - Existing Load-Path Behaviour Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - **EXPECTED OUTCOME**: All preservation tests still PASS (confirms no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [~] 11. Checkpoint — Ensure all tests pass
  - Run the full test suite; confirm zero failures
  - Verify no TypeScript diagnostics errors in changed files (`src/api/auth.ts`, `src/api/xrpc.ts`, `src/lib/graph-policy.ts`, `src/lib/store.ts`, `src/components/Layout.tsx`, `src/pages/Home.tsx`, `src/pages/Community.tsx`, `src/pages/Activity.tsx`)
  - Ask the user if any questions arise before closing the spec
