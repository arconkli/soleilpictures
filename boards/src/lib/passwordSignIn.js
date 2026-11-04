// The one account that signs in with a password instead of an emailed code:
// the demo login for directory reviewers, who cannot read a mailbox. Exact
// match only; everyone else keeps the emailed code.
export const PASSWORD_SIGN_IN = ['review@soleilpictures.com'];

export function usesPassword(email) {
  if (typeof email !== 'string') return false;
  return PASSWORD_SIGN_IN.includes(email.trim().toLowerCase());
}
