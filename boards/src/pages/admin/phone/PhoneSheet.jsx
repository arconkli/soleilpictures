// PhoneSheet.jsx — a measure's sheet (the big number, 12 weeks or 6 months of
// it, and the weeks one by one), over whatever is showing: the home's tiles and
// Got started figure open it, and so do the Growth page's figures. The panel
// owns open and close (AdminPhonePanel: ?sheet=<measure id>, one history entry),
// so Back, Escape, Done and the backdrop all end up in onClose.
//
// Its three calls are the home's own, so they are in the cache already and the
// sheet opens with data. Every number comes from measureSheet() in
// lib/phoneInsights.js.
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePhoneData } from './phoneData.js';
import { measureSheet } from '../../../lib/phoneInsights.js';
import { Segmented, Section, WeekLine, DeltaText } from './phoneCharts.jsx';

const RANGES = [{ id: '12w', label: '12 weeks' }, { id: '26w', label: '6 months' }];
const KEYS = ['kpi', 'weeks', 'growth'];
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PhoneSheet({ id, refresh, onClose }) {
  const { values } = usePhoneData(KEYS, refresh);
  const [range, setRange] = useState('12w');
  const sheetRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const model = useMemo(
    () => measureSheet(id, { weeks: values.weeks, growth: values.growth, kpi: values.kpi }, range),
    [id, values.weeks, values.growth, values.kpi, range],
  );

  // Focus moves in on open and back to the opener on close; Tab stays inside.
  useEffect(() => {
    const opener = document.activeElement;
    const sheet = sheetRef.current;
    sheet?.querySelector('.ap-done')?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !sheet) return;
      const els = [...sheet.querySelectorAll(FOCUSABLE)];
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) { try { opener.focus({ preventScroll: true }); } catch { /* ignore */ } }
    };
  }, []);

  if (!model) return null;
  const tile = model.tile;
  const needs = id === 'activation_rate' ? values.growth : id === 'checkouts' ? values.kpi : values.weeks;
  const rate = id === 'activation_rate';
  const readout = tile
    ? { value: tile.value, label: rate ? tile.vs : 'last 7 days', delta: tile.delta }
    : null;

  return (
    <div className="ap-sheet-bg" onClick={onClose} role="presentation">
      <div className="ap-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label={model.title} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="ap-nav is-sheet">
          <span />
          <b>{model.title}</b>
          <button type="button" className="ap-done" onClick={onClose}>Done</button>
        </div>
        <div className="ap-shbody">
          {model.sub ? <p className="ap-kick">{model.sub}</p> : null}
          <p className="ap-lede">{model.about}</p>

          {model.pts ? (
            <Segmented options={RANGES} value={range} onChange={setRange} label="Range" />
          ) : null}

          {model.pts ? (
            <div className="ap-pan">
              {needs === undefined ? (
                <div className="ap-skel ap-skel-chart" aria-busy="true" />
              ) : model.pts.length ? (
                <WeekLine
                  pts={model.pts}
                  h={190}
                  isPct={rate}
                  readout={readout}
                  label={`${model.title}, a week, the last ${model.pts.length} weeks.`}
                />
              ) : (
                <p className="ap-wait">Nothing to chart yet.</p>
              )}
            </div>
          ) : (
            <div className="ap-pan">
              {readout && (
                <div className="ap-ro">
                  <span className="ap-ro-v">{readout.value}</span>
                  {readout.delta && <span className="ap-ro-d"><DeltaText delta={readout.delta} /></span>}
                  <span className="ap-ro-l">last 7 days</span>
                </div>
              )}
              {(model.lines || []).map((l) => <p className="ap-lede" key={l}>{l}</p>)}
            </div>
          )}

          {model.caption ? <p className="ap-cp">{model.caption}</p> : null}

          {model.table.length > 0 && (
            <>
              <Section title="Week by week" />
              <div className="ap-pan">
                <table className="ap-tbl">
                  <thead><tr><th scope="col">Week</th><th scope="col">{model.title}</th></tr></thead>
                  <tbody>
                    {model.table.map((r) => (
                      <tr key={r.label}>
                        <td>
                          {r.state === 'settling' ? r.label.replace(/ · settling$/, '') : r.label}
                          {r.state === 'settling' ? <> <span className="ap-faint">settling</span></> : null}
                        </td>
                        <td>{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <a className="ap-wide" href="/admin?tab=overview&full=1">Open full admin</a>
        </div>
      </div>
    </div>
  );
}
