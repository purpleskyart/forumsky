import { toastMessage } from '@/lib/store';

export function Toast() {
  if (!toastMessage.value) return null;
  return <div class="toast">{toastMessage.value}</div>;
}
