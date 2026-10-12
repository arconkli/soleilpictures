// AdminToggle — brand-coloured iOS-style on/off switch for admin config flags.
//
// Inline styles only (no shared CSS) so it stands alone. role="switch" +
// aria-checked keeps it accessible. Shared by the Campaign (ad instant demo)
// and Waitlist (master gate) tabs — pass a descriptive `label` for the a11y name.

export function ToggleSwitch({ checked, onClick, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        position: 'relative',
        width: 56, height: 32, flex: '0 0 auto',
        borderRadius: 999,
        // Theme tokens, not white-alpha: on the light page a white wash drew
        // no track at all, leaving a lone white knob that did not read as a
        // switch. --line-3 is a visible mid-grey in both themes.
        border: '1px solid var(--line-3)',
        background: checked ? 'var(--soleil, #ffb000)' : 'var(--line-3)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background .18s ease',
        padding: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', top: 3, left: checked ? 27 : 3,
          width: 24, height: 24, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.45)',
          transition: 'left .18s ease',
        }}
      />
    </button>
  );
}
