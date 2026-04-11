import { useState, useCallback, useEffect } from 'preact/hooks';
import { h } from 'preact';
import type { ListView, ListPurpose, ListItemView } from '@/api/types';
import {
  getLists,
  createList,
  deleteList,
  getList,
  addUserToList,
  removeUserFromList,
} from '@/api/lists';
import { getCurrentDid } from '@/api/auth';
import { showToast } from '@/lib/store';
import { Avatar } from './Avatar';

interface ListsManagerProps {
  did: string; // Owner of the lists (usually current user)
  onSelectList?: (list: ListView) => void;
}

export function ListsManager({ did, onSelectList }: ListsManagerProps) {
  const [lists, setLists] = useState<ListView[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDescription, setNewListDescription] = useState('');
  const [newListPurpose, setNewListPurpose] = useState<ListPurpose>('app.bsky.graph.defs#curatelist');
  const [creating, setCreating] = useState(false);
  const [expandedList, setExpandedList] = useState<string | null>(null);
  const [listMembers, setListMembers] = useState<Map<string, ListItemView[]>>(new Map());
  const [addHandle, setAddHandle] = useState('');

  const viewerDid = getCurrentDid();
  const isOwner = viewerDid === did;

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const userLists = await getLists(did);
      setLists(userLists);
    } catch (err) {
      showToast('Failed to load lists');
    } finally {
      setLoading(false);
    }
  }, [did]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const handleCreate = useCallback(async () => {
    if (!newListName.trim() || !isOwner) return;

    setCreating(true);
    try {
      await createList(did, {
        name: newListName.trim(),
        description: newListDescription.trim() || undefined,
        purpose: newListPurpose,
      });
      showToast('List created');
      setShowCreateModal(false);
      setNewListName('');
      setNewListDescription('');
      await loadLists();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create list');
    } finally {
      setCreating(false);
    }
  }, [did, isOwner, newListName, newListDescription, newListPurpose, loadLists]);

  const handleDelete = useCallback(
    async (list: ListView) => {
      if (!isOwner || !confirm(`Delete "${list.name}"?`)) return;

      try {
        await deleteList(did, list.uri);
        showToast('List deleted');
        await loadLists();
      } catch (err) {
        showToast('Failed to delete list');
      }
    },
    [did, isOwner, loadLists],
  );

  const handleExpand = useCallback(
    async (list: ListView) => {
      if (expandedList === list.uri) {
        setExpandedList(null);
        return;
      }

      setExpandedList(list.uri);
      const existing = listMembers.get(list.uri);
      if (!existing) {
        try {
          const { items } = await getList(list.uri, { limit: 100 });
          setListMembers((prev) => new Map(prev).set(list.uri, items));
        } catch {
          showToast('Failed to load list members');
        }
      }
    },
    [expandedList, listMembers],
  );

  const handleRemoveMember = useCallback(
    async (listUri: string, memberUri: string) => {
      if (!isOwner) return;
      try {
        await removeUserFromList(did, memberUri);
        showToast('Removed from list');
        // Refresh
        const { items } = await getList(listUri, { limit: 100 });
        setListMembers((prev) => new Map(prev).set(listUri, items));
      } catch {
        showToast('Failed to remove member');
      }
    },
    [did, isOwner],
  );

  return (
    <div class="lists-manager">
      <div class="lists-header">
        <h3>Lists</h3>
        {isOwner && (
          <button
            type="button"
            class="btn btn-primary btn-sm"
            onClick={() => setShowCreateModal(true)}
          >
            + New List
          </button>
        )}
      </div>

      {loading ? (
        <div class="lists-loading">
          <div class="spinner" />
          <span>Loading lists…</span>
        </div>
      ) : lists.length === 0 ? (
        <div class="lists-empty">
          <p>No lists yet.</p>
          {isOwner && <p>Create a list to curate users or for moderation.</p>}
        </div>
      ) : (
        <ul class="lists-list">
          {lists.map((list) => {
            const isExpanded = expandedList === list.uri;
            const members = listMembers.get(list.uri) ?? [];

            return (
              <li key={list.uri} class="list-item">
                <div
                  class="list-summary"
                  onClick={() => onSelectList?.(list)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectList?.(list);
                    }
                  }}
                >
                  {list.avatar && (
                    <Avatar src={list.avatar} alt="" size={32} className="list-avatar" />
                  )}
                  <div class="list-info">
                    <span class="list-name">{list.name}</span>
                    {list.description && (
                      <span class="list-description">{list.description}</span>
                    )}
                    <span class="list-meta">
                      {list.purpose === 'app.bsky.graph.defs#modlist' ? 'Moderation' : 'Curation'} •{' '}
                      {list.indexedAt && new Date(list.indexedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div class="list-actions">
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost"
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        handleExpand(list);
                      }}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? '▲' : '▼'} {members.length} members
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        class="btn btn-sm btn-danger"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation();
                          handleDelete(list);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div class="list-members">
                    {isOwner && (
                      <div class="list-add-member">
                        <input
                          type="text"
                          placeholder="@handle to add"
                          value={addHandle}
                          onChange={(e) => setAddHandle((e.target as HTMLInputElement).value)}
                        />
                        <button
                          type="button"
                          class="btn btn-sm btn-primary"
                          onClick={async () => {
                            if (!addHandle.trim()) return;
                            // Would need to resolve handle to DID first
                            showToast('Handle resolution not implemented');
                          }}
                        >
                          Add
                        </button>
                      </div>
                    )}
                    {members.length === 0 ? (
                      <p class="list-no-members">No members yet.</p>
                    ) : (
                      <ul class="members-list">
                        {members.map((member) => (
                          <li key={member.uri} class="member-item">
                            <Avatar
                              src={member.subject.avatar}
                              alt=""
                              size={24}
                              className="member-avatar"
                            />
                            <span class="member-handle">@{member.subject.handle}</span>
                            {isOwner && (
                              <button
                                type="button"
                                class="btn btn-xs btn-ghost"
                                onClick={() => handleRemoveMember(list.uri, member.uri)}
                              >
                                Remove
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showCreateModal && (
        <div class="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <h4>Create New List</h4>
            <div class="form-group">
              <label>Name</label>
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName((e.target as HTMLInputElement).value)}
                placeholder="My List"
                maxLength={64}
              />
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea
                value={newListDescription}
                onChange={(e) => setNewListDescription((e.target as HTMLTextAreaElement).value)}
                placeholder="What is this list for?"
                maxLength={300}
                rows={2}
              />
            </div>
            <div class="form-group">
              <label>Purpose</label>
              <select
                value={newListPurpose}
                onChange={(e) =>
                  setNewListPurpose((e.target as HTMLSelectElement).value as ListPurpose)
                }
              >
                <option value="app.bsky.graph.defs#curatelist">Curation (feed source)</option>
                <option value="app.bsky.graph.defs#modlist">Moderation (block/mute)</option>
              </select>
            </div>
            <div class="modal-actions">
              <button
                type="button"
                class="btn btn-secondary"
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-primary"
                onClick={handleCreate}
                disabled={!newListName.trim() || creating}
              >
                {creating ? 'Creating…' : 'Create List'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
