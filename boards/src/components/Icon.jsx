// Thin wrapper around @phosphor-icons/react enforcing the project defaults:
//   thin weight, currentColor, displayed as a block.
//   <Icon as={Plus} size={16} />
//
// Phosphor's "weight" prop (thin / light / regular / bold / fill / duotone)
// replaces lucide's strokeWidth. Callsites that still pass strokeWidth get
// it dropped silently — Phosphor would forward it to the SVG and produce
// an unintended visual change.
export function Icon({ as: Component, size = 16, weight = 'thin', strokeWidth, ...rest }) {
  return <Component size={size} weight={weight} style={{ display: 'block' }} {...rest} />;
}
