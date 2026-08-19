import { useState } from "react";

export default function CvTextListSection({ title, description, singular, values, placeholder, optional = false, onChange }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) {
      setError(`Escribe ${singular === "habilidad" ? "una habilidad" : "un interés"}.`);
      return;
    }
    if (values.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setError("Este elemento ya está en la lista.");
      return;
    }
    onChange([...values, value]);
    setDraft("");
    setError("");
  }

  return (
    <section className="cv-editor-section" aria-labelledby={`cv-${singular}-title`}>
      <div className="cv-section-heading">
        <div>
          <p className="eyebrow">{optional ? "Sección opcional" : "Lo que sabes hacer"}</p>
          <h2 id={`cv-${singular}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <form className="cv-inline-form" onSubmit={handleSubmit} noValidate>
        <div className="cv-field">
          <label htmlFor={`cv-${singular}-input`}>Agregar {singular}</label>
          <input id={`cv-${singular}-input`} value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} placeholder={placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? `cv-${singular}-error` : undefined} />
          {error && <p id={`cv-${singular}-error`} className="cv-field-error">{error}</p>}
        </div>
        <button type="submit" className="primary-button">Agregar</button>
      </form>
      {values.length > 0 && (
        <ul className="cv-chip-list" aria-label={title}>
          {values.map((value) => (
            <li key={value}>
              <span>{value}</span>
              <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Eliminar ${value}`}>×</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
