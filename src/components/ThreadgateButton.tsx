import { useState, useCallback } from 'preact/hooks';
import { h } from 'preact';
import type { ThreadgateRule, ThreadgateRecord } from '@/api/types';
import { createThreadgate, updateThreadgate, deleteThreadgate, getThreadgate } from '@/api/post';
import { getCurrentDid } from '@/api/auth';
import { showToast } from '@/lib/store';

interface ListOption {
  uri: string;
  name: string;
  creator: string;
}

interface ThreadgateButtonProps {
  postUri: string;
  postAuthorDid: string;
  initialGate?: ThreadgateRecord | null;
  onUpdate?: (gate: ThreadgateRecord | null) => void;
  disabled?: boolean;
  /** Available lists for the "Only list members" option */
  availableLists?: ListOption[];
}

type ThreadgateOption = 'everyone' | 'nobody' | 'following' | 'mentioned' | 'list';

const OPTION_ICONS: Record<ThreadgateOption, string> = {
  everyone: '🌐',
  nobody: '🔒',
  following: '👥',
  mentioned: '@️',
  list: '📋',
};

const OPTION_LABELS: Record<ThreadgateOption, string> = {
  everyone: 'Everyone can reply',
  nobody: 'No one can reply',
  following: 'Only followers',
  mentioned: 'Only mentioned users',
  list: 'Only list members',
};

function getOptionFromRules(rules?: ThreadgateRule[]): ThreadgateOption {
  if (!rules || rules.length === 0) return 'everyone';
  if (rules.length === 1) {
    const rule = rules[0];
    if (rule.$type === 'app.bsky.feed.threadgate#followingRule') return 'following';
    if (rule.$type === 'app.bsky.feed.threadgate#mentionRule') return 'mentioned';
    if (rule.$type === 'app.bsky.feed.threadgate#listRule') return 'list';
  }
  // Multiple rules or complex rules default to 'nobody' for UI simplicity
  return 'nobody';
}

function getRulesFromOption(option: ThreadgateOption, listUri?: string): ThreadgateRule[] | undefined {
  switch (option) {
    case 'everyone':
      return undefined;
    case 'nobody':
      return [];
    case 'following':
      return [{ $type: 'app.bsky.feed.threadgate#followingRule' }];
    case 'mentioned':
      return [{ $type: 'app.bsky.feed.threadgate#mentionRule' }];
    case 'list':
      if (listUri) {
        return [{ $type: 'app.bsky.feed.threadgate#listRule', list: listUri }];
      }
      return []; // Default to nobody if no list selected
  }
}

export function ThreadgateButton({
  postUri,
  postAuthorDid,
  initialGate,
  onUpdate,
  disabled,
  availableLists,
}: ThreadgateButtonProps) {
  const [currentOption, setCurrentOption] = useState<ThreadgateOption>(
    getOptionFromRules(initialGate?.allow),
  );
  const [selectedListUri, setSelectedListUri] = useState<string | undefined>(
    initialGate?.allow?.find(r => r.$type === 'app.bsky.feed.threadgate#listRule')?.list
  );
  const [showMenu, setShowMenu] = useState(false);
  const [showListSelector, setShowListSelector] = useState(false);
  const [loading, setLoading] = useState(false);

  const viewerDid = getCurrentDid();
  const isOwner = viewerDid === postAuthorDid;

  const handleSelect = useCallback(
    async (option: ThreadgateOption, listUri?: string) => {
      if (!isOwner || disabled || loading) return;

      // If selecting list option but no list provided and we have lists, show selector first
      if (option === 'list' && !listUri && availableLists && availableLists.length > 0) {
        setShowListSelector(true);
        setShowMenu(false);
        return;
      }

      setLoading(true);
      setShowMenu(false);
      setShowListSelector(false);

      try {
        const rules = getRulesFromOption(option, listUri);

        if (option === 'everyone') {
          // Delete threadgate if exists
          if (initialGate) {
            const gateUri = `at://${postAuthorDid}/app.bsky.feed.threadgate/${postUri.split('/').pop()}`;
            await deleteThreadgate(postAuthorDid, gateUri);
          }
          setCurrentOption('everyone');
          setSelectedListUri(undefined);
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
          if (listUri) setSelectedListUri(listUri);
          onUpdate?.(newGate);
          showToast('Reply settings updated');
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to update reply settings');
      } finally {
        setLoading(false);
      }
    },
    [isOwner, disabled, loading, postUri, postAuthorDid, initialGate, onUpdate, availableLists],
  );

  const handleListSelect = (listUri: string) => {
    handleSelect('list', listUri);
  };

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

      {showListSelector && availableLists && availableLists.length > 0 && (
        <div class="threadgate-list-selector">
          <div class="threadgate-list-header">
            <span>Select a list</span>
            <button
              type="button"
              class="threadgate-list-close"
              onClick={() => setShowListSelector(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div class="threadgate-list-options">
            {availableLists.map((list) => (
              <button
                key={list.uri}
                type="button"
                class={`threadgate-list-option ${list.uri === selectedListUri ? 'threadgate-list-option--active' : ''}`}
                onClick={() => handleListSelect(list.uri)}
              >
                <span class="threadgate-list-name">{list.name}</span>
                <span class="threadgate-list-creator">by {list.creator}</span>
                {list.uri === selectedListUri && <span class="threadgate-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
