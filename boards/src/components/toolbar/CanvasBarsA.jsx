import { useRef } from 'react';
import { IconWeightContext } from '../Icon.jsx';
import { useArrowPopover } from '../../hooks/useArrowPopover.js';
import { Btn, Group, Swatch, Toolbar } from './Toolbar.jsx';
import { MenuButton, MenuHead, MenuItem, MenuSep, useMenu } from './Menu.jsx';
import { Chip, ColourRows, colourChoices, inkBg } from './Colours.jsx';
import { useIslandFit } from './useIslandFit.js';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { useRecentColors } from '../../hooks/useRecentColors.js';
import { addRecentColor } from '../../lib/recentColors.js';
import { BrushPreview, BRUSH_LABELS, BRUSH_ORDER } from '../BrushPreview.jsx';
import { DEFAULT_BRUSH } from '../../lib/strokeModel.js';
import { DASH_STYLES, SHAPES } from '../../lib/shapeOptions.js';
import { ARROW_COLOR_KEYS, ARROW_COLOR_TOKENS, arrowColor, arrowHeadStyle, isCustomArrowColor } from '../../lib/arrowGeometry.js';
import { DRAW_THICKNESS, FILL_COLORS, LineAngleInput, LinePxInput, STROKE_COLORS } from '../ToolOptionsBar.jsx';
import {
  ArrowRight, ArrowsHorizontal, Circle, CornersOut, DiamondShape, Eraser, HandPointing, Hexagon, Lasso, LineSegment,
  Minus, MoreHorizontal, PenNib, Plus, Square, Star, Trash2, Triangle, Undo,
} from '../../lib/icons.js';
import { t as tr, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

// The canvas's tool bars in the toolbar look (the owner's pick "A · Islands",
// 2026-10-21; the toolbar canvas's A-draw and A-parts frames), the note bar's
// island (NoteBarA) for what a tool makes:
//
//   draw     ↶ | ✒ ⌫ ◌ | 4 brushes | 9 colours + | 4 widths | ⤢ Canvas
//   folded   ↶ | ✒ ⌫ ◌ | Brush ⌄ | 9 colours + | 4 widths | ⤢ Canvas
//            ↶ | ✒ ⌫ ◌ | Brush ⌄ ● ⌄ | 4 widths | ⤢ Canvas
//   finger   ↶ | ✒ ⌫ ◌ | ● ⌄ | ⤢          (the chip's menu: brush, colour, width)
//   shape    ▢ Rect ⌄ | ◯ ■ | − 2 + | Solid ⌄      (a phone: ▢ Rect ⌄ | ◯ ■ | ⋯)
//   line     ◯ | − 2 + | Solid ⌄ | 0 °             (a phone: ◯ | − 2 + | ⋯)
//   arrow    Curved Straight | Solid Dashed
//   picked   ● | ═ ═ ═ | — → ↔ | ⌒ ╱ | ┄ | Label… | 🗑   (an arrow, PickedArrowBarA)
//
// A desktop window too narrow for a row folds it a step at a time
// (useIslandFit): the draw bar's brushes into a menu, then its colours, then
// the brush, the colour and the width into one chip, as under a finger; the
// shape and line bars' width and style into ⋯, as on a phone. The eraser
// keeps only its sizes, and the lasso only what it does.
//
// ToolOptionsBar works each: what's set (the draw tool's options, a shape's,
// a line's), what a control sets, and the bar's keys (onKeyDown: one Tab
// stop, the arrows along it). Each menu takes the press
// that closes it (Menu's scrim), so it doesn't also draw or place a shape.

const MENU = 'tob-menu';
// The draw bar's own colours, A-draw's nine: white, a grey, black, then red,
// amber, green, blue, violet and pink.
const DRAW_COLORS = ['#f5f5f6', '#9ca3af', '#0a0a0c', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const SHAPE_ICONS = {
  rect: Square, ellipse: Circle, line: LineSegment, arrow: ArrowRight,
  diamond: DiamondShape, triangle: Triangle, hexagon: Hexagon, star: Star,
};
// − and + step a width no further than its field takes (0, no line, to 200).
const clampWidth = (n) => Math.min(200, Math.max(0, Math.round(n)));

function useInput() {
  const { isPhone, isTouch } = useBreakpoint();
  return isPhone ? 'phone' : isTouch ? 'touch' : 'desktop';
}

// The bar: .tob's place in the look's island (toolbarLook.css .tob-a).
function Island({ barRef, label, onKeyDown, input, className, children }) {
  return (
    <IconWeightContext.Provider value="regular">
      <div ref={barRef} className={`tob tob-a ${className} is-${input === 'desktop' ? 'desk' : input}`}
           role="toolbar" aria-label={label} onKeyDown={onKeyDown}
           onPointerDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </IconWeightContext.Provider>
  );
}

// A brush as the stroke it draws, in the control's ink (BrushPreview).
function BrushFace({ id }) {
  return (
    <svg className="db-bp" viewBox="0 0 56 26" aria-hidden="true">
      <BrushPreview brush={id} />
    </svg>
  );
}
const BRUSH_ICONS = Object.fromEntries(BRUSH_ORDER.map((id) => [id, function BrushIcon() { return <BrushFace id={id} />; }]));

// A width as the line it draws.
function WidthFace({ w }) {
  return <span className="db-w" style={{ '--w': `${Math.max(2, Math.min(w, 14))}px` }} aria-hidden="true" />;
}

// A line style as the line it draws.
const dashIcon = (dashes) => function DashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={dashes} />
    </svg>
  );
};
const DASH_ICONS = { solid: dashIcon(undefined), dashed: dashIcon('5 4'), dotted: dashIcon('0.1 4') };

