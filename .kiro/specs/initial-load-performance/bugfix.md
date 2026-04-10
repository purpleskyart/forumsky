# Bugfix Requirements Document

## Introduction

The app's initial load is slow and sometimes never completes. Seven distinct root causes contribute to this: the OAuth client's `client.init()` call has no timeout and can hang indefinitely on slow or corrupted IndexedDB; auth initialization blocks any meaningful render, leaving users on a blank page; the graph policy refresh (`refreshGraphPolicy`) makes three sequential paginated API calls that can take 5–16 seconds before the feed appears; fetch calls in the load path use a `cancelled` flag but never call `AbortController.abort()`, so stale requests pile up; all errors in the load path are silently swallowed with no user-visible feedback; the app makes no attempt to detect an offline state before firing network requests; and multiple components can independently trigger the same API calls with no deduplication. Together these issues cause the app to appear broken or extremely slow on first visit, especially on low-end devices or poor network conditions.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `client.init()` is called on a slow device or with a corrupted IndexedDB THEN the system hangs indefinitely with no timeout, preventing `authInitDone` from ever becoming `true` and leaving the app in a permanent loading state

1.2 WHEN auth initialization is in progress THEN the system renders a blank/empty page with no skeleton or progress indicator, giving users no visual feedback that anything is happening

1.3 WHEN a logged-in user's auth resolves and `refreshGraphPolicy()` is called THEN the system makes three separate sequential paginated API calls (mutes, blocks, follows), each with up to 4 retries and exponential backoff, blocking feed render for 5–16 seconds

1.4 WHEN a component in the load path is unmounted while fetches are in flight THEN the system does not abort the underlying HTTP requests (only sets a `cancelled` flag), causing requests to pile up and potentially trigger state updates on unmounted components

1.5 WHEN any error occurs during the load path (auth init, graph policy refresh, feed fetch) THEN the system silently catches the error and shows a blank page with no error message or retry option

1.6 WHEN the device is offline and the app loads THEN the system attempts all network requests anyway, failing only after the full retry cycle (~16 seconds per request) before surfacing any failure

1.7 WHEN multiple components mount simultaneously or a component re-mounts THEN the system issues duplicate API calls for the same data with no deduplication, wasting bandwidth and increasing load time

### Expected Behavior (Correct)

2.1 WHEN `client.init()` is called THEN the system SHALL enforce a maximum timeout (e.g. 5 seconds), resolve with `null` on timeout, set `authInitDone` to `true`, and allow the app to continue loading as a guest rather than hanging

2.2 WHEN auth initialization is in progress THEN the system SHALL display a loading skeleton or progress indicator so users receive immediate visual feedback that the app is loading

2.3 WHEN `refreshGraphPolicy()` is called after auth THEN the system SHALL fetch mutes, blocks, and follows concurrently (in parallel) rather than sequentially, and SHALL NOT block the initial feed render — the feed SHALL render with whatever graph data is available

2.4 WHEN a component in the load path unmounts while fetches are in flight THEN the system SHALL call `AbortController.abort()` on all in-flight requests so that underlying HTTP connections are cancelled and no state updates occur on unmounted components

2.5 WHEN an error occurs during the load path THEN the system SHALL display a user-visible error message and provide a retry action so users can recover without a full page reload

2.6 WHEN the device is offline at load time THEN the system SHALL detect the offline state immediately (via `navigator.onLine` or the `offline` event) and SHALL display an offline indicator without waiting for the full retry cycle to exhaust

2.7 WHEN the same API call is triggered by multiple components simultaneously THEN the system SHALL deduplicate in-flight requests so that only one HTTP request is made and all callers share the same response

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user with a valid, restorable OAuth session loads the app on a fast device with healthy IndexedDB THEN the system SHALL CONTINUE TO restore the session and render the authenticated feed without requiring re-login

3.2 WHEN a guest (unauthenticated) user loads the app THEN the system SHALL CONTINUE TO display public community feeds and content without requiring sign-in

3.3 WHEN a user successfully signs in via OAuth THEN the system SHALL CONTINUE TO complete the OAuth flow, store the session, and navigate to the authenticated home feed

3.4 WHEN the device comes back online after being offline THEN the system SHALL CONTINUE TO resume normal network operations and refresh content

3.5 WHEN graph policy data (mutes, blocks, follows) is loaded THEN the system SHALL CONTINUE TO correctly filter muted and blocked authors from feed content

3.6 WHEN a component unmounts normally (e.g. user navigates away) THEN the system SHALL CONTINUE TO cancel pending fetches and avoid state updates, consistent with the existing `cancelled` flag pattern

3.7 WHEN the app is used on a fast device with a healthy network THEN the system SHALL CONTINUE TO load and render the feed at the same speed or faster than before the fix
