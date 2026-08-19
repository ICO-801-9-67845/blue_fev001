import CvCollectionSection from "./CvCollectionSection.jsx";
import { createResumeEntry, validateDateRange } from "../../utils/resumeUtils.js";

function ErrorMessage({ id, message }) {
  return message ? <p id={id} className="cv-field-error">{message}</p> : null;
}

export function CvEducationSection({ entries, onChange }) {
  return (
    <CvCollectionSection
      title="Educación"
      description="Agrega tus estudios actuales y anteriores, comenzando por los más relevantes."
      itemLabel="estudio"
      entries={entries}
      createEmpty={() => createResumeEntry("education")}
      prepare={(values) => ({ ...values, endDate: values.current ? "" : values.endDate })}
      validate={(values) => ({
        ...(!values.institution.trim() ? { institution: "Escribe la institución." } : {}),
        ...(!values.program.trim() ? { program: "Escribe el programa o carrera." } : {}),
        ...validateDateRange(values.startDate, values.endDate, values.current),
      })}
      emptyMessage="Agrega tu escuela, universidad, carrera técnica u otra formación."
      onChange={onChange}
      renderSummary={(entry) => <><strong>{entry.program}</strong><span>{entry.institution}</span><small>{entry.startDate || "Sin fecha inicial"} — {entry.current ? "Actualidad" : entry.endDate || "Sin fecha final"}</small></>}
      renderForm={({ values, setField, setValues, errors }) => (
        <div className="cv-form-grid">
          <div className="cv-field"><label htmlFor="education-institution">Institución *</label><input id="education-institution" value={values.institution} onChange={(e) => setField("institution", e.target.value)} aria-invalid={Boolean(errors.institution)} aria-describedby={errors.institution ? "education-institution-error" : undefined} /><ErrorMessage id="education-institution-error" message={errors.institution} /></div>
          <div className="cv-field"><label htmlFor="education-program">Programa o carrera *</label><input id="education-program" value={values.program} onChange={(e) => setField("program", e.target.value)} aria-invalid={Boolean(errors.program)} aria-describedby={errors.program ? "education-program-error" : undefined} /><ErrorMessage id="education-program-error" message={errors.program} /></div>
          <div className="cv-field"><label htmlFor="education-start">Fecha de inicio</label><input id="education-start" type="month" value={values.startDate} onChange={(e) => setField("startDate", e.target.value)} /></div>
          <div className="cv-field"><label htmlFor="education-end">Fecha de finalización</label><input id="education-end" type="month" value={values.endDate} disabled={values.current} onChange={(e) => setField("endDate", e.target.value)} aria-invalid={Boolean(errors.endDate)} aria-describedby={errors.endDate ? "education-end-error" : undefined} /><ErrorMessage id="education-end-error" message={errors.endDate} /></div>
          <label className="cv-checkbox cv-field-wide"><input type="checkbox" checked={values.current} onChange={(e) => setValues((current) => ({ ...current, current: e.target.checked, endDate: e.target.checked ? "" : current.endDate }))} />Actualmente estudio aquí</label>
        </div>
      )}
    />
  );
}

export function CvCoursesSection({ entries, onChange }) {
  return (
    <CvCollectionSection
      title="Cursos"
      description="Incluye cursos que aporten contexto a tus habilidades o al puesto que buscas."
      itemLabel="curso"
      entries={entries}
      createEmpty={() => createResumeEntry("courses")}
      validate={(values) => !values.name.trim() ? { name: "Escribe el nombre del curso." } : {}}
      emptyMessage="Puedes agregar cursos en línea, talleres o capacitaciones."
      onChange={onChange}
      renderSummary={(entry) => <><strong>{entry.name}</strong>{entry.institution && <span>{entry.institution}</span>}{entry.date && <small>{entry.date}</small>}</>}
      renderForm={({ values, setField, errors }) => (
        <div className="cv-form-grid">
          <div className="cv-field"><label htmlFor="course-name">Nombre del curso *</label><input id="course-name" value={values.name} onChange={(e) => setField("name", e.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "course-name-error" : undefined} /><ErrorMessage id="course-name-error" message={errors.name} /></div>
          <div className="cv-field"><label htmlFor="course-institution">Institución</label><input id="course-institution" value={values.institution} onChange={(e) => setField("institution", e.target.value)} /></div>
          <div className="cv-field"><label htmlFor="course-date">Fecha <span>(opcional)</span></label><input id="course-date" type="month" value={values.date} onChange={(e) => setField("date", e.target.value)} /></div>
        </div>
      )}
    />
  );
}

export function CvCertificationsSection({ entries, onChange }) {
  return (
    <CvCollectionSection
      title="Certificaciones"
      description="Registra credenciales o certificaciones relevantes que ya obtuviste."
      itemLabel="certificación"
      entries={entries}
      createEmpty={() => createResumeEntry("certifications")}
      validate={(values) => !values.name.trim() ? { name: "Escribe el nombre de la certificación." } : {}}
      emptyMessage="Esta sección es opcional. Agrégala cuando tengas una certificación relevante."
      onChange={onChange}
      renderSummary={(entry) => <><strong>{entry.name}</strong>{entry.issuer && <span>{entry.issuer}</span>}{entry.date && <small>{entry.date}</small>}</>}
      renderForm={({ values, setField, errors }) => (
        <div className="cv-form-grid">
          <div className="cv-field"><label htmlFor="certification-name">Nombre *</label><input id="certification-name" value={values.name} onChange={(e) => setField("name", e.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "certification-name-error" : undefined} /><ErrorMessage id="certification-name-error" message={errors.name} /></div>
          <div className="cv-field"><label htmlFor="certification-issuer">Emisor</label><input id="certification-issuer" value={values.issuer} onChange={(e) => setField("issuer", e.target.value)} /></div>
          <div className="cv-field"><label htmlFor="certification-date">Fecha</label><input id="certification-date" type="month" value={values.date} onChange={(e) => setField("date", e.target.value)} /></div>
        </div>
      )}
    />
  );
}
