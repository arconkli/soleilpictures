// HelpHub — the one screen that says what a cluster can hold and where the
// rest is written down. Opened by the topbar ? button, the sidebar foot, the
// ⌘K "Help" and "What can I add here?" commands, or a `soleil-open-help-hub`
// CustomEvent (the ShortcutsHost pattern, so the real App and the ?local=1 QA
// shell get it from a single mount).
//
// It is pull on purpose. The product-education pass found every surface that
// pushes feature knowledge at people to be null for return, and the people
// who use the most of Clusters found it themselves. Nothing here fires on its
// own, it sits outside the ambient ask budget (lib/upsellSlot.js), and it is
// graded on admin_feature_reach, never on return.
//
// Every docs link opens in a new tab: losing an unsaved canvas to a help link
// is a poor trade (the ⌘K Documentation command does the same).

import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal.jsx';
import { Icon } from './Icon.jsx';
import { Question } from '../lib/icons.js';
import { ADD_KINDS, HUB_ACTIONS, guideLinks } from '../lib/helpHub.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

const OPEN_EVENT = 'soleil-open-help-hub';

// Ask the host to open, naming the door it came through (help_open{via}).
export function openHelpHub(via = 'other') {
  try { document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { via } })); } catch (_) {}
}

// The topbar / sidebar trigger. `as`: 'tb' (topbar icon) | 'foot' (sidebar foot icon).
export function HelpButton({ as = 'tb', via = 'topbar' }) {
  const cls = as === 'foot' ? 'sb-foot-icon' : 'tb-icon';
  return (
    <button className={cls} title="Help" aria-label="Help" onClick={() => openHelpHub(via)}>
      <Icon as={Question} size={as === 'foot' ? 15 : 16} />
    </button>
  );
}

function openDocs(path, from) {
  logEvent(EV.DOCS_OPEN, { from, path });
  try { window.open(path, '_blank', 'noopener'); } catch (_) {}
}

// `feedback` is a rendered node for the "Send feedback" door (the real App
// passes its FeedbackButton; the local QA shell has no auth and passes nothing,
// so the door simply is not shown there).
export function HelpHost({ feedback = null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = (e) => {
      logEvent(EV.HELP_OPEN, { via: e?.detail?.via || 'other' });
      setOpen(true);
    };
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  return <HelpHub open={open} onClose={() => setOpen(false)} feedback={feedback} />;
}

export function HelpHub({ open, onClose, feedback = null }) {
  const [reg, setReg] = useState(null);
  const [guidesOpen, setGuidesOpen] = useState(false);

  // The registry is ~145KB of generated JSON; load it the first time the hub
  // opens (DocsTab does the same) rather than carrying it in AppShell.
  useEffect(() => {
    if (!open || reg) return;
    let alive = true;
    import('../lib/docsiteIndex.js')
      .then((m) => { if (alive) setReg({ sections: m.DOCS_SECTIONS || [], pages: m.DOCS_PAGES || [] }); })
      .catch(() => { if (alive) setReg({ sections: [], pages: [] }); });
    return () => { alive = false; };
  }, [open, reg]);

  const guides = useMemo(() => (reg ? guideLinks(reg.sections, reg.pages) : []), [reg]);

  const take = (item, extra = {}) => logEvent(EV.HELP_ITEM, { item, ...extra });

  const onAction = (a) => {
    take(a.item);
    if (a.item === 'shortcuts') {
      onClose?.();
      // Next tick, so the shortcuts overlay does not see this modal still
      // mounted and refuse to open on top of it.
      setTimeout(() => { try { document.dispatchEvent(new CustomEvent('soleil-open-help')); } catch (_) {} }, 0);
      return;
    }
    if (a.item === 'guides') { setGuidesOpen((v) => !v); return; }
    if (a.href) openDocs(a.href, 'help');
  };

  return (
    <Modal open={open} onClose={onClose} className="shortcuts-modal help-hub" ariaLabel="Help" showClose>
      <div className="shortcuts-hd">What can I add here?</div>
      <p className="help-hub-sub">
        Everything below goes on any cluster. Paste or drag from wherever it already is; the canvas
        takes care of the rest.
      </p>
      <div className="help-kinds" role="list">
        {ADD_KINDS.map((k) => (
          <div key={k.id} className="help-kind" role="listitem">
            <div className="help-kind-title">{k.title}</div>
            <div className="help-kind-line">{k.line}</div>
            <button type="button" className="help-kind-more"
                    onClick={() => { take('learn', { kind: k.id }); openDocs(k.docs, 'help'); }}>
              Learn more →
            </button>
          </div>
        ))}
      </div>

      <div className="help-actions" role="list">
        {HUB_ACTIONS.map((a) => {
          if (a.item === 'feedback') {
            if (!feedback) return null;
            return (
              <div key={a.item} className="help-action help-action-feedback" role="listitem"
                   onClickCapture={() => take('feedback')}>
                {feedback}
                <span className="help-action-label">{a.label}</span>
                <span className="help-action-hint">{a.hint}</span>
              </div>
            );
          }
          return (
            <button key={a.item} type="button" className="help-action" role="listitem"
                    aria-expanded={a.item === 'guides' ? guidesOpen : undefined}
                    onClick={() => onAction(a)}>
              <span className="help-action-label">{a.label}</span>
              <span className="help-action-hint">{a.hint}</span>
            </button>
          );
        })}
      </div>

      {guidesOpen && (
        <div className="help-guides" aria-label="Guides">
          {!reg ? (
            <div className="help-guides-loading">Loading…</div>
          ) : guides.length === 0 ? (
            <div className="help-guides-loading">
              Couldn’t load the index —{' '}
              <button type="button" className="help-kind-more" onClick={() => openDocs('/docs', 'help')}>open the docs site</button>.
            </div>
          ) : guides.map((g) => (
            <button key={g.id} type="button" className="help-guide"
                    onClick={() => { take('guide', { section: g.id }); openDocs(g.path, 'help'); }}>
              <span className="help-guide-label">{g.label}</span>
              {g.blurb && <span className="help-guide-blurb">{g.blurb}</span>}
            </button>
          ))}
        </div>
      )}

      <p className="help-hub-foot">
        The whole handbook is at{' '}
        <button type="button" className="help-kind-more" onClick={() => { take('docs'); openDocs('/docs', 'help'); }}>
          /docs
        </button>
        , also readable as plain Markdown at <code>/docs/*.md</code>.
      </p>
    </Modal>
  );
}
