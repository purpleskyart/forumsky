/**
 * Skeleton screen for thread loading - shows placeholder UI while content loads
 */

export function ThreadSkeleton() {
  return (
    <div class="thread-skeleton">
      <div class="thread-skeleton-header">
        <div class="skeleton-avatar" />
        <div class="skeleton-header-text">
          <div class="skeleton-title" />
          <div class="skeleton-subtitle" />
        </div>
      </div>
      <div class="thread-skeleton-content">
        <div class="skeleton-line" />
        <div class="skeleton-line" />
        <div class="skeleton-line skeleton-line--short" />
      </div>
      <div class="thread-skeleton-actions">
        <div class="skeleton-action" />
        <div class="skeleton-action" />
        <div class="skeleton-action" />
      </div>
    </div>
  );
}
