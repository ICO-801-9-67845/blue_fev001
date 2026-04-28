import { Link } from "react-router-dom";

export default function AuthForm({
  title,
  subtitle,
  fields,
  submitLabel,
  footerText,
  footerLink,
  footerLabel,
  onChange,
  onSubmit,
  values,
  error,
  loading,
}) {
  return (
    <div className="auth-card">
      <div className="auth-brand">
        <span className="auth-brand-badge">Blue FEV</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <form className="auth-form" onSubmit={onSubmit}>
        {fields.map((field) => (
          <label className="form-field" key={field.name}>
            <span>{field.label}</span>
            <input
              name={field.name}
              type={field.type}
              placeholder={field.placeholder}
              value={values[field.name]}
              onChange={onChange}
              autoComplete={field.autoComplete}
              required
            />
          </label>
        ))}

        {error ? <div className="form-error">{error}</div> : null}

        <button className="primary-button auth-submit" type="submit" disabled={loading}>
          {loading ? "Procesando..." : submitLabel}
        </button>
      </form>

      <p className="auth-footer">
        {footerText} <Link to={footerLink}>{footerLabel}</Link>
      </p>
    </div>
  );
}
