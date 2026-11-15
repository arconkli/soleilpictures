// Who you are signed in as, with a Sign out button beside it. It sits first on
// Profile and first on the phone's Settings list, because a person with a
// second email had no visible way out and deleted the account instead.
// Renders nothing where there is no sign-out to offer.
import { t as tr } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
export default function AccountBox({ email, onSignOut, hint = false }) {
  if (!onSignOut) return null;
  const who = email || tr`this account`;
  return (
    <>
      <div className="settings-account">
        <div className="settings-account-text">
          <span className="settings-account-label"><Trans>Signed in as</Trans></span>
          <span className="settings-account-email" title={who}>{who}</span>
        </div>
        <button type="button" className="settings-btn settings-account-signout"
                onClick={onSignOut}><Trans>Sign out</Trans></button>
      </div>
      {hint && (
        <p className="settings-account-hint">
          <Trans>Have another email too? Sign out, then sign in with that one. Nothing here is deleted.</Trans>
        </p>
      )}
    </>
  );
}
