import { useState, useCallback } from 'preact/hooks';
import { h } from 'preact';
import type { ThreadgateRule, ThreadgateRecord } from '@/api/types';
import { createThreadgate, updateThreadgate, deleteThreadgate, getThreadgate } from '@/api/post';
import { getCurrentDid } from '@/api/auth';
import { showToast } from '@/lib/store';

interface ThreadgateButtonProps {
  postUri: string;
  postAuthorDid: string;
  initialGate?: ThreadgateRecord | null;
  onUpdate?: (gate: ThreadgateRecord | null) => void;
  disabled?: boolean;
}

type ThreadgateOption = 'everyone' | 'nobody' | 'following' | 'mentioned';

const OPTION_ICONS: Record<ThreadgateOption, string> = {
  everyone: '🌐',
  nobody: '🔒',
  following: '👥',
  mentioned: '@️',
};

const OPTION_LABELS: Record<ThreadgateOption, string> = {
  everyone: 'Everyone can reply',
  nobody: 'No one can reply',
  following: 'Only followers',
  mentioned: 'Only mentioned users',
};

function getOptionFromRules(rules?: ThreadgateRule[]): ThreadgateOption {
  if (!rules || rules.length === 0) return 'everyone';
  if (rules.length === 1) {
    const rule = rules[0];
    if (rule.$type === 'app.bsky.feed.threadgate#followingRule') return 'following';
    if (rule.$type === 'app.bsky.feed.threadgate#mentionRule') return 'mentioned';
  }
  return 'nobody';
}

function getRulesFromOption(option: ThreadgateOption): ThreadgateRule[] | undefined {
  switch (option) {
    case 'everyone':
      return undefined;
    case 'nobody':
      return [];
    case 'following':
      return [{ $type: 'app.bsky.feed.threadgate#followingRule' }];
    case 'mentioned':
      return [{ $type: 'app.bsky.feed.threadgate#mentionRule' }];
  }
}

export function ThreadgateButton({
  postUri,
  postAuthorDid,
  initialGate,
  onUpdate,
  disabled,
}: ThreadgateButtonProps) {
  const [currentOption, setCurrentOption] = useState<ThreadgateOption>(
    getOptionFromRules(initialGate?.allow),
  );
  const [showMenu, setShowMenu] = useState(false);
  const [loading, setLoading] = useState(false);

  const viewerDid = getCurrentDid();
  const isOwner = viewerDid === postAuthorDid;

  const handleSelect = useCallback(
    async (option: ThreadgateOption) => {
      if (!isOwner || disabled || loading) return;

      setLoading(true);
      setShowMenu(false);

      try {
        const rules = getRulesFromOption(option);

        if (option === 'everyone') {
          // Delete threadgate if exists
          if (initialGate) {
            const gateUri = `at://${postAuthorDid}/app.bsky.feed.threadgate/${postUri.split('/').pop()}`;
            await deleteThreadgate(postAuthorDid, gateUri);
          }
          setCurrentOption('everyone');
          onUpdate?.(null);
          showToast('Reply settings updated');
        } else {
          // Create or update threadgate
          if (initialGate) {
            const gateUri = `at://${postAuthorDid}/app.bsky.feed.threadgate/${postUri.split('/').pop()}`;
            await updateThreadgate(postAuthorDid, gateUri, rules ?? []);
          } else {
            await createThreadgate(postAuthorDid, postUri, rules ?? []);
          }
          const newGate = await getThreadgate(postAuthorDid, postUri);
          setCurrentOption(option);
          onUpdate?.(newGate);
          showToast('Reply settings updated');
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to update reply settings');
      } finally {
        setLoading(false);
      }
    },
    [isOwner, disabled, loading, postUri, postAuthorDid, initialGate, onUpdate],
  );

  // Non-owner: show read-only indicator
  if (!isOwner) {
    return (
      <span class="threadgate-indicator" title={OPTION_LABELS[currentOption]}>
        {OPTION_ICONS[currentOption]}
      </span>
    );
  }

  return (
    <div class="threadgate-dropdown">
      <button
        type="button"
        class={`threadgate-btn ${loading ? 'threadgate-btn--loading' : ''}`}
        onClick={() => !loading && setShowMenu(!showMenu)}
        disabled={disabled || loading}
        title="Reply settings"
        aria-haspopup="true"
        aria-expanded={showMenu}
      >
        <span class="threadgate-icon">{OPTION_ICONS[currentOption]}</span>
        <span class="threadgate-label">{OPTION_LABELS[currentOption]}</span>
        <span class="threadgate-chevron">▼</span>
      </button>

      {showMenu && (
        <div class="threadgate-menu" role="menu">
          {(Object.keys(OPTION_LABELS) as ThreadgateOption[]).map((option) => (
            <button
              key={option}
              type="button"
              class={`threadgate-option ${option === currentOption ? 'threadgate-option--active' : ''}`}
              onClick={() => handleSelect(option)}
              role="menuitem"
            >
              <span class="threadgate-option-icon">{OPTION_ICONS[option]}</span>
              <span class="threadgate-option-label">{OPTION_LABELS[option]}</span>
              {option === currentOption && <span class="threadgate-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
