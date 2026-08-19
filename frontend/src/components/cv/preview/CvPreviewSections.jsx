import {
  cleanResumeText,
  formatResumeDate,
  formatResumePeriod,
  getUsefulResumeEntries,
  getUsefulTextItems,
  sortEducationForPreview,
  sortExperienceForPreview,
} from "../../../utils/resumePreviewUtils.js";

function PreviewSection({ title, children }) {
  return (
    <section className="cv-document-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function TextLines({ value }) {
  const lines = cleanResumeText(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return null;
  if (lines.length === 1) return <p>{lines[0]}</p>;

  return <ul className="cv-document-lines">{lines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul>;
}

export function CvEducationPreview({ entries }) {
  return (
    <PreviewSection title="Educación">
      <ul className="cv-document-entries">
        {sortEducationForPreview(entries).map((entry) => {
          const period = formatResumePeriod(entry.startDate, entry.endDate, entry.current);
          return (
            <li key={entry.id}>
              {cleanResumeText(entry.program) && <h3>{cleanResumeText(entry.program)}</h3>}
              {cleanResumeText(entry.institution) && <p className="cv-document-subtitle">{cleanResumeText(entry.institution)}</p>}
              {period && <p className="cv-document-period">{period}</p>}
            </li>
          );
        })}
      </ul>
    </PreviewSection>
  );
}

export function CvExperiencePreview({ entries }) {
  return (
    <PreviewSection title="Experiencia laboral">
      <ul className="cv-document-entries">
        {sortExperienceForPreview(entries).map((entry) => {
          const period = formatResumePeriod(entry.startDate, entry.endDate, entry.current);
          return (
            <li key={entry.id}>
              {cleanResumeText(entry.position) && <h3>{cleanResumeText(entry.position)}</h3>}
              {cleanResumeText(entry.company) && <p className="cv-document-subtitle">{cleanResumeText(entry.company)}</p>}
              {period && <p className="cv-document-period">{period}</p>}
              <TextLines value={entry.responsibilities} />
            </li>
          );
        })}
      </ul>
    </PreviewSection>
  );
}

export function CvProjectsPreview({ entries }) {
  return (
    <PreviewSection title="Proyectos">
      <ul className="cv-document-entries">
        {getUsefulResumeEntries("projects", entries).map((entry) => (
          <li key={entry.id}>
            {cleanResumeText(entry.name) && <h3>{cleanResumeText(entry.name)}</h3>}
            {cleanResumeText(entry.role) && <p className="cv-document-subtitle">{cleanResumeText(entry.role)}</p>}
            {cleanResumeText(entry.description) && <p>{cleanResumeText(entry.description)}</p>}
            {cleanResumeText(entry.technologies) && <p><strong>Tecnologías / habilidades:</strong> {cleanResumeText(entry.technologies)}</p>}
            {cleanResumeText(entry.result) && <p><strong>Resultado:</strong> {cleanResumeText(entry.result)}</p>}
          </li>
        ))}
      </ul>
    </PreviewSection>
  );
}

export function CvSkillsPreview({ items }) {
  return (
    <PreviewSection title="Habilidades">
      <ul className="cv-document-inline-list">
        {getUsefulTextItems(items).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </PreviewSection>
  );
}

function CompactEntriesPreview({ title, section, entries, organizationField }) {
  return (
    <PreviewSection title={title}>
      <ul className="cv-document-entries is-compact">
        {getUsefulResumeEntries(section, entries).map((entry) => (
          <li key={entry.id}>
            {cleanResumeText(entry.name) && <h3>{cleanResumeText(entry.name)}</h3>}
            {cleanResumeText(entry[organizationField]) && <p className="cv-document-subtitle">{cleanResumeText(entry[organizationField])}</p>}
            {formatResumeDate(entry.date) && <p className="cv-document-period">{formatResumeDate(entry.date)}</p>}
          </li>
        ))}
      </ul>
    </PreviewSection>
  );
}

export function CvCoursesPreview({ entries }) {
  return <CompactEntriesPreview title="Cursos" section="courses" entries={entries} organizationField="institution" />;
}

export function CvCertificationsPreview({ entries }) {
  return <CompactEntriesPreview title="Certificaciones" section="certifications" entries={entries} organizationField="issuer" />;
}

export function CvLanguagesPreview({ entries }) {
  return (
    <PreviewSection title="Idiomas">
      <ul className="cv-document-inline-list">
        {getUsefulResumeEntries("languages", entries).map((entry) => (
          <li key={entry.id}>
            {cleanResumeText(entry.language)}{cleanResumeText(entry.level) && ` — ${cleanResumeText(entry.level)}`}
          </li>
        ))}
      </ul>
    </PreviewSection>
  );
}

export function CvVolunteeringPreview({ entries }) {
  return (
    <PreviewSection title="Voluntariado">
      <ul className="cv-document-entries">
        {getUsefulResumeEntries("volunteering", entries).map((entry) => {
          const period = formatResumePeriod(entry.startDate, entry.endDate);
          return (
            <li key={entry.id}>
              {cleanResumeText(entry.organization) && <h3>{cleanResumeText(entry.organization)}</h3>}
              {cleanResumeText(entry.role) && <p className="cv-document-subtitle">{cleanResumeText(entry.role)}</p>}
              {period && <p className="cv-document-period">{period}</p>}
              <TextLines value={entry.description} />
            </li>
          );
        })}
      </ul>
    </PreviewSection>
  );
}

export function CvInterestsPreview({ items }) {
  return (
    <PreviewSection title="Intereses">
      <p className="cv-document-interests">{getUsefulTextItems(items).join(" · ")}</p>
    </PreviewSection>
  );
}

export function CvProfilePreview({ summary }) {
  return <PreviewSection title="Perfil profesional"><p>{summary}</p></PreviewSection>;
}
