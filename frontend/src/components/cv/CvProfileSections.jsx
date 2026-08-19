import { useState } from "react";
import { validateBasics } from "../../utils/resumeUtils.js";

function FieldError({ id, children }) {
  return children ? <p id={id} className="cv-field-error">{children}</p> : null;
}

export function CvBasicsSection({ values, onChange }) {
  const [touched, setTouched] = useState({});
  const errors = validateBasics(values);

  function update(field, value) {
    onChange({ ...values, [field]: value });
  }

  function describedBy(field) {
    return touched[field] && errors[field] ? `cv-${field}-error` : undefined;
  }

  return (
    <section className="cv-editor-section" aria-labelledby="cv-basics-title">
      <div className="cv-section-heading">
        <div>
          <p className="eyebrow">Empecemos contigo</p>
          <h2 id="cv-basics-title">Información personal</h2>
          <p>Incluye solamente los datos necesarios para que puedan contactarte.</p>
        </div>
      </div>
      <div className="cv-form-grid">
        <div className="cv-field cv-field-wide">
          <label htmlFor="cv-full-name">Nombre completo *</label>
          <input id="cv-full-name" value={values.fullName} onChange={(e) => update("fullName", e.target.value)} onBlur={() => setTouched((current) => ({ ...current, fullName: true }))} aria-invalid={Boolean(describedBy("fullName"))} aria-describedby={describedBy("fullName")} autoComplete="name" />
          <FieldError id="cv-fullName-error">{touched.fullName && errors.fullName}</FieldError>
        </div>
        <div className="cv-field">
          <label htmlFor="cv-email">Correo electrónico</label>
          <input id="cv-email" type="email" value={values.email} onChange={(e) => update("email", e.target.value)} onBlur={() => setTouched((current) => ({ ...current, email: true }))} aria-invalid={Boolean(describedBy("email"))} aria-describedby={describedBy("email")} autoComplete="email" />
          <FieldError id="cv-email-error">{touched.email && errors.email}</FieldError>
        </div>
        <div className="cv-field">
          <label htmlFor="cv-phone">Teléfono</label>
          <input id="cv-phone" type="tel" value={values.phone} onChange={(e) => update("phone", e.target.value)} autoComplete="tel" />
        </div>
        <div className="cv-field">
          <label htmlFor="cv-location">Ciudad / ubicación <span>(opcional)</span></label>
          <input id="cv-location" value={values.location} onChange={(e) => update("location", e.target.value)} autoComplete="address-level2" />
        </div>
        <div className="cv-field">
          <label htmlFor="cv-portfolio">Portfolio / sitio profesional <span>(opcional)</span></label>
          <input id="cv-portfolio" type="url" placeholder="https://" value={values.portfolio} onChange={(e) => update("portfolio", e.target.value)} autoComplete="url" />
        </div>
      </div>
    </section>
  );
}

export function CvObjectiveSection({ values, onChange }) {
  function update(field, value) {
    onChange({ ...values, [field]: value });
  }

  return (
    <section className="cv-editor-section" aria-labelledby="cv-objective-title">
      <div className="cv-section-heading">
        <div>
          <p className="eyebrow">Tu siguiente paso</p>
          <h2 id="cv-objective-title">Objetivo profesional</h2>
          <p>Captura tus ideas con tus propias palabras. Podrás afinarlas después.</p>
        </div>
      </div>
      <div className="cv-form-grid">
        <div className="cv-field">
          <label htmlFor="cv-target-role">Puesto u oportunidad deseada</label>
          <input id="cv-target-role" value={values.targetRole} onChange={(e) => update("targetRole", e.target.value)} placeholder="Ej. Prácticas de desarrollo web" />
        </div>
        <div className="cv-field">
          <label htmlFor="cv-interest-area">Área de interés</label>
          <input id="cv-interest-area" value={values.area} onChange={(e) => update("area", e.target.value)} placeholder="Ej. Tecnología educativa" />
        </div>
        <div className="cv-field cv-field-wide">
          <label htmlFor="cv-goal">Meta profesional breve</label>
          <textarea id="cv-goal" rows="5" value={values.goal} onChange={(e) => update("goal", e.target.value)} placeholder="¿Qué te gustaría aprender, aportar o lograr?" />
        </div>
      </div>
    </section>
  );
}
