// args.mjs — run.mjs's command line, parsed. Pure, so the tests can reach it.
//
//   --daily | --batch | --page <path> | --subject <name> | --brief "<text>"
//   --spares <n>  --dry-run  --only <kind,kind>
//   --cluster <name>   the cluster a --brief board lands in (default TikTok; ignored elsewhere)
//   --json <file>      the run's result, written there in any mode
//   --words a,b,c      candidate /c/ words: a board made is then published unlisted at the first free one
//   --style "<look>"   one look for this run (styles.mjs), not the next by turns

import { styleNamed, STYLES } from './styles.mjs';

export function args(argv) {
  const a = { spares: 0, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--daily') a.mode = 'daily';
    else if (k === '--batch') a.mode = 'batch';
    else if (k === '--page') { a.mode = 'page'; a.page = argv[++i]; }
    else if (k === '--subject') { a.mode = 'subject'; a.subject = argv[++i]; }
    else if (k === '--brief') { a.mode = 'brief'; a.brief = argv[++i]; }
    else if (k === '--cluster') a.cluster = argv[++i];
    else if (k === '--json') a.json = argv[++i];
    else if (k === '--words') a.words = String(argv[++i] || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    else if (k === '--spares') a.spares = Number(argv[++i]) || 0;
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--only') a.only = argv[++i].split(',');
    else if (k === '--style') { a.style = argv[++i]; if (!styleNamed(a.style)) throw new Error(`no style "${a.style}" (${STYLES.map((s) => s.name).join(', ')})`); }
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.mode) throw new Error('say --daily, --batch, --page <path>, --subject <name> or --brief "<text>"');
  if (a.mode === 'brief') {
    if (!a.brief || !a.brief.trim() || a.brief.startsWith('--')) throw new Error('--brief needs the text of the brief');
    a.cluster = a.cluster || 'TikTok';
  }
  return a;
}
