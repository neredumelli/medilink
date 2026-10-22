'use client';

import { LANGS, Lang } from '@medilink/core';
import { useSession } from '@/lib/session';

const LANG_SHORT: Record<Lang, string> = { en: 'EN', te: 'తె', hi: 'हि' };

export function LangSwitch() {
  const { lang, setLang } = useSession();
  return (
    <div className="seg" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
          {LANG_SHORT[l]}
        </button>
      ))}
    </div>
  );
}