// A width in ⋯ (a phone's shape bar): − and + step it, and the menu stays
// open to see it change.
function WidthRow({ label, value, onStep }) {
  const what = label.toLowerCase();
  return (
    <div className="tl-mrow is-indent" role="group" aria-label={label}>
      <span className="tl-mrow-l"><Trans>Width</Trans></span>
      <span className="tl-seg">
        <Btn icon={Minus} label={tr`Decrease ${what}`} role="menuitem" tabIndex={-1} onClick={() => onStep(value - 1)} />
        <span className="tl-mval" aria-live="polite">{value}</span>
        <Btn icon={Plus} label={tr`Increase ${what}`} role="menuitem" tabIndex={-1} onClick={() => onStep(value + 1)} />
      </span>
    </div>
  );
}

// A width between − and +, its field taking any number (ToolOptionsBar's
// LinePxInput: Enter or leaving it sets it, Escape puts it back).
function WidthStep({ name, value, onSet }) {
  const what = name.toLowerCase();
  return (
    <span className="tl-step">
      <Btn icon={Minus} label={tr`Decrease ${what}`} onClick={() => onSet(clampWidth(value - 1))} />
      <LinePxInput value={value} label={name} onCommit={onSet} />
      <Btn icon={Plus} label={tr`Increase ${what}`} onClick={() => onSet(clampWidth(value + 1))} />
    </span>
  );
}

// The line styles, as a menu's rows.
function DashRows({ current, onDash }) {
  return DASH_STYLES.map((d) => (
    <MenuItem key={d.id} icon={DASH_ICONS[d.id]} label={d.label} radio checked={d.id === current} onSelect={() => onDash(d.id)} />
  ));
}
function DashMenu({ current, onDash }) {
  const now = DASH_STYLES.find((d) => d.id === current) || DASH_STYLES[0];
  return (
    <MenuButton label={tr`Line style: ${ph({ label: now.label })}`} menuLabel={tr`Line style`} text={now.label} select caret side="above"
                className="tl-dash" menuClassName={MENU} scrim>
      <DashRows current={now.id} onDash={onDash} />
    </MenuButton>
  );
}

