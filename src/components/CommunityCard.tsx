import { hrefForAppPath } from '@/lib/app-base-path';
import { communityUrl } from '@/lib/router';
import type { CommunityConfig } from '@/lib/preferences';

interface CommunityCardProps {
  community: CommunityConfig;
  lastPost?: { title: string; author: string; date: string } | null;
  onClick?: (e: Event) => void;
}

export function CommunityCard({ community, lastPost, onClick }: CommunityCardProps) {
  return (
    <div class="community-row">
      <div class="community-icon">&hearts;</div>
      <div class="community-info">
        <div class="community-name">
          <a href={hrefForAppPath(communityUrl(community.tag))} onClick={onClick}>{community.name}</a>
        </div>
        <div class="community-desc">{community.description}</div>
      </div>
      <div class="community-last-post">
        {lastPost ? (
          <>
            <div class="lp-title">{lastPost.title}</div>
            <div class="lp-date">{formatDate(lastPost.date)}</div>
            <div class="lp-meta">by {lastPost.author}</div>
          </>
        ) : (
          <span class="lp-meta" style="color:var(--text-muted)">No recent posts</span>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
