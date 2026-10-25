# soleil-media

Converts uploaded video and audio that browsers can't play into an H.264/AAC
MP4 (video) or AAC `.m4a` (audio) copy, plus a `.webp` poster frame for videos.
What to make is decided by `boards/src/lib/playCopy.js` (`playPlan`), shared
with the Worker. Photos some browser can't draw (HEIC, TIFF, JPEG XL, OpenEXR,
JPEG 2000) get a view instead: a WebP at up to 2048 on its long side and a
640 one (`boards/src/lib/fileView.js`). Node 22, no npm dependencies, ffmpeg
and vips from apt.

It **holds no storage or database credentials, by design.** It only talks to
our Cloudflare Worker (`/api/media/copy/*`): the Worker hands it a job, serves
the original's bytes behind a per-job token, and accepts the outputs. The one
secret it has, `MEDIA_BOX_SECRET`, never reaches ffmpeg or vips, which run as
an unprivileged user with a bare environment. ffmpeg takes only whitelisted
protocols and containers; vips gets a local copy whose first bytes must be one
of the five formats, with its ImageMagick, PDF and OpenSlide modules removed
and untrusted loaders blocked (except the JPEG XL, OpenEXR and JPEG 2000
decoders, which libvips marks untrusted, for files whose bytes are those).

## Environment

| Variable | Meaning |
|---|---|
| `MEDIA_BOX_SECRET` | Bearer secret shared with the Worker (required). Authenticates calls both ways, including `POST /wake`. |
| `MEDIA_API_BASE` | The Worker's origin, no trailing slash (required), e.g. `https://main-soleil-boards.arconkli.workers.dev`. |
| `IDLE_EXIT_MS` | Exit 0 after this long with no work (default `300000`). Fly leaves the machine stopped; the Worker's next `/wake` starts it. |
| `MEDIA_UID` / `MEDIA_GID` | User ffmpeg and vips run as when the process is root (default `10001`). |
| `PORT` | HTTP port (default `8080`). `GET /healthz`, `POST /wake`. |

## Deploy

```sh
sh media/deploy.sh
```

It builds from a context holding only what the image copies (`playCopy.js`,
`fileView.js` and `media/`), on Fly's remote builder, one machine
(`--ha=false`). Secrets, once:

```sh
fly secrets set -a soleil-media MEDIA_BOX_SECRET=… MEDIA_API_BASE=https://clusters.soleilpictures.com
```

The same `MEDIA_BOX_SECRET` goes on the Worker (`wrangler versions secret put
MEDIA_BOX_SECRET`); the Worker's `MEDIA_BOX_URL` (wrangler.toml) is this app's
address. `MEDIA_API_BASE` is whichever Worker holds the converter routes: the
queue and the bucket are shared, so the preview alias works until production
has them.

## Test

```sh
cd media && npm test
```