export function DrawBarA({
  barRef, onKeyDown, options, setOptions, paletteColors, openPickerAt, onUndo, onOpenSketchpad,
  stylus = false, fingerDraws = false, onFinger,
}) {
  const input = useInput();
  const phone = input === 'phone';
  const fold = useIslandFit(barRef, { on: input === 'desktop', max: 3 });
  // How far the row is folded: a desktop's as it fits, a finger's to the
  // one chip.
  const level = input === 'desktop' ? fold : 3;
  const recentColors = useRecentColors();
  const isEraser = options.mode === 'eraser';
  const isLasso = options.mode === 'lasso';
  // A brush, a colour and a width are nothing to a selection gesture.
  const inking = !isEraser && !isLasso;
  const brush = options.brush || DEFAULT_BRUSH;
  const color = options.color;
  const width = isEraser ? options.eraserWidth : options.width;
  const set = (patch) => setOptions({ ...options, ...patch });
  const setWidth = (w) => set(isEraser ? { eraserWidth: w } : { width: w });
  const widthName = (w) => (isEraser ? tr`Eraser size ${w}` : tr`Stroke width ${w}`);
  const customColour = (e) => openPickerAt(e, {
    value: color,
    onChange: (c) => { set({ color: c }); addRecentColor(c); },
  });
  // A phone's row shares its width among the controls, not the groups.
  const share = (n) => (phone ? { flexGrow: n } : undefined);

  const mode = (m, icon, name, on, tip) => (
    <Btn icon={icon} label={name} tip={tip} toggle on={on} onClick={() => set({ mode: m })} />
  );
  const brushMenu = (
    <MenuButton label={tr`Brush: ${ph({ value: BRUSH_LABELS[brush] })}`} menuLabel={tr`Brush`} face={<BrushFace id={brush} />} caret
                side="above" className="db-brush" menuClassName={`${MENU} db-brush-menu`} scrim>
      {BRUSH_ORDER.map((id) => (
        <MenuItem key={id} icon={BRUSH_ICONS[id]} label={BRUSH_LABELS[id]} radio checked={brush === id}
                  onSelect={() => set({ brush: id })} />
      ))}
    </MenuButton>
  );
  const colourRows = (
    <ColourRows head={tr`Color`} swatches={DRAW_COLORS} paletteColors={paletteColors} current={color} ink
                onPick={(c) => set({ color: c })} onCustom={customColour} />
  );
  // The chip under a finger (and a desktop's row folded all the way): what
  // it draws with, as a dot of its colour as wide as its width, and a menu
  // of the three, the brush and the width picked in place.
  const chipName = isEraser ? tr`Eraser size` : tr`Brush, color and width`;
  const chip = (
    <MenuButton label={chipName} caret side="above" align="center" className="db-chip"
                menuClassName={`${MENU} db-menu`} scrim
                face={<span className={isEraser ? 'db-dot is-eraser' : 'db-dot'}
                            style={{ '--chip': inkBg(color), '--d': `${Math.min(16, Math.max(8, width + 4))}px` }} />}>
      {inking && (
        <>
          <MenuHead>{tr`Brush`}</MenuHead>
          <div className="db-row" role="group" aria-label={tr`Brush`}>
            {BRUSH_ORDER.map((id) => (
              <Btn key={id} label={BRUSH_LABELS[id]} role="menuitemradio" aria-checked={brush === id} tabIndex={-1}
                   on={brush === id} className="db-brush" onClick={() => set({ brush: id })}>
                <BrushFace id={id} />
              </Btn>
            ))}
          </div>
          {colourRows}
        </>
      )}
      <MenuHead>{isEraser ? tr`Eraser size` : tr`Width`}</MenuHead>
      <div className="db-row" role="group" aria-label={isEraser ? tr`Eraser size` : tr`Width`}>
        {DRAW_THICKNESS.map((w) => (
          <Btn key={w} label={widthName(w)} role="menuitemradio" aria-checked={width === w} tabIndex={-1}
               on={width === w} className="db-width" onClick={() => setWidth(w)}>
            <WidthFace w={w} />
          </Btn>
        ))}
      </div>
    </MenuButton>
  );
  // Canvas keeps its word where there's room for it.
  const canvasWords = input === 'touch' || (input === 'desktop' && level < 3);

  const groups = [];
  if (onUndo) {
    groups.push(<Group key="undo"><Btn icon={Undo} label={tr`Undo`} keys="Mod+Z" onClick={onUndo} /></Group>);
  }
  groups.push(
    <Group key="modes" style={share(stylus ? 4 : 3)}>
      {mode('pen', PenNib, tr`Pen`, inking)}
      {mode('eraser', Eraser, tr`Eraser`, isEraser)}
      {mode('lasso', Lasso, tr`Lasso`, isLasso, tr`Lasso: circle strokes to select them`)}
      {/* Only once the device has shown it has a stylus: before that the
          finger is the only way to draw (lib/pointerPolicy.js). */}
      {stylus && (
        <Btn icon={HandPointing} label={tr`Draw with finger`} toggle on={fingerDraws} onClick={onFinger}
             tip={fingerDraws ? tr`Your finger draws. Turn off to let it pan while the stylus draws.`
               : tr`Your finger pans and only the stylus draws. Turn on to draw with either.`} />
      )}
    </Group>,
  );
  if (inking && level === 0) {
    groups.push(
      <Group key="brushes">
        {BRUSH_ORDER.map((id) => (
          <Btn key={id} label={tr`${ph({ value: BRUSH_LABELS[id] })} brush`} tip={BRUSH_LABELS[id]} toggle on={brush === id}
               className="db-brush" onClick={() => set({ brush: id })}>
            <BrushFace id={id} />
          </Btn>
        ))}
      </Group>,
    );
  }
  if (inking && level === 1) groups.push(<Group key="brush">{brushMenu}</Group>);
  if (inking && level <= 1) {
    groups.push(
      <Group key="colours" className="db-colours">
        {colourChoices(recentColors, paletteColors, DRAW_COLORS, 9).map((c) => (
          <Swatch key={c} color={inkBg(c)} label={tr`Color ${c}`} on={color === c}
                  onClick={() => { set({ color: c }); addRecentColor(c); }} />
        ))}
        <Swatch add icon={Plus} label={tr`Custom color`} onClick={customColour} />
      </Group>,
    );
  }
  if (inking && level === 2) {
    groups.push(
      <Group key="brush">
        {brushMenu}
        <MenuButton label={tr`Color: ${color}`} menuLabel={tr`Color`} face={<Chip color={color} shape="dot" ink />} caret
                    side="above" menuClassName={`${MENU} db-colour-menu`} scrim>
          {colourRows}
        </MenuButton>
      </Group>,
    );
  }
  if (!isLasso && level <= 2) {
    groups.push(
      <Group key="widths">
        {DRAW_THICKNESS.map((w) => (
          <Btn key={w} label={widthName(w)} tip={tr`${w}px`} toggle on={width === w} className="db-width"
               onClick={() => setWidth(w)}>
            <WidthFace w={w} />
          </Btn>
        ))}
      </Group>,
    );
  }
  if (!isLasso && level === 3) groups.push(<Group key="chip">{chip}</Group>);
  if (isLasso && !phone) groups.push(<Group key="hint"><span className="db-hint"><Trans>Circle strokes to select</Trans></span></Group>);
  if (onOpenSketchpad) {
    groups.push(
      <Group key="canvas">
        <Btn icon={CornersOut} text={canvasWords ? tr`Canvas` : undefined} label={tr`Open a fullscreen drawing canvas`}
             tip={tr`Open a fullscreen drawing canvas`} className="tob-canvas-btn" onClick={onOpenSketchpad} />
      </Group>,
    );
  }
  return (
    <Island barRef={barRef} label={tr`Drawing`} onKeyDown={onKeyDown} input={input} className="db-a">
      {groups}
    </Island>
  );
}

