export default function CvSectionNavigation({ sections, activeSection, onChange }) {
  return (
    <nav className="cv-section-navigation" aria-label="Secciones del CV">
      <label className="cv-section-select-label" htmlFor="cv-section-select">
        Sección que quieres editar
      </label>
      <select
        id="cv-section-select"
        className="cv-section-select"
        value={activeSection}
        onChange={(event) => onChange(event.target.value)}
      >
        {sections.map((section) => (
          <option key={section.id} value={section.id}>{section.label}</option>
        ))}
      </select>

      <div className="cv-section-tabs">
        {sections.map((section, index) => (
          <button
            key={section.id}
            type="button"
            className={activeSection === section.id ? "is-active" : ""}
            aria-current={activeSection === section.id ? "step" : undefined}
            onClick={() => onChange(section.id)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
