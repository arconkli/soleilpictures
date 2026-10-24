import { IconWeightContext } from '../Icon.jsx';
import { Btn, Group, Swatch } from './Toolbar.jsx';
import { MenuButton, MenuHead, MenuItem, MenuSep } from './Menu.jsx';
import { Chip, ColourRows, colourChoices, inkBg } from './Colours.jsx';
import { useIslandFit } from './useIslandFit.js';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { useRecentColors } from '../../hooks/useRecentColors.js';
import { addRecentColor } from '../../lib/recentColors.js';
import { BrushPreview, BRUSH_LABELS, BRUSH_ORDER } from '../BrushPreview.jsx';
import { DEFAULT_BRUSH } from '../../lib/strokeModel.js';
import { DASH_STYLES, SHAPES } from '../../lib/shapeOptions.js';
import { DRAW_THICKNESS, FILL_COLORS, LineAngleInput, LinePxInput, STROKE_COLORS } from '../ToolOptionsBar.jsx';
import {
  ArrowRight, Circle, CornersOut, DiamondShape, Eraser, HandPointing, Hexagon, Lasso, LineSegment, Minus,
  MoreHorizontal, PenNib, Plus, Square, Star, Triangle, Undo,
} from '../../lib/icons.js';

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
//
// A desktop window too narrow for a row folds it a step at a time
// (useIslandFit): the draw bar's brushes into a menu, then its colours, then
// the brush, the colour and the width into one chip, as under a finger; the
// shape and line bars' width and style into ⋯, as on a phone. The eraser
// keeps only its sizes, and the lasso only what it does.
//
// ToolOptionsBar works each as it works today's: what's set (the draw tool's
// options, a shape's, a line's), what a control sets, and the bar's keys
// (onKeyDown: one Tab stop, the arrows along it). Each menu takes the press
// that closes it (Menu's scrim), so it doesn't also draw or place a shape.

