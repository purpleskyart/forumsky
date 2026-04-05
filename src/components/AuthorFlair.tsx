import type { Label, ProfileView } from '@/api/types';

/** Bluesky system label; not useful as a user-facing badge. */
function isHiddenLabelVal(val: string): boolean {
  const core = val.replace(/^[!]+/, '').toLowerCase();
  return core === 'no-unauthenticated';
}

function humanizeLabelVal(val: string): string {
  const v = val.replace(/^[!]+/, '').replace(/-/g, ' ');
  return v.length > 0 ? v : val;
}

export function AuthorFlair({
  profile,
  postLabels,
}: {
  profile: ProfileView;
  postLabels?: Label[];
}) {
  const fromAuthor = profile.labels ?? [];
  const fromPost = postLabels ?? [];
  const seen = new Set<string>();
  const badges: { key: string; text: string; title?: string }[] = [];
  for (const L of [...fromAuthor, ...fromPost]) {
    const val = L.val;
    if (!val || seen.has(val) || isHiddenLabelVal(val)) continue;
    seen.add(val);
    badges.push({
      key: val,
      text: humanizeLabelVal(val),
      title: L.src ? `Label: ${val}` : undefined,
    });
  }

  if (badges.length === 0) return null;

  return (
    <span class="author-flair-row">
      {badges.map(b => (
        <span key={b.key} class="author-flair author-flair--label" title={b.title}>
          {b.text}
        </span>
      ))}
    </span>
  );
}
