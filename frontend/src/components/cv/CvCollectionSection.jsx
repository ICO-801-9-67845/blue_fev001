import { useState } from "react";
import { createResumeId } from "../../utils/resumeUtils.js";

export default function CvCollectionSection({
  title,
  description,
  itemLabel,
  entries,
  createEmpty,
  prepare = (value) => value,
  validate,
  renderForm,
  renderSummary,
  emptyMessage,
  onChange,
}) {
  const [editingId, setEditingId] = useState(null);
  const [values, setValues] = useState(null);
  const [errors, setErrors] = useState({});

  function openNew() {
    setEditingId(null);
    setValues(createEmpty());
    setErrors({});
  }

  function openEdit(entry) {
    setEditingId(entry.id);
    setValues({ ...entry });
    setErrors({});
  }

  function closeForm() {
    setEditingId(null);
    setValues(null);
    setErrors({});
  }

  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const prepared = prepare(values);
    const nextErrors = validate(prepared);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const entry = { ...prepared, id: editingId || createResumeId() };
    const nextEntries = editingId
      ? entries.map((current) => (current.id === editingId ? entry : current))
      : [...entries, entry];
    onChange(nextEntries);
    closeForm();
  }

  function handleDelete(id) {
    onChange(entries.filter((entry) => entry.id !== id));
    if (editingId === id) closeForm();
  }

  return (
    <section className="cv-editor-section" aria-labelledby={`cv-${itemLabel}-title`}>
      <div className="cv-section-heading">
        <div>
          <p className="eyebrow">Completa a tu ritmo</p>
          <h2 id={`cv-${itemLabel}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
        {!values && (
          <button type="button" className="primary-button" onClick={openNew}>
            Agregar {itemLabel}
          </button>
        )}
      </div>

      {values && (
        <form className="cv-entry-form" onSubmit={handleSubmit} noValidate>
          <h3>{editingId ? `Editar ${itemLabel}` : `Nuevo ${itemLabel}`}</h3>
          {renderForm({ values, setField, setValues, errors })}
          <div className="cv-form-actions">
            <button type="submit" className="primary-button">Guardar</button>
            <button type="button" className="ghost-button" onClick={closeForm}>Cancelar</button>
          </div>
        </form>
      )}

      {entries.length ? (
        <ul className="cv-entry-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <div>{renderSummary(entry)}</div>
              <div className="cv-entry-actions">
                <button type="button" className="ghost-button" onClick={() => openEdit(entry)}>
                  Editar
                </button>
                <button type="button" className="cv-delete-button" onClick={() => handleDelete(entry.id)}>
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !values && <p className="cv-empty-message">{emptyMessage}</p>
      )}
    </section>
  );
}