// The shape tool's bar, and a picked shape's: `opts` are the tool's next
// shape or the shape's own (ToolOptionsBar); a colour picked goes to the
// recent ones only once there's a shape (`editing`).
export function ShapeBarA({ barRef, onKeyDown, opts, setOpts, editing, paletteColors, openPickerAt }) {
  const input = useInput();
  const phone = input === 'phone';
  const fold = useIslandFit(barRef, { on: input === 'desktop', max: 1 });
  const folded = phone || fold > 0;
  const shape = SHAPES.find((s) => s.id === opts.shape) || SHAPES[0];
  const width = opts.strokeWidth ?? 2;
  const set = (patch) => setOpts({ ...opts, ...patch });

  const groups = [
    <Group key="shape">
      <MenuButton label={tr`Shape: ${ph({ label: shape.label })}`} menuLabel={tr`Shape`} icon={SHAPE_ICONS[shape.id]} text={shape.label}
                  select caret side="above" className="sb-shape" menuClassName={MENU} scrim>
        {SHAPES.map((s) => (
          <MenuItem key={s.id} icon={SHAPE_ICONS[s.id]} label={s.label} radio checked={s.id === shape.id}
                    onSelect={() => set({ shape: s.id })} />
        ))}
      </MenuButton>
    </Group>,
    <Group key="colours" style={phone ? { flexGrow: 2 } : undefined}>
      <MenuButton label={tr`Stroke color`} face={<Chip color={opts.stroke} shape="ring" ink />} side="above"
                  menuClassName={`${MENU} sb-colour-menu`} scrim>
        <ColourRows head={tr`Stroke color`} swatches={STROKE_COLORS} paletteColors={paletteColors} current={opts.stroke}
                    ink recent={editing} onPick={(c) => set({ stroke: c })}
                    onCustom={(e) => openPickerAt(e, {
                      value: opts.stroke, onChange: (c) => set({ stroke: c }), disableRecent: !editing,
                    })} />
      </MenuButton>
      <MenuButton label={tr`Fill`} face={<Chip color={opts.fill} />} side="above"
                  menuClassName={`${MENU} sb-colour-menu`} scrim>
        <ColourRows head={tr`Fill`} clear={tr`No fill`} swatches={FILL_COLORS} paletteColors={paletteColors} current={opts.fill}
                    recent={editing} onPick={(c) => set({ fill: c })}
                    onCustom={(e) => openPickerAt(e, {
                      // The picker's pad can't show 'transparent' (its None
                      // button gives it instead): it starts from a colour.
                      value: opts.fill === 'transparent' ? '#1c1c1f' : opts.fill,
                      onChange: (c) => set({ fill: c }),
                      allowTransparent: true,
                      disableRecent: !editing,
                    })} />
      </MenuButton>
    </Group>,
  ];
  if (folded) {
    groups.push(
      <Group key="more">
        <MenuButton label={tr`More shape options`} icon={MoreHorizontal} side="above" align="end"
                    menuClassName={`${MENU} sb-more`} scrim>
          <WidthRow label={tr`Stroke width`} value={width} onStep={(n) => set({ strokeWidth: clampWidth(n) })} />
          <MenuSep />
          <MenuHead>{tr`Line style`}</MenuHead>
          <DashRows current={opts.dash} onDash={(d) => set({ dash: d })} />
        </MenuButton>
      </Group>,
    );
  } else {
    groups.push(
      <Group key="width"><WidthStep name="Stroke width" value={width} onSet={(n) => set({ strokeWidth: n })} /></Group>,
      <Group key="dash"><DashMenu current={opts.dash} onDash={(d) => set({ dash: d })} /></Group>,
    );
  }
  return (
    <Island barRef={barRef} label={tr`Shape`} onKeyDown={onKeyDown} input={input} className="sb-a">
      {groups}
    </Island>
  );
}

