// A step-by-step chat with Mapr: one question per step as a Mapr chat
// bubble, big tappable answers under it, and the same frame on every step
// (progress dots, Back, Skip, Close, and an optional footer link). Knows
// nothing about trips -- Plan Your Trip (TripPlannerCard) drives it today,
// and any other flow (e.g. new-user onboarding) can hand it its own steps.
//
// Controlled: the parent owns which step is showing and every answer, so it
// can save them as the user goes and resume later.
//
// step = {
//   id, question, subtitle?,
//   choices?: [{ value, label, icon?, hint? }],   tap = onChoose(value)
//   value?: the currently chosen choice value (highlighted),
//   children?: extra content under the choices (text box, search, summary),
//   next?: { label?, disabled? }                   shows a Next button
//   primary?: { label, onClick, disabled? }        a final action button
//   skippable?: false                              hides Skip on this step
//   status?: short line under the answers ("Locating…", an error)
// }
export default function ChatWizard({
  title,
  steps,
  index,
  onChoose,
  onNext,
  onBack,
  onSkip,
  onClose,
  footer = null,
  className = '',
}) {
  const step = steps[index];
  if (!step) return null;
  const canBack = index > 0;
  const canSkip = !!onSkip && step.skippable !== false;

  return (
    <section className={`chat-wizard ${className}`} aria-label={title}>
      <div className="chat-wizard-top">
        <button
          type="button"
          className="chat-wizard-icon-btn"
          onClick={onBack}
          disabled={!canBack}
          aria-label="Back"
          style={{ visibility: canBack ? 'visible' : 'hidden' }}
        >
          {'\u{2190}'}
        </button>
        <div className="chat-wizard-title">
          <strong>{title}</strong>
          <div className="chat-wizard-dots" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1}>
            {steps.map((s, i) => (
              <span key={s.id} className={`chat-wizard-dot ${i === index ? 'active' : i < index ? 'done' : ''}`} />
            ))}
          </div>
        </div>
        <button type="button" className="chat-wizard-icon-btn" onClick={onClose} aria-label="Close">
          {'\u{2715}'}
        </button>
      </div>

      <div className="chat-wizard-body" key={step.id}>
        <div className="chatlab-msg assistant chat-wizard-question">
          <div className="chatlab-avatar" />
          <div className="chatlab-bubble">
            <p>{step.question}</p>
            {step.subtitle && <p className="chat-wizard-subtitle">{step.subtitle}</p>}
          </div>
        </div>

        {step.choices?.length > 0 && (
          <div className="chat-wizard-choices">
            {step.choices.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`chat-wizard-choice ${step.value === c.value ? 'selected' : ''}`}
                aria-pressed={step.value === c.value}
                title={c.hint}
                disabled={c.disabled}
                onClick={() => onChoose?.(c.value)}
              >
                {c.icon && <span className="chat-wizard-choice-icon">{c.icon}</span>}
                <span className="chat-wizard-choice-text">
                  <span>{c.label}</span>
                  {c.hint && <small>{c.hint}</small>}
                </span>
              </button>
            ))}
          </div>
        )}

        {step.children}

        {step.status && <p className={`chat-wizard-status ${step.statusError ? 'error' : ''}`}>{step.status}</p>}
      </div>

      <div className="chat-wizard-actions">
        {step.primary && (
          <button type="button" className="btn btn-primary btn-block chat-wizard-main" onClick={step.primary.onClick} disabled={step.primary.disabled}>
            {step.primary.label}
          </button>
        )}
        {step.next && (
          <button type="button" className="btn btn-primary btn-block chat-wizard-main" onClick={onNext} disabled={step.next.disabled}>
            {step.next.label || 'Next'} {'\u{2192}'}
          </button>
        )}
        <div className="chat-wizard-links">
          {canSkip && (
            <button type="button" className="chat-wizard-link" onClick={onSkip}>
              Skip
            </button>
          )}
          {footer}
        </div>
      </div>
    </section>
  );
}
