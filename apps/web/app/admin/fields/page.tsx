'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, peek } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/Icon';
import { ConsoleShell } from '@/components/ConsoleShell';
import { AdminTabs } from '@/components/AdminTabs';
import { FieldDef } from '@/components/admin/FieldInput';

type Entity = 'PRODUCT' | 'RETAILER' | 'DISTRIBUTOR';
const ENTITIES: { key: Entity; label: string; hint: string }[] = [
  { key: 'PRODUCT', label: 'Medicines', hint: 'e.g. Storage, Cold chain, Pack weight' },
  { key: 'RETAILER', label: 'Shops', hint: 'e.g. Weekly holiday, Shop type, Second phone' },
  { key: 'DISTRIBUTOR', label: 'Distributors', hint: 'e.g. Same-day cut-off, Minimum order' },
];
const TYPES: { key: FieldDef['type']; label: string }[] = [
  { key: 'TEXT', label: 'Text' },
  { key: 'NUMBER', label: 'Number' },
  { key: 'DATE', label: 'Date' },
  { key: 'YESNO', label: 'Yes / No' },
  { key: 'CHOICE', label: 'Pick from a list' },
];
const typeLabel = (t: string) => TYPES.find((x) => x.key === t)?.label ?? t;

/** Admins add fields to medicines, shops and distributors without any code change or app update. */
export default function FieldsPage() {
  const { me, toast } = useSession();
  const canEdit = me?.role === 'SUPER_ADMIN' || me?.role === 'ADMIN_OPS';
  const [entity, setEntity] = useState<Entity>('PRODUCT');
  const [rows, setRows] = useState<FieldDef[] | null>(() => peek<FieldDef[]>('/admin/fields?entity=PRODUCT') ?? null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<FieldDef['type']>('TEXT');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);

  const load = useCallback(async () => setRows(await api<FieldDef[]>(`/admin/fields?entity=${entity}`)), [entity]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast(done);
      await load();
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save');
      return false;
    }
  }

  const opts = options
    .split(/[,\n]/)
    .map((o) => o.trim())
    .filter(Boolean);
  const current = ENTITIES.find((e) => e.key === entity)!;

  return (
    <ConsoleShell allow={(r) => ['SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT'].includes(r)} eyebrow="Super admin" title="Data fields" subtitle="Add your own fields to medicines, shops and distributors. No code change needed." right={<AdminTabs />}>
      <div className="seg" role="group" aria-label="Field belongs to" style={{ alignSelf: 'flex-start' }}>
        {ENTITIES.map((e) => (
          <button key={e.key} aria-pressed={entity === e.key} onClick={() => setEntity(e.key)}>
            {e.label}
          </button>
        ))}
      </div>

      <div className="cols">
        <section className="panel">
          <h2>{current.label}: fields</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Kind</th>
                  <th>Required</th>
                  <th>In use</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((f) => (
                  <tr key={f.id} className={f.active ? undefined : 'off'}>
                    <td>
                      <b>{f.label}</b>
                      <div className="hint mono">{f.key}</div>
                    </td>
                    <td>
                      {typeLabel(f.type)}
                      {f.type === 'CHOICE' && <div className="hint">{f.options.join(' · ')}</div>}
                    </td>
                    <td>
                      <label className="row" style={{ gap: 6 }}>
                        <input type="checkbox" checked={f.required} disabled={!canEdit} onChange={(e) => run(() => api(`/admin/fields/${f.id}`, { method: 'PATCH', body: { required: e.target.checked } }), `${f.label}: ${e.target.checked ? 'required' : 'optional'}`)} />
                        <span className="sr">{f.label} required</span>
                        {f.required ? 'Yes' : 'No'}
                      </label>
                    </td>
                    <td>
                      {canEdit ? (
                        <button className={`btn small ${f.active ? '' : 'primary'}`} onClick={() => run(() => api(`/admin/fields/${f.id}`, { method: 'PATCH', body: { active: !f.active } }), f.active ? `${f.label} is hidden (values are kept)` : `${f.label} is back`)}>
                          {f.active ? 'Hide' : 'Show again'}
                        </button>
                      ) : f.active ? (
                        'Yes'
                      ) : (
                        'Hidden'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows && rows.length === 0 && <p className="hint">No fields yet for {current.label.toLowerCase()}.</p>}
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Hiding a field never deletes the values already filled in. Every change is kept in the change history.
          </p>
        </section>

        {canEdit && (
          <section className="panel">
            <h2>
              <Icon name="tag" /> Add a field
            </h2>
            <form
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await run(() => api('/admin/fields', { body: { entity, label, type, options: type === 'CHOICE' ? opts : undefined, required } }), `Added “${label.trim()}” to ${current.label.toLowerCase()}`);
                if (ok) {
                  setLabel('');
                  setOptions('');
                  setRequired(false);
                }
              }}
            >
              <div className="field">
                <label htmlFor="fl">Name of the field</label>
                <input id="fl" value={label} maxLength={60} placeholder={current.hint} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ft">Kind of answer</label>
                <select id="ft" value={type} onChange={(e) => setType(e.target.value as FieldDef['type'])}>
                  {TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {type === 'CHOICE' && (
                <div className="field">
                  <label htmlFor="fo">Choices (separate with commas)</label>
                  <input id="fo" value={options} placeholder="Room temperature, Fridge (2–8 °C)" onChange={(e) => setOptions(e.target.value)} />
                  {opts.length > 0 && (
                    <div className="docs" style={{ marginTop: 6 }}>
                      {opts.map((o) => (
                        <span key={o} className="pill c-sky">
                          {o}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Must be filled in
              </label>
              <button className="btn primary" type="submit" disabled={label.trim().length < 2 || (type === 'CHOICE' && opts.length === 0)}>
                Add field
              </button>
            </form>
          </section>
        )}
      </div>
    </ConsoleShell>
  );
}