// A picked line's bar (an arrow with no heads): its colour, width, style and
// angle, set through `onChange` (the arrow's patch) and `onAngle`.
export function LineBarA({ barRef, onKeyDown, stroke, width, dash, angle, onAngle, onChange, paletteColors, openPickerAt }) {
  const input = useInput();
  const phone = input === 'phone';
  const fold = useIslandFit(barRef, { on: input === 'desktop', max: 1 });
  const folded = phone || fold > 0;
  const setDash = (d) => onChange({ customDash: d === 'solid' ? null : d });
  const angleField = (
    <span className="tl-step">
      <LineAngleInput angle={angle} onCommit={onAngle} />
      <span className="tl-unit" aria-hidden="true">°</span>
    </span>
  );

  const groups = [
    <Group key="colour">
      <MenuButton label={tr`Line color`} face={<Chip color={stroke} shape="ring" ink />} side="above"
                  menuClassName={`${MENU} ln-colour-menu`} scrim>
        <ColourRows head={tr`Line color`} swatches={STROKE_COLORS} paletteColors={paletteColors} current={stroke}
                    ink onPick={(c) => onChange({ customStroke: c })}
                    onCustom={(e) => openPickerAt(e, { value: stroke, onChange: (c) => onChange({ customStroke: c }) })} />
      </MenuButton>
    </Group>,
    <Group key="width" style={phone ? { flexGrow: 3 } : undefined}>
      <WidthStep name="Line width" value={width} onSet={(n) => onChange({ customStrokeWidth: n })} />
    </Group>,
  ];
  if (folded) {
    groups.push(
      <Group key="more">
        <MenuButton label={tr`More line options`} icon={MoreHorizontal} side="above" align="end"
                    menuClassName={`${MENU} ln-more`} scrim>
          <MenuHead>{tr`Line style`}</MenuHead>
          <DashRows current={dash} onDash={setDash} />
          <MenuSep />
          <div className="tl-mrow is-indent" role="group" aria-label={tr`Angle`}>
            <span className="tl-mrow-l"><Trans>Angle</Trans></span>
            {angleField}
          </div>
        </MenuButton>
      </Group>,
    );
  } else {
    groups.push(
      <Group key="dash"><DashMenu current={dash} onDash={setDash} /></Group>,
      <Group key="angle">{angleField}</Group>,
    );
  }
  return (
    <Island barRef={barRef} label={tr`Line`} onKeyDown={onKeyDown} input={input} className="ln-a">
      {groups}
    </Island>
  );
}

