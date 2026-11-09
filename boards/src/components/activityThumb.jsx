// The held-files panel (HeldUploadsBar.jsx, in the app's first load) draws the
// same thumb; taking it from ActivityTray.jsx would pull the whole tray back
// into the first load.
import { Icon } from './Icon.jsx';
import { Image, Clapperboard, Waveform, FilePdf, FileIcon } from '../lib/icons.js';

// A row's kind, from its type, else its name: a picture with no thumb yet, a
// video, a sound, a PDF, anything else.
const EXT = {
  image: /\.(jpe?g|png|gif|webp|avif|heic|heif|tiff?|bmp|svg|psd|dng|cr[23]|nef|arw|raf)$/i,
  video: /\.(mov|mp4|m4v|webm|mkv|avi|mxf)$/i,
  audio: /\.(wav|mp3|m4a|aac|flac|aiff?|ogg|opus)$/i,
  pdf: /\.pdf$/i,
};
function kindIcon(mime = '', name = '') {
  const m = String(mime || '');
  if (m.startsWith('image/') || (!m && EXT.image.test(name))) return Image;
  if (m.startsWith('video/') || (!m && EXT.video.test(name))) return Clapperboard;
  if (m.startsWith('audio/') || (!m && EXT.audio.test(name))) return Waveform;
  if (m === 'application/pdf' || (!m && EXT.pdf.test(name))) return FilePdf;
  return FileIcon;
}

// A file's thumb: its small preview as a background (a revoked blob URL then
// shows nothing, never a broken image), else its kind.
export function Thumb({ thumb = null, mime = '', name = '', dim = false }) {
  if (thumb) {
    return <span className={'atr-th' + (dim ? ' is-dim' : '')} style={{ backgroundImage: `url("${String(thumb).replace(/"/g, '%22')}")` }} aria-hidden="true" />;
  }
  return <span className="atr-th is-kind" aria-hidden="true"><Icon as={kindIcon(mime, name)} size={12} weight="regular" /></span>;
}
