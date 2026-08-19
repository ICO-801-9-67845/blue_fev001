import CvCollectionSection from "./CvCollectionSection.jsx";
import { createResumeEntry, validateDateRange } from "../../utils/resumeUtils.js";

function ErrorMessage({ id, message }) {
  return message ? <p id={id} className="cv-field-error">{message}</p> : null;
}

export function CvProjectsSection({ entries, onChange }) {
  return (
    <CvCollectionSection
      title="Proyectos"
      description="Los proyectos escolares, personales o colaborativos también demuestran lo que sabes hacer."
      itemLabel="proyecto"
      entries={entries}
      createEmpty={() => createResumeEntry("projects")}
      validate={(values) => !values.name.trim() ? { name: "Escribe el nombre del proyecto." } : {}}
      emptyMessage="Agrega un proyecto que te haya permitido practicar, crear o resolver algo."
      onChange={onChange}
      renderSummary={(entry) => <><strong>{entry.name}</strong>{entry.role && <span>{entry.role}</span>}{entry.description && <small>{entry.description}</small>}</>}
      renderForm={({ values, setField, errors }) => (
        <div className="cv-form-grid">
          <div className="cv-field"><label htmlFor="project-name">Nombre del proyecto *</label><input id="project-name" value={values.name} onChange={(e) => setField("name", e.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "project-name-error" : undefined} /><ErrorMessage id="project-name-error" message={errors.name} /></div>
          <div className="cv-field"><label htmlFor="project-role">Rol o participación</label><input id="project-role" value={values.role} onChange={(e) => setField("role", e.target.value)} placeholder="Ej. Desarrollador frontend" /></div>
          <div className="cv-field cv-field-wide"><label htmlFor="project-description">Qué hiciste / descripción</label><textarea id="project-description" rows="4" value={values.description} onChange={(e) => setField("description", e.target.value)} /></div>
          <div className="cv-field"><label htmlFor="project-technologies">Tecnologías o habilidades</label><input id="project-technologies" value={values.technologies} onChange={(e) => setField("technologies", e.target.value)} placeholder="Ej. React, diseño, trabajo en equipo" /></div>
          <div className="cv-field"><label htmlFor="project-result">Resultado <span>(opcional)</span></label><input id="project-result" value={values.result} onChange={(e) => setField("result", e.target.value)} /></div>
        </div>
      )}
    />
  );
}

export function CvVolunteeringSection({ entries, onChange }) {
  return (
    <CvCollectionSection
      title="Voluntariado"
      description="Incluye participación comunitaria, estudiantil o en organizaciones."
      itemLabel="voluntariado"
      entries={entries}
      createEmpty={() => createResumeEntry("volunteering")}
      validate={(values) => ({
        ...(!values.organization.trim() ? { organization: "Escribe la organización o actividad." } : {}),
        ...validateDateRange(values.startDate, values.endDate),
      })}
      emptyMessage="Esta sección es opcional. Puedes agregarla cuando represente bien tu participación."
      onChange={onChange}
      renderSummary={(entry) => <><strong>{entry.organization}</strong>{entry.role && <span>{entry.role}</span>}{entry.description && <small>{entry.description}</small>}</>}
      renderForm={({ values, setField, errors }) => (
        <div className="cv-form-grid">
          <div className="cv-field"><label htmlFor="volunteering-organization">Organización o actividad *</label><input id="volunteering-organization" value={values.organization} onChange={(e) => setField("organization", e.target.value)} aria-invalid={Boolean(errors.organization)} aria-describedby={errors.organization ? "volunteering-organization-error" : undefined} /><ErrorMessage id="volunteering-organization-error" message={errors.organization} /></div>
          <div className="cv-field"><label htmlFor="volunteering-role">Rol o participación</label><input id="volunteering-role" value={values.role} onChange={(e) => setField("role", e.target.value)} /></div>
          <div className="cv-field cv-field-wide"><label htmlFor="volunteering-description">Descripción</label><textarea id="volunteering-description" rows="4" value={values.description} onChange={(e) => setField("description", e.target.value)} /></div>
          <div className="cv-field"><label htmlFor="volunteering-start">Fecha de inicio</label><input id="volunteering-start" type="month" value={values.startDate} onChange={(e) => setField("startDate", e.target.value)} /></div>
          <div className="cv-field"><label htmlFor="volunteering-end">Fecha final</label><input id="volunteering-end" type="month" value={values.endDate} onChange={(e) => setField("endDate", e.target.value)} aria-invalid={Boolean(errors.endDate)} aria-describedby={errors.endDate ? "volunteering-end-error" : undefined} /><ErrorMessage id="volunteering-end-error" message={errors.endDate} /></div>
        </div>
      )}
    />
  );
}

export function CvExperienceSection({ entries, onChange }) {
  return (
    <CvCollectionSection
      title="Experiencia laboral"
      description="Es completamente opcional. Tu educación, proyectos y habilidades también cuentan tu historia."
      itemLabel="experiencia"
      entries={entries}
      createEmpty={() => createResumeEntry("experience")}
      prepare={(values) => ({ ...values, endDate: values.current ? "" : values.endDate })}
      validate={(values) => ({
        ...(!values.company.trim() ? { company: "Escribe la empresa u organización." } : {}),
        ...(!values.position.trim() ? { position: "Escribe el puesto o participación." } : {}),
        ...validateDateRange(values.startDate, values.endDate, values.current),
      })}
      emptyMessage="No necesitas experiencia laboral para continuar con tu CV."
      onChange={onChange}
      renderSummary={(entry) => <><strong>{entry.position}</strong><span>{entry.company}</span><small>{entry.startDate || "Sin fecha inicial"} — {entry.current ? "Actualidad" : entry.endDate || "Sin fecha final"}</small></>}
      renderForm={({ values, setField, setValues, errors }) => (
        <div className="cv-form-grid">
          <div className="cv-field"><label htmlFor="experience-company">Empresa u organización *</label><input id="experience-company" value={values.company} onChange={(e) => setField("company", e.target.value)} aria-invalid={Boolean(errors.company)} aria-describedby={errors.company ? "experience-company-error" : undefined} /><ErrorMessage id="experience-company-error" message={errors.company} /></div>
          <div className="cv-field"><label htmlFor="experience-position">Puesto o participación *</label><input id="experience-position" value={values.position} onChange={(e) => setField("position", e.target.value)} aria-invalid={Boolean(errors.position)} aria-describedby={errors.position ? "experience-position-error" : undefined} /><ErrorMessage id="experience-position-error" message={errors.position} /></div>
          <div className="cv-field"><label htmlFor="experience-start">Fecha de inicio</label><input id="experience-start" type="month" value={values.startDate} onChange={(e) => setField("startDate", e.target.value)} /></div>
          <div className="cv-field"><label htmlFor="experience-end">Fecha final</label><input id="experience-end" type="month" value={values.endDate} disabled={values.current} onChange={(e) => setField("endDate", e.target.value)} aria-invalid={Boolean(errors.endDate)} aria-describedby={errors.endDate ? "experience-end-error" : undefined} /><ErrorMessage id="experience-end-error" message={errors.endDate} /></div>
          <label className="cv-checkbox cv-field-wide"><input type="checkbox" checked={values.current} onChange={(e) => setValues((current) => ({ ...current, current: e.target.checked, endDate: e.target.checked ? "" : current.endDate }))} />Actualmente trabajo aquí</label>
          <div className="cv-field cv-field-wide"><label htmlFor="experience-responsibilities">Responsabilidades o logros</label><textarea id="experience-responsibilities" rows="4" value={values.responsibilities} onChange={(e) => setField("responsibilities", e.target.value)} /></div>
        </div>
      )}
    />
  );
}
