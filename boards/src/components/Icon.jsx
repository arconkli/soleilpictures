// Thin wrapper around lucide-react icons enforcing the project defaults:
//   1.5px stroke, currentColor, displayed as a block.
//   <Icon as={Plus} size={16} />
export function Icon({ as: Component, size = 16, strokeWidth = 1.5, ...rest }) {
  return <Component size={size} strokeWidth={strokeWidth} style={{ display: 'block' }} {...rest} />;
}
