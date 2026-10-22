// Reserve an upload's bytes in its owner's storage before the object is
// written (0610). record_upload_intent checks the space of the owner of the
// key's workspace and records the upload under one lock per owner, so two
// uploads racing for the last of the space can't both land. The authorize_*
// check that runs first stays for its wording; this is the check that holds.
//
// It fails CLOSED: anything but a reservation means nothing is written. The
// images row written afterwards claims the intent (images_size_from_intent).
//
// `rpc(fn, params)` calls the database as the uploader — never the service
// key, or the write check inside record_upload_intent would answer for nobody.
// Returns 'reserved', 'full' (no room, or another upload took it first) or
// 'unavailable' (the call failed).
export async function reserveUploadSpace(rpc, { key, bytes, boardId = null }) {
  let ok = null;
  try {
    ok = await rpc('record_upload_intent', { p_key: key, p_bytes: bytes, p_kind: 'put', p_board_id: boardId });
  } catch (_) {
    ok = null;
  }
  if (ok === true) return 'reserved';
  return ok === false ? 'full' : 'unavailable';
}
