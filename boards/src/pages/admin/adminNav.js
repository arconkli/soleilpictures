// adminNav — one admin tab asking another to open something.
//
// openAdminUser({ user_id, email }) takes the admin to Users with that person
// open (Analytics › Sharing's top sharers, a face on a profile's Sharing). The
// person is parked here until the Users tab takes it: on mount when the tab is
// switched to, or on 'admin:open-user' when it is already showing.

let pendingUser = null;

export function openAdminUser(person) {
  if (!person?.user_id) return;
  pendingUser = { user_id: person.user_id, email: person.email || null };
  window.dispatchEvent(new CustomEvent('admin:navigate', { detail: { tab: 'users' } }));
  window.dispatchEvent(new CustomEvent('admin:open-user'));
}

export function takePendingUser() {
  const p = pendingUser;
  pendingUser = null;
  return p;
}
