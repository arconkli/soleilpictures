// Quick look's page for a zip: the zip as a folder to walk through, without
// downloading it. Its directory is read by byte ranges (lib/remoteBlob.js),
// and so is each picture as it scrolls into view, drawn small, two at a time:
// a 2 GB zip costs its directory and the pictures on screen. Its folders come
// first with how much each holds, then its pictures, then its other files,
// from the one folder a zip often holds, as its card's contact sheet has them
// (lib/archiveSheet.js).
//
// A click selects a file (the selection's gold) and offers it to download; a
// double-click or Enter opens a folder, or a picture large, which Escape
// steps back from (QuickLook.jsx, [data-ql-back]); on a touch screen a second
// tap opens. A file locked with a password, or packed some way a browser
// can't unpack, is named and says so, and never opens. Unpack into clusters
// downloads the zip and hands it to the bulk import, as the sidebar's "A
// zip…" does, into this cluster (lib/fileActions.js): offered when the viewer
// can edit the cluster, it's on screen, the browser can inflate, and the zip
// is at most UNPACK_MAX_BYTES. White in both themes, as Quick look's other
// pages are. Lazy: Quick look loads it for the first zip it shows.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readZipDirectory, openEntry } from '../../lib/zipRead.js';
import { RemoteBlob } from '../../lib/remoteBlob.js';
import { cleanPath, rootOf, levelOf, summaryOf, PHOTO_EXTS, BROWSER_PHOTO_EXTS } from '../../lib/archiveSheet.js';
import { resolveSrc } from '../../lib/r2.js';
import { deliverFile } from '../../lib/exportDelivery.js';
import { canUnpackZip, unpackZip } from '../../lib/fileActions.js';
import { canUnpackZips } from '../../lib/importZips.js';
import { fileFamily } from '../../lib/fileView.js';
import { VIDEO_EXT_RE } from '../../lib/fileIngest.js';
import { reportError } from '../../lib/errorReporting.js';
import { UNPACK_MAX_BYTES, ZIP_THUMB_MAX_BYTES } from '../../lib/fileFaceLimits.js';
import { familyGlyph } from '../cards/FamilyFace.jsx';
import { humanSize, iconForFile } from '../cards/FileCard.jsx';
import { useOptionalFeedback } from '../AppFeedback.jsx';
import { Icon } from '../Icon.jsx';
import {
  Download, FolderSimple, Lock, ArrowLeft, Package, Image as ImagePh, Clapperboard, Headphones,
} from '../../lib/icons.js';
import './zipStage.css';

const AUDIO_RE = /\.(wav|aiff?|flac|m4a|aac|ogg|opus|mp3|caf)$/i;
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const THUMB_W = 360;
const AT_ONCE = 2;
// Tiles drawn at once in one folder; a Takeout folder can hold thousands.
const PAGE = 240;
const FOLD_BYTES = 8 * 1024 * 1024;
const LOCKED = 'This file is locked with a password.';
const PACKED = "This file is packed in a way a browser can't open.";

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const coarse = () => {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
};
const drawable = (t) => t.kind === 'photo' && !!t.entry && !t.locked && !t.packed && BROWSER_PHOTO_EXTS.includes(t.ext);
const thumbable = (t) => drawable(t) && t.size <= ZIP_THUMB_MAX_BYTES;
const savable = (t) => t.kind !== 'folder' && !!t.entry && !t.locked && !t.packed;

function glyphOf(t) {
  if (t.kind === 'folder') return FolderSimple;
  if (t.locked) return Lock;
  if (t.kind === 'photo') return ImagePh;
  if (VIDEO_EXT_RE.test(t.name)) return Clapperboard;
  if (AUDIO_RE.test(t.name)) return Headphones;
  return familyGlyph(fileFamily(t.ext), t.ext) || iconForFile(t.ext);
}

// An entry's bytes as a Blob of its type. A stored entry of a zip read by
// ranges is a slice of it (lib/remoteBlob.js), read here.
async function entryBlob(remote, entry, type = '') {
  const raw = await openEntry(remote, entry);
  if (!(raw instanceof Blob)) return raw.blob(type);
  return type && raw.type !== type ? raw.slice(0, raw.size, type) : raw;
}

// A picture drawn small (decoded at that size where the browser can), as an
// object URL; the picture itself where it can't be drawn small.
async function thumbOf(remote, t) {
  const blob = await entryBlob(remote, t.entry, TYPES[t.ext]);
  try {
    const bmp = await createImageBitmap(blob, { resizeWidth: THUMB_W, resizeQuality: 'medium' });
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    const jpeg = t.ext === 'jpg' || t.ext === 'jpeg';
    const small = await new Promise((done) => canvas.toBlob(done, jpeg ? 'image/jpeg' : 'image/png', 0.86));
    if (small) return URL.createObjectURL(small);
  } catch { /* drawn as it is */ }
  return URL.createObjectURL(blob);
}