// The arrow tool's bar: the path and the style the next arrow takes.
export function ArrowBarA({ barRef, onKeyDown, options, setOptions }) {
  const input = useInput();
  useIslandFit(barRef, { on: input === 'desktop', max: 0 });
  const set = (patch) => setOptions({ ...options, ...patch });
  return (
    <Island barRef={barRef} label={tr`Arrow`} onKeyDown={onKeyDown} input={input} className="ab-a">
      <Group label={tr`Path`}>
        <Btn text={tr`Curved`} toggle on={!options.straight} onClick={() => set({ straight: false })} />
        <Btn text={tr`Straight`} toggle on={!!options.straight} onClick={() => set({ straight: true })} />
      </Group>
      <Group label={tr`Style`}>
        <Btn text={tr`Solid`} toggle on={!options.dashed} onClick={() => set({ dashed: false })} />
        <Btn text={tr`Dashed`} toggle on={!!options.dashed} onClick={() => set({ dashed: true })} />
      </Group>
    </Island>
  );
}

// A picked arrow's bar (one with heads, or a connector between cards; a free
// line with none is LineBarA's), over the arrow's middle
// (hooks/useArrowPopover.js: its place, Escape, its label field), in the
// look's glass rather than the bottom row's:
//
//   desktop  ● | ═ ═ ═ | — → ↔ | ⌒ ╱ | ┄ | Label… | 🗑
//   iPad     ● | — → ↔ | Label… | ⋯ | 🗑    (⋯: the width, the path, the style)
//   phone    ● | Label… | ⋯ | 🗑           (⋯: the heads as well)
//
// Its colours are the arrow's own (lib/arrowGeometry.js: ink and five more,
// or one from the picker), not a bar's hex swatches.
const WIDTH_PX = [['thin', 2], ['medium', 3], ['thick', 4.5]];
const arrowWidths = () => [['thin', tr`Thin`, 2], ['medium', tr`Medium`, 3], ['thick', tr`Thick`, 4.5]];
const WIDTH_ICONS = Object.fromEntries(WIDTH_PX.map(([id, w]) => [id, function ArrowWidthIcon() { return <WidthFace w={w} />; }]));
const arrowHeads = () => [
  ['none', tr`No arrowheads`, Minus, { head: 'none', bidir: false }],
  ['single', tr`Single arrowhead`, ArrowRight, { head: 'single', bidir: false }],
  ['double', tr`Double arrowhead`, ArrowsHorizontal, { head: 'double', bidir: true }],
];
const pathIcon = (d) => function PathIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};
// A path as one corner to the other, so Straight's face isn't the heads'
// "no heads" line.
const arrowPaths = () => [[false, tr`Curved`, pathIcon('M4 19 Q6.7 6 20 5')], [true, tr`Straight`, pathIcon('M4 19 L20 5')]];
const arrowDashes = () => [[false, tr`Solid`, DASH_ICONS.solid], [true, tr`Dashed`, DASH_ICONS.dashed]];

function ArrowColourRows({ token, custom, onPick, onCustom }) {
  const menu = useMenu();
  return (
    <>
      <MenuHead>{tr`Arrow color`}</MenuHead>
      <div className="tl-swrow" role="group" aria-label={tr`Arrow color`}>
        {ARROW_COLOR_KEYS.map((k) => (
          <Swatch key={k} color={ARROW_COLOR_TOKENS[k]} label={tr`Color ${k}`} role="menuitemradio" aria-checked={token === k}
                  aria-pressed={undefined} tabIndex={-1} on={token === k}
                  onClick={() => { onPick(k); menu?.close('select'); }} />
        ))}
        {custom ? (
          <Swatch color={custom} label={tr`Color ${custom}`} role="menuitemradio" aria-checked aria-pressed={undefined}
                  tabIndex={-1} on onClick={() => menu?.close('select')} />
        ) : null}
        <Swatch add icon={Plus} label={tr`Custom color`} role="menuitem" tabIndex={-1}
                onClick={() => { menu?.close('select'); onCustom(); }} />
      </div>
    </>
  );
}