const MENU = 'tob-menu';
// The draw bar's own colours, A-draw's nine: white, a grey, black, then
// today's bar's.
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
      <span className="tl-mrow-l">Width</span>
      <span className="tl-seg">
        <Btn icon={Minus} label={`Decrease ${what}`} role="menuitem" tabIndex={-1} onClick={() => onStep(value - 1)} />
        <span className="tl-mval" aria-live="polite">{value}</span>
        <Btn icon={Plus} label={`Increase ${what}`} role="menuitem" tabIndex={-1} onClick={() => onStep(value + 1)} />
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
      <Btn icon={Minus} label={`Decrease ${what}`} onClick={() => onSet(clampWidth(value - 1))} />
      <LinePxInput look value={value} label={name} onCommit={onSet} />
      <Btn icon={Plus} label={`Increase ${what}`} onClick={() => onSet(clampWidth(value + 1))} />
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
    <MenuButton label={`Line style: ${now.label}`} menuLabel="Line style" text={now.label} select caret side="above"
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
  const widthName = (w) => (isEraser ? `Eraser size ${w}` : `Stroke width ${w}`);
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
    <MenuButton label={`Brush: ${BRUSH_LABELS[brush]}`} menuLabel="Brush" face={<BrushFace id={brush} />} caret
                side="above" className="db-brush" menuClassName={`${MENU} db-brush-menu`} scrim>
      {BRUSH_ORDER.map((id) => (
        <MenuItem key={id} icon={BRUSH_ICONS[id]} label={BRUSH_LABELS[id]} radio checked={brush === id}
                  onSelect={() => set({ brush: id })} />
      ))}
    </MenuButton>
  );
  const colourRows = (
    <ColourRows head="Color" swatches={DRAW_COLORS} paletteColors={paletteColors} current={color} ink
                onPick={(c) => set({ color: c })} onCustom={customColour} />
  );
  // The chip under a finger (and a desktop's row folded all the way): what
  // it draws with, as a dot of its colour as wide as its width, and a menu
  // of the three, the brush and the width picked in place.
  const chipName = isEraser ? 'Eraser size' : 'Brush, color and width';
  const chip = (
    <MenuButton label={chipName} caret side="above" align="center" className="db-chip"
                menuClassName={`${MENU} db-menu`} scrim
                face={<span className={isEraser ? 'db-dot is-eraser' : 'db-dot'}
                            style={{ '--chip': inkBg(color), '--d': `${Math.min(16, Math.max(8, width + 4))}px` }} />}>
      {inking && (
        <>
          <MenuHead>Brush</MenuHead>
          <div className="db-row" role="group" aria-label="Brush">
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
      <MenuHead>{isEraser ? 'Eraser size' : 'Width'}</MenuHead>
      <div className="db-row" role="group" aria-label={isEraser ? 'Eraser size' : 'Width'}>
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
    groups.push(<Group key="undo"><Btn icon={Undo} label="Undo" keys="Mod+Z" onClick={onUndo} /></Group>);
  }
  groups.push(
    <Group key="modes" style={share(stylus ? 4 : 3)}>
      {mode('pen', PenNib, 'Pen', inking)}
      {mode('eraser', Eraser, 'Eraser', isEraser)}
      {mode('lasso', Lasso, 'Lasso', isLasso, 'Lasso: circle strokes to select them')}
      {/* Only once the device has shown it has a stylus: before that the
          finger is the only way to draw (lib/pointerPolicy.js). */}
      {stylus && (
        <Btn icon={HandPointing} label="Draw with finger" toggle on={fingerDraws} onClick={onFinger}
             tip={fingerDraws ? 'Your finger draws. Turn off to let it pan while the stylus draws.'
               : 'Your finger pans and only the stylus draws. Turn on to draw with either.'} />
      )}
    </Group>,
  );
  if (inking && level === 0) {
    groups.push(
      <Group key="brushes">
        {BRUSH_ORDER.map((id) => (
          <Btn key={id} label={`${BRUSH_LABELS[id]} brush`} tip={BRUSH_LABELS[id]} toggle on={brush === id}
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
          <Swatch key={c} color={inkBg(c)} label={`Color ${c}`} on={color === c}
                  onClick={() => { set({ color: c }); addRecentColor(c); }} />
        ))}
        <Swatch add icon={Plus} label="Custom color" onClick={customColour} />
      </Group>,
    );
  }
  if (inking && level === 2) {
    groups.push(
      <Group key="brush">
        {brushMenu}
        <MenuButton label={`Color: ${color}`} menuLabel="Color" face={<Chip color={color} shape="dot" ink />} caret
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
          <Btn key={w} label={widthName(w)} tip={`${w}px`} toggle on={width === w} className="db-width"
               onClick={() => setWidth(w)}>
            <WidthFace w={w} />
          </Btn>
        ))}
      </Group>,
    );
  }
  if (!isLasso && level === 3) groups.push(<Group key="chip">{chip}</Group>);
  if (isLasso && !phone) groups.push(<Group key="hint"><span className="db-hint">Circle strokes to select</span></Group>);
  if (onOpenSketchpad) {
    groups.push(
      <Group key="canvas">
        <Btn icon={CornersOut} text={canvasWords ? 'Canvas' : undefined} label="Open a fullscreen drawing canvas"
             tip="Open a fullscreen drawing canvas" className="tob-canvas-btn" onClick={onOpenSketchpad} />
      </Group>,
    );
  }
  return (
    <Island barRef={barRef} label="Drawing" onKeyDown={onKeyDown} input={input} className="db-a">
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
      <MenuButton label={`Shape: ${shape.label}`} menuLabel="Shape" icon={SHAPE_ICONS[shape.id]} text={shape.label}
                  select caret side="above" className="sb-shape" menuClassName={MENU} scrim>
        {SHAPES.map((s) => (
          <MenuItem key={s.id} icon={SHAPE_ICONS[s.id]} label={s.label} radio checked={s.id === shape.id}
                    onSelect={() => set({ shape: s.id })} />
        ))}
      </MenuButton>
    </Group>,
    <Group key="colours" style={phone ? { flexGrow: 2 } : undefined}>
      <MenuButton label="Stroke color" face={<Chip color={opts.stroke} shape="ring" ink />} side="above"
                  menuClassName={`${MENU} sb-colour-menu`} scrim>
        <ColourRows head="Stroke color" swatches={STROKE_COLORS} paletteColors={paletteColors} current={opts.stroke}
                    ink recent={editing} onPick={(c) => set({ stroke: c })}
                    onCustom={(e) => openPickerAt(e, {
                      value: opts.stroke, onChange: (c) => set({ stroke: c }), disableRecent: !editing,
                    })} />
      </MenuButton>
      <MenuButton label="Fill" face={<Chip color={opts.fill} />} side="above"
                  menuClassName={`${MENU} sb-colour-menu`} scrim>
        <ColourRows head="Fill" clear="No fill" swatches={FILL_COLORS} paletteColors={paletteColors} current={opts.fill}
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
        <MenuButton label="More shape options" icon={MoreHorizontal} side="above" align="end"
                    menuClassName={`${MENU} sb-more`} scrim>
          <WidthRow label="Stroke width" value={width} onStep={(n) => set({ strokeWidth: clampWidth(n) })} />
          <MenuSep />
          <MenuHead>Line style</MenuHead>
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
    <Island barRef={barRef} label="Shape" onKeyDown={onKeyDown} input={input} className="sb-a">
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
      <LineAngleInput look angle={angle} onCommit={onAngle} />
      <span className="tl-unit" aria-hidden="true">°</span>
    </span>
  );

  const groups = [
    <Group key="colour">
      <MenuButton label="Line color" face={<Chip color={stroke} shape="ring" ink />} side="above"
                  menuClassName={`${MENU} ln-colour-menu`} scrim>
        <ColourRows head="Line color" swatches={STROKE_COLORS} paletteColors={paletteColors} current={stroke}
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
        <MenuButton label="More line options" icon={MoreHorizontal} side="above" align="end"
                    menuClassName={`${MENU} ln-more`} scrim>
          <MenuHead>Line style</MenuHead>
          <DashRows current={dash} onDash={setDash} />
          <MenuSep />
          <div className="tl-mrow is-indent" role="group" aria-label="Angle">
            <span className="tl-mrow-l">Angle</span>
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
    <Island barRef={barRef} label="Line" onKeyDown={onKeyDown} input={input} className="ln-a">
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
    <Island barRef={barRef} label="Arrow" onKeyDown={onKeyDown} input={input} className="ab-a">
      <Group label="Path">
        <Btn text="Curved" toggle on={!options.straight} onClick={() => set({ straight: false })} />
        <Btn text="Straight" toggle on={!!options.straight} onClick={() => set({ straight: true })} />
      </Group>
      <Group label="Style">
        <Btn text="Solid" toggle on={!options.dashed} onClick={() => set({ dashed: false })} />
        <Btn text="Dashed" toggle on={!!options.dashed} onClick={() => set({ dashed: true })} />
      </Group>
    </Island>
  );
}
