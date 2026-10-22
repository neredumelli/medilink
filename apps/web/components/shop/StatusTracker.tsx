import { TRACKER_STEPS } from '@medilink/core';
import { Icon, IconName } from '@/components/Icon';

const ICONS: IconName[] = ['check', 'check', 'note', 'truck', 'store'];
const LABELS = ['Placed', 'Accepted', 'Billed', 'On the way', 'Delivered'];

export function StatusTracker({ status }: { status: string }) {
  const k = TRACKER_STEPS.indexOf(status as (typeof TRACKER_STEPS)[number]);
  return (
    <>
      <div className="track" aria-label={`Status: ${LABELS[k] ?? status}`}>
        {TRACKER_STEPS.map((s, i) => (
          <span key={s} style={{ display: 'contents' }}>
            {i > 0 && <span className={`bar ${i <= k ? 'on' : ''}`} />}
            <span className={`st ${i <= k ? 'on' : ''} ${i === k ? 'now' : ''}`}>
              <Icon name={ICONS[i]!} />
            </span>
          </span>
        ))}
      </div>
      <div className="track-l">
        {LABELS.map((l, i) => (i === k ? <b key={l}>{l}</b> : <span key={l}>{l}</span>))}
      </div>
    </>
  );
}
