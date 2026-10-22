'use client';

export interface FieldDef {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'YESNO' | 'CHOICE';
  options: string[];
  required: boolean;
  active: boolean;
}

/** The right input for each kind of custom field. */
export function FieldInput({ id, f, value, disabled, onChange }: { id: string; f: FieldDef; value: string; disabled?: boolean; onChange: (v: string) => void }) {
  if (f.type === 'CHOICE')
    return (
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  if (f.type === 'YESNO')
    return (
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  return <input id={id} type={f.type === 'DATE' ? 'date' : 'text'} inputMode={f.type === 'NUMBER' ? 'decimal' : undefined} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}
