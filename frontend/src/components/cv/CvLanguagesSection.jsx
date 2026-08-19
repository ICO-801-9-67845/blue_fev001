import CvCollectionSection from "./CvCollectionSection.jsx";
import { createResumeEntry, LANGUAGE_LEVELS } from "../../utils/resumeUtils.js";

export default function CvLanguagesSection({ entries, onChange }) {
  return (
    <CvCollectionSection
      title="Idiomas"
      description="Indica de forma sencilla los idiomas que utilizas y tu nivel actual."
      itemLabel="idioma"
      entries={entries}
      createEmpty={() => createResumeEntry("languages")}
      validate={(values) => ({
        ...(!values.language.trim() ? { language: "Escribe el idioma." } : {}),
        ...(!LANGUAGE_LEVELS.includes(values.level) ? { level: "Selecciona un nivel válido." } : {}),
      })}
      emptyMessage="Agrega los idiomas que quieras mostrar en tu CV."
      onChange={onChange}
      renderSummary={(entry) => <><strong>{entry.language}</strong><span>{entry.level}</span></>}
      renderForm={({ values, setField, errors }) => (
        <div className="cv-form-grid">
          <div className="cv-field">
            <label htmlFor="language-name">Idioma *</label>
            <input id="language-name" value={values.language} onChange={(event) => setField("language", event.target.value)} aria-invalid={Boolean(errors.language)} aria-describedby={errors.language ? "language-name-error" : undefined} />
            {errors.language && <p id="language-name-error" className="cv-field-error">{errors.language}</p>}
          </div>
          <div className="cv-field">
            <label htmlFor="language-level">Nivel *</label>
            <select id="language-level" value={values.level} onChange={(event) => setField("level", event.target.value)} aria-invalid={Boolean(errors.level)} aria-describedby={errors.level ? "language-level-error" : undefined}>
              {LANGUAGE_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
            {errors.level && <p id="language-level-error" className="cv-field-error">{errors.level}</p>}
          </div>
        </div>
      )}
    />
  );
}
