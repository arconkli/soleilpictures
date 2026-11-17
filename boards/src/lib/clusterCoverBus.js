// A cluster's custom colour and custom thumbnail, from anywhere. A right-click
// menu on any surface asks with these; the picker, the file input and the crop
// modal are mounted once at the app level (components/ClusterCoverHost.jsx in
// App.jsx), the same no-prop-drilling shape as lib/infoBus.js.
//
//   openClusterColor({ id, x, y })   the full colour picker for that cluster, at x,y
//   openClusterThumb({ id })         the file dialog, then the crop, for its thumbnail
//
// Without a host mounted (public pages) both do nothing.

export const CLUSTER_COLOR_EVENT = 'soleil-open-cluster-color';
export const CLUSTER_THUMB_EVENT = 'soleil-open-cluster-thumb';

export function openClusterColor({ id, x = 0, y = 0 } = {}) {
  if (typeof document === 'undefined' || !id) return;
  document.dispatchEvent(new CustomEvent(CLUSTER_COLOR_EVENT, { detail: { id, x, y } }));
}

export function openClusterThumb({ id } = {}) {
  if (typeof document === 'undefined' || !id) return;
  document.dispatchEvent(new CustomEvent(CLUSTER_THUMB_EVENT, { detail: { id } }));
}
