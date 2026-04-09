export interface AvatarFollowPlus {
  busy?: boolean;
  onFollow: () => void | Promise<void>;
  /** Tooltip + context for screen readers */
  title?: string;
}

interface AvatarProps {
  src?: string;
  alt?: string;
  size?: number;
  /** Extra class on the root element (`.avatar` or `.avatar-wrap`) */
  className?: string;
  followPlus?: AvatarFollowPlus | null;
}

export function Avatar({ src, alt = '', size = 80, className = '', followPlus }: AvatarProps) {
  const rootClass = className.trim();
  /** Sizing is CSS-driven from the wrap (--avatar-size) so layouts (e.g. thread sidebar 88px) can override without losing to inline styles. */
  const wrapStyle = { ['--avatar-size']: `${size}px` } as Record<string, string>;
  const avatarInner = (
    <div class="avatar">
      {src ? (
        <img src={src} alt={alt} width={size} height={size} />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'var(--bg-elevated)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: size * 0.4,
            color: 'var(--text-muted)',
            borderRadius: '50%',
          }}
        >
          {alt ? alt.charAt(0).toUpperCase() : '?'}
        </div>
      )}
    </div>
  );

  const label = followPlus?.title ?? (alt ? `Follow ${alt}` : 'Follow');
  return (
    <div class={`avatar-wrap${rootClass ? ` ${rootClass}` : ''}`} style={wrapStyle}>
      {avatarInner}
      {followPlus ? (
        <button
          type="button"
          class="avatar-follow-plus"
          title={label}
          aria-label={label}
          disabled={followPlus.busy}
          onClick={(e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            void followPlus.onFollow();
          }}
        >
          +
        </button>
      ) : null}
    </div>
  );
}