// The whole zip, for Unpack: kept by the browser in pieces (a big one on
// disk, not in the page's memory), with how much has come.
async function downloadZip(url, size, { signal, onProgress }) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const reader = res.body.getReader();
  const parts = [];
  let pending = [];
  let pendingBytes = 0;
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.byteLength;
    pending.push(value);
    pendingBytes += value.byteLength;
    if (pendingBytes >= FOLD_BYTES) {
      parts.push(new Blob(pending));
      pending = [];
      pendingBytes = 0;
    }
    onProgress(got);
  }
  if (got !== size) throw new Error('the download stopped short');
  return new Blob([...parts, ...pending], { type: 'application/zip' });
}

// The zip's directory: { remote, entries } once read; null when it isn't a
// zip this can read, or there's no link to it; undefined while it's read.
function useZip(src, sizeBytes) {
  const key = `${src}\n${sizeBytes}`;
  const [got, setGot] = useState({ key: '', value: undefined });
  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    const done = (value) => { if (live) setGot({ key, value }); };
    const size = Number(sizeBytes);
    if (!(size > 0)) done(null);
    else {
      resolveSrc(src)
        .then(async (url) => {
          if (!url) return null;
          const remote = new RemoteBlob(url, size);
          const { entries } = await readZipDirectory(remote, { locked: true });
          return { remote, entries };
        })
        .catch(() => null)
        .then(done);
    }
    return () => { live = false; };
  }, [src, sizeBytes, key]);
  return got.key === key ? got.value : undefined;
}

// Pictures as they scroll into view, AT_ONCE at a time, each kept as an
// object URL (false when it can't be drawn) until the stage goes.
function useThumbs(remote) {
  const [urls, setUrls] = useState(() => new Map());
  const run = useRef({ want: [], busy: 0, asked: new Set(), made: [], live: true });
  useEffect(() => {
    const r = run.current;
    r.live = true;
    return () => {
      r.live = false;
      r.made.forEach((u) => URL.revokeObjectURL(u));
      r.made = [];
    };
  }, []);
  const pump = useCallback(() => {
    const r = run.current;
    while (r.busy < AT_ONCE && r.want.length) {
      const t = r.want.shift();
      r.busy += 1;
      thumbOf(remote, t).catch(() => null).then((url) => {
        r.busy -= 1;
        if (!r.live) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (url) r.made.push(url);
        setUrls((m) => new Map(m).set(t.path, url || false));
        pump();
      });
    }
  }, [remote]);
  const ask = useCallback((t) => {
    const r = run.current;
    if (r.asked.has(t.path)) return;
    r.asked.add(t.path);
    r.want.push(t);
    pump();
  }, [pump]);
  const broke = useCallback((path) => setUrls((m) => new Map(m).set(path, false)), []);
  return [urls, ask, broke];
}

function Tile({ t, sel, url, saving, onPick, onOpen, onSave, onBroke }) {
  const pic = t.kind === 'photo' && url;
  return (
    <div className={`qzip-t${sel ? ' is-sel' : ''}`} data-path={t.path}>
      <button type="button" className="qzip-hit" aria-pressed={sel}
              title={t.locked ? LOCKED : t.packed ? PACKED : t.name}
              onClick={() => onPick(t)} onDoubleClick={() => onOpen(t)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(t); } }}>
        <span className={`qzip-pic${t.kind === 'folder' ? ' is-folder' : ''}`}
              data-thumb={thumbable(t) && url === undefined ? t.path : undefined}>
          {pic
            ? <img src={url} alt="" draggable={false} onError={() => onBroke(t.path)} />
            : <Icon as={glyphOf(t)} size={t.kind === 'folder' ? 46 : 40} />}
          {t.kind === 'folder' && <em>{count(t.count, 'item', 'items')}</em>}
        </span>
        <span className="qzip-nm">{t.name}</span>
        <span className="qzip-sz">{t.kind === 'folder' ? 'Folder' : humanSize(t.size)}</span>
      </button>
      {sel && savable(t) && (
        <button type="button" className="qzip-chip" aria-label={`Download ${t.name}`} title={`Download ${t.name}`}
                disabled={saving} onClick={() => onSave(t)}>
          <Icon as={Download} size={13} />
        </button>
      )}
    </div>
  );
}

