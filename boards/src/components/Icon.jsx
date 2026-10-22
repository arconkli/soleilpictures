import { createContext, useContext } from 'react';
import { shownWeight } from '../lib/iconWeight.js';

// Thin wrapper around @phosphor-icons/react enforcing the project defaults:
//   thin weight, currentColor, displayed as a block.
//   <Icon as={Plus} size={16} />
//
// Phosphor's "weight" prop (thin / light / regular / bold / fill / duotone)
// replaces lucide's strokeWidth. Callsites that still pass strokeWidth get
// it dropped silently — Phosphor would forward it to the SVG and produce
// an unintended visual change.

// A floor for the icons inside: a surface in the files sidebar's look gives
// 'regular' (lib/iconWeight.js). Unset everywhere else, so nothing changes.
export const IconWeightContext = createContext(null);

export function Icon({ as: Component, size = 16, weight = 'thin', strokeWidth, ...rest }) {
  const floor = useContext(IconWeightContext);
  return <Component size={size} weight={shownWeight(weight, floor)} style={{ display: 'block' }} {...rest} />;
}
