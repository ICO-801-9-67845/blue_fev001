import {
  buildProfessionalSummary,
  getResumeSectionOrder,
  hasUsefulResumeData,
} from "../../../utils/resumePreviewUtils.js";
import CvPreviewHeader from "./CvPreviewHeader.jsx";
import {
  CvCertificationsPreview,
  CvCoursesPreview,
  CvEducationPreview,
  CvExperiencePreview,
  CvInterestsPreview,
  CvLanguagesPreview,
  CvProfilePreview,
  CvProjectsPreview,
  CvSkillsPreview,
  CvVolunteeringPreview,
} from "./CvPreviewSections.jsx";

export default function CvPreview({ resume }) {
  const summary = buildProfessionalSummary(resume);
  const sectionOrder = getResumeSectionOrder(resume);
  const sectionComponents = {
    profile: <CvProfilePreview summary={summary} />,
    experience: <CvExperiencePreview entries={resume.experience} />,
    education: <CvEducationPreview entries={resume.education} />,
    projects: <CvProjectsPreview entries={resume.projects} />,
    skills: <CvSkillsPreview items={resume.skills} />,
    courses: <CvCoursesPreview entries={resume.courses} />,
    certifications: <CvCertificationsPreview entries={resume.certifications} />,
    languages: <CvLanguagesPreview entries={resume.languages} />,
    volunteering: <CvVolunteeringPreview entries={resume.volunteering} />,
    interests: <CvInterestsPreview items={resume.interests} />,
  };

  return (
    <aside className="cv-preview-panel" aria-labelledby="cv-preview-title">
      <div className="cv-preview-heading">
        <p className="eyebrow">Vista previa en vivo</p>
        <h2 id="cv-preview-title">Tu CV</h2>
      </div>

      <article className="cv-document">
        <CvPreviewHeader basics={resume.basics} />
        {!hasUsefulResumeData(resume) && (
          <p className="cv-document-empty">
            Tu vista previa se completará conforme agregues información.
          </p>
        )}
        {sectionOrder.map((section) => (
          <div key={section}>{sectionComponents[section]}</div>
        ))}
      </article>
    </aside>
  );
}