// A picture from the zip, large, with the way back to the folder.
function Picture({ remote, t, saving, onBack, onSave }) {
  const [url, setUrl] = useState(null);
  const backRef = useRef(null);
  useEffect(() => { backRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let live = true;
    let made = null;
    entryBlob(remote, t.entry, TYPES[t.ext]).then((b) => {
      made = URL.createObjectURL(b);
      if (live) setUrl(made);
      else URL.revokeObjectURL(made);
    }, () => { if (live) setUrl(''); });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [remote, t]);
  return (
    <>
      <div className="qzip-top">
        <button ref={backRef} type="button" className="qzip-btn" data-ql-back onClick={onBack}>
          <Icon as={ArrowLeft} size={15} />Back
        </button>
        <div className="qzip-crumb"><b title={t.name}>{t.name}</b></div>
        <span className="qzip-m">{humanSize(t.size)}</span>
        <button type="button" className="qzip-btn" disabled={saving} onClick={() => onSave(t)}>
          <Icon as={Download} size={15} />Download
        </button>
      </div>
      <div className="qzip-view" aria-busy={url === null || undefined}>
        {url && <img src={url} alt={t.name} onError={() => setUrl('')} />}
        {url === '' && <p className="qzip-empty" role="status">This picture couldn't be read.</p>}
      </div>
    </>
  );
}

function ZipSheet({ zip, item, sizeBytes, canPut, onClose }) {
  const feedback = useOptionalFeedback();
  const zipName = item.card?.fileName || item.name || 'Archive.zip';
  const model = useMemo(() => {
    const byPath = new Map();
    for (const e of zip.entries) {
      const path = e.dir ? null : cleanPath(e.path);
      if (path) byPath.set(path, e);
    }
    return { byPath, root: rootOf(zip.entries), summary: summaryOf(zip.entries) };
  }, [zip]);
  const [at, setAt] = useState(model.root);
  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  const [saving, setSaving] = useState(null);
  const [pulling, setPulling] = useState(null);
  const [urls, ask, broke] = useThumbs(zip.remote);
  const bodyRef = useRef(null);
  const sheetRef = useRef(null);
  const tallest = useRef(0);
  const pullRef = useRef(null);
  const shownPct = useRef(-1);

  const tiles = useMemo(() => {
    const { folders, files } = levelOf(zip.entries, at);
    const named = files.map((f) => {
      const entry = model.byPath.get(f.path) || null;
      return {
        ...f, entry, kind: PHOTO_EXTS.includes(f.ext) ? 'photo' : 'file',
        locked: !!entry && (entry.flags & 1) === 1,
        packed: !!entry && (entry.flags & 1) !== 1 && entry.method !== 0 && entry.method !== 8,
      };
    });
    return [
      ...folders.map((f) => ({ ...f, kind: 'folder' })),
      ...named.filter((t) => t.kind === 'photo'),
      ...named.filter((t) => t.kind === 'file'),
    ];
  }, [zip, at, model]);

  // The page takes the keyboard when it opens (↑/↓ scroll it), as the
  // other pages do; ←/→ stay Quick look's.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && document.activeElement === el.closest('.ql')) el.focus({ preventScroll: true });
  }, []);
  useEffect(() => () => pullRef.current?.abort(), []);
  // The sheet never shrinks under the pointer: a folder that holds less
  // keeps the height the zip has had, so the crumbs stay where they were.
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el || el.offsetHeight <= tallest.current) return;
    tallest.current = el.offsetHeight;
    el.style.minHeight = `min(${tallest.current}px, 100%)`;
  });

  // Pictures as their tiles come near the view.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || open) return undefined;
    const want = new Map(tiles.slice(0, limit).filter(thumbable).map((t) => [t.path, t]));
    if (!want.size) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      want.forEach((t) => ask(t));
      return undefined;
    }
    const io = new IntersectionObserver((seen) => {
      for (const s of seen) {
        if (!s.isIntersecting) continue;
        io.unobserve(s.target);
        const t = want.get(s.target.dataset.thumb);
        if (t) ask(t);
      }
    }, { root: body, rootMargin: '240px 0px' });
    body.querySelectorAll('[data-thumb]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [tiles, limit, open, ask]);

  const go = (prefix) => {
    setAt(prefix);
    setSel(null);
    setNote(null);
    setLimit(PAGE);
    const body = bodyRef.current;
    if (body) {
      body.scrollTop = 0;
      body.focus({ preventScroll: true });
    }
  };
  const openTile = (t) => {
    if (t.kind === 'folder') { go(t.path); return; }
    setSel(t.path);
    if (t.locked || t.packed) { setNote(t.locked ? LOCKED : PACKED); return; }
    if (drawable(t)) setOpen(t);
  };
  const pick = (t) => {
    if (sel === t.path && coarse()) { openTile(t); return; }
    setSel(t.path);
    setNote(t.locked ? LOCKED : t.packed ? PACKED : null);
  };
  const back = () => {
    const was = open?.path;
    setOpen(null);
    requestAnimationFrame(() => {
      const hit = [...(bodyRef.current?.querySelectorAll('.qzip-t') || [])].find((el) => el.dataset.path === was);
      hit?.querySelector('.qzip-hit')?.focus({ preventScroll: false });
    });
  };
  const save = async (t) => {
    if (!savable(t) || saving) return;
    setSaving(t.path);
    try {
      const blob = await entryBlob(zip.remote, t.entry, TYPES[t.ext] || 'application/octet-stream');
      await deliverFile(blob, t.name);
    } catch (err) {
      feedback?.toast({ type: 'error', code: 'zip_entry_download_failed', message: `Download failed: ${err?.message || err}` });
    } finally {
      setSaving(null);
    }
  };

  const canUnpack = canPut && !!item.boardId && canUnpackZip(item.boardId) && canUnpackZips() && sizeBytes <= UNPACK_MAX_BYTES;
  const unpack = async () => {
    if (pulling != null) return;
    const ctl = new AbortController();
    pullRef.current = ctl;
    shownPct.current = 0;
    setPulling(0);
    try {
      const url = await resolveSrc(item.preview.src);
      if (!url) throw new Error('no link to the zip');
      const blob = await downloadZip(url, sizeBytes, {
        signal: ctl.signal,
        onProgress: (got) => {
          const pct = Math.min(99, Math.floor((got / sizeBytes) * 100));
          if (pct !== shownPct.current) { shownPct.current = pct; setPulling(pct); }
        },
      });
      const file = new File([blob], zipName, { type: 'application/zip' });
      Promise.resolve(unpackZip(item.boardId, file))
        .catch((err) => reportError(err, { kind: 'import', severity: 'warning', op: 'quicklook_unpack' }));
      onClose?.();
    } catch (err) {
      if (ctl.signal.aborted) return;
      setPulling(null);
      feedback?.toast({ type: 'error', code: 'zip_unpack_download_failed', message: `The zip couldn't be downloaded: ${err?.message || err}` });
    }
  };

  if (open) {
    return (
      <div className="qzip is-picture">
        <Picture remote={zip.remote} t={open} saving={saving === open.path} onBack={back} onSave={save} />
      </div>
    );
  }

  const trail = at.slice(model.root.length).split('/').filter(Boolean);
  const { files, bytes } = model.summary;
  const more = tiles.length - limit;
  return (
    <div ref={sheetRef} className="qzip">
      <div className="qzip-top">
        <nav className="qzip-crumb" aria-label="Where in the zip">
          {trail.length
            ? <button type="button" onClick={() => go(model.root)}>{zipName}</button>
            : <b title={zipName}>{zipName}</b>}
          {trail.map((name, i) => {
            const prefix = `${model.root}${trail.slice(0, i + 1).join('/')}/`;
            return (
              <Fragment key={prefix}>
                <span className="qzip-sep" aria-hidden="true">›</span>
                {i === trail.length - 1
                  ? <b title={name}>{name}</b>
                  : <button type="button" onClick={() => go(prefix)}>{name}</button>}
              </Fragment>
            );
          })}
        </nav>
        <span className="qzip-m">{count(files, 'file', 'files')} · {humanSize(bytes)}</span>
        {canUnpack && (
          <button type="button" className="qzip-btn is-main" disabled={pulling != null} onClick={unpack}>
            <Icon as={Package} size={15} />
            {pulling == null ? 'Unpack into clusters' : `Downloading… ${pulling}%`}
          </button>
        )}
      </div>
      {note && (
        <p className="qzip-note" role="status"><Icon as={Lock} size={15} />{note}</p>
      )}
      <div ref={bodyRef} className="qzip-body" tabIndex={-1}>
        {tiles.length ? (
          <div className="qzip-grid">
            {tiles.slice(0, limit).map((t) => (
              <Tile key={t.path} t={t} sel={sel === t.path} url={urls.get(t.path)} saving={saving === t.path}
                    onPick={pick} onOpen={openTile} onSave={save} onBroke={broke} />
            ))}
          </div>
        ) : (
          <p className="qzip-empty">{trail.length ? 'This folder is empty.' : 'This zip is empty.'}</p>
        )}
        {more > 0 && (
          <div className="qzip-more">
            <button type="button" className="qzip-btn" onClick={() => setLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, more)} more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ZipStage({ item, canPut = false, onClose = null, fallback = null }) {
  const sizeBytes = item.sizeBytes ?? item.card?.sizeBytes ?? null;
  const zip = useZip(item.preview?.src, sizeBytes);
  if (zip === undefined) {
    return (
      <div className="qzip" aria-busy="true">
        <div className="qzip-top"><div className="qzip-crumb"><b>{item.card?.fileName || item.name || ''}</b></div></div>
        <div className="qzip-wait" />
      </div>
    );
  }
  // Not a zip this can read (or no link to it): Quick look's own card.
  if (!zip) return fallback;
  return <ZipSheet zip={zip} item={item} sizeBytes={Number(sizeBytes)} canPut={canPut} onClose={onClose} />;
}