export function PickedArrowBarA({ arrow, arrowIndex, midPoint, canvasToViewport, onChange, onDelete, onClose, onOpenColorPicker }) {
  const barRef = useRef(null);
  const input = useInput();
  const { pos, labelProps } = useArrowPopover({ arrow, arrowIndex, midPoint, canvasToViewport, onChange, onClose, popRef: barRef });
  if (!arrow) return null;
  const custom = isCustomArrowColor(arrow.color) ? arrow.color : null;
  const token = custom ? null : (arrow.color || 'ink');
  const width = arrow.thickness || 'thin';
  const head = arrowHeadStyle(arrow);
  const straight = !!arrow.straight;
  const dashed = !!arrow.dashed;
  const set = (patch) => onChange?.(patch);
  const setHead = (id) => set(arrowHeads().find((h) => h[0] === id)[3]);

  // A set to pick one of, in the row (toggles, as the arrow tool's bar's
  // pairs are: a radio would keep the arrow keys from the bar) or as one of
  // ⋯'s rows, picked in place, so a phone's menu fits above the bar.
  const radios = (label, rows, now, onPick) => (
    <Group key={label} label={label}>
      {rows.map(([id, name, icon]) => (
        <Btn key={String(id)} icon={icon} label={name} toggle on={now === id} onClick={() => onPick(id)} />
      ))}
    </Group>
  );
  const menuRadios = (label, name, rows, now, onPick) => (
    <div key={label} className="tl-mrow" role="group" aria-label={name}>
      <span className="tl-mrow-l">{label}</span>
      <span className="tl-seg">
        {rows.map(([id, rowName, icon]) => (
          <Btn key={String(id)} icon={icon} label={rowName} role="menuitemradio" aria-checked={now === id} tabIndex={-1}
               on={now === id} onClick={() => onPick(id)} />
        ))}
      </span>
    </div>
  );
  const widthRows = arrowWidths().map(([id, name]) => [id, name, WIDTH_ICONS[id]]);

  const colour = (
    <Group key="colour">
      <MenuButton label={tr`Arrow color`} menuLabel={tr`Arrow color`} side="above"
                  face={<span className="tl-chip is-ring" style={{ '--chip': arrowColor(arrow.color) }} aria-hidden="true" />}
                  menuClassName={`${MENU} pa-colour-menu`} scrim>
        <ArrowColourRows token={token} custom={custom} onPick={(k) => set({ color: k })}
                         onCustom={() => onOpenColorPicker?.(arrow.color)} />
      </MenuButton>
    </Group>
  );
  const heads = radios(tr`Arrow heads`, arrowHeads(), head, setHead);
  const label = (
    <Group key="label">
      <input type="text" className="tl-field pa-label ap-label-input" placeholder={tr`Label…`} {...labelProps} />
    </Group>
  );
  const del = <Group key="delete"><Btn icon={Trash2} label={tr`Delete arrow`} onClick={() => onDelete?.()} /></Group>;

  let groups;
  if (input === 'desktop') {
    groups = [
      colour,
      radios(tr`Width`, widthRows, width, (t) => set({ thickness: t })),
      heads,
      radios(tr`Path`, arrowPaths(), straight, (s) => set({ straight: s })),
      <Group key="dash"><Btn icon={DASH_ICONS.dashed} label={tr`Dashed`} toggle on={dashed} onClick={() => set({ dashed: !dashed })} /></Group>,
      label,
      del,
    ];
  } else {
    const phone = input === 'phone';
    groups = [
      colour,
      phone ? null : heads,
      label,
      <Group key="more">
        <MenuButton label={tr`More arrow options`} menuLabel={tr`More arrow options`} icon={MoreHorizontal} side="above" align="end"
                    menuClassName={`${MENU} pa-more`} scrim>
          {phone ? menuRadios(tr`Heads`, tr`Arrow heads`, arrowHeads(), head, setHead) : null}
          {menuRadios(tr`Width`, tr`Width`, widthRows, width, (t) => set({ thickness: t }))}
          {menuRadios(tr`Path`, tr`Path`, arrowPaths(), straight, (s) => set({ straight: s }))}
          {menuRadios(tr`Style`, tr`Style`, arrowDashes(), dashed, (d) => set({ dashed: d }))}
        </MenuButton>
      </Group>,
      del,
    ];
  }
  return (
    <Toolbar label={tr`Selected arrow`} barRef={barRef} className={`pa-a is-${input === 'desktop' ? 'desk' : input}`}
             style={{ left: pos.x, top: pos.y }}
             onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {groups}
    </Toolbar>
  );
}
