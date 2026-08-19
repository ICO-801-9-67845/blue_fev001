import { useState } from "react";
import { useAuth } from "../hooks/useAuth.js";
import { useResumeBuilder } from "../hooks/useResumeBuilder.js";
import CvSectionNavigation from "../components/cv/CvSectionNavigation.jsx";
import { CvBasicsSection, CvObjectiveSection } from "../components/cv/CvProfileSections.jsx";
import { CvCertificationsSection, CvCoursesSection, CvEducationSection } from "../components/cv/CvAcademicSections.jsx";
import { CvExperienceSection, CvProjectsSection, CvVolunteeringSection } from "../components/cv/CvExperienceSections.jsx";
import CvLanguagesSection from "../components/cv/CvLanguagesSection.jsx";
import CvTextListSection from "../components/cv/CvTextListSection.jsx";
import CvPreview from "../components/cv/preview/CvPreview.jsx";
import "../styles/cv.css";

const SECTIONS = [
  { id: "basics", label: "Información personal" },
  { id: "objective", label: "Objetivo profesional" },
  { id: "education", label: "Educación" },
  { id: "projects", label: "Proyectos" },
  { id: "skills", label: "Habilidades" },
  { id: "experience", label: "Experiencia" },
  { id: "courses", label: "Cursos" },
  { id: "certifications", label: "Certificaciones" },
  { id: "languages", label: "Idiomas" },
  { id: "volunteering", label: "Voluntariado" },
  { id: "interests", label: "Intereses" },
];

export default function CvBuilderPage() {
  const { user } = useAuth();
  const { resume, saveStatus, updateSection, clearResume } = useResumeBuilder(user.id);
  const [activeSection, setActiveSection] = useState("basics");
  const [viewMode, setViewMode] = useState("edit");

  function update(section, value, immediate = false) {
    updateSection(section, value, { immediate });
  }

  function handleDeleteResume() {
    const confirmed = window.confirm("¿Eliminar todos los datos de tu CV guardados en este dispositivo?");
    if (confirmed) {
      clearResume();
      setActiveSection("basics");
    }
  }

  if (!resume) return <p className="cv-loading">Cargando tu CV…</p>;

  const sectionContent = {
    basics: <CvBasicsSection values={resume.basics} onChange={(value) => update("basics", value)} />,
    objective: <CvObjectiveSection values={resume.objective} onChange={(value) => update("objective", value)} />,
    education: <CvEducationSection entries={resume.education} onChange={(value) => update("education", value, true)} />,
    projects: <CvProjectsSection entries={resume.projects} onChange={(value) => update("projects", value, true)} />,
    skills: <CvTextListSection title="Habilidades" description="Combina habilidades técnicas y personales que realmente utilizas." singular="habilidad" placeholder="Ej. JavaScript" values={resume.skills} onChange={(value) => update("skills", value, true)} />,
    experience: <CvExperienceSection entries={resume.experience} onChange={(value) => update("experience", value, true)} />,
    courses: <CvCoursesSection entries={resume.courses} onChange={(value) => update("courses", value, true)} />,
    certifications: <CvCertificationsSection entries={resume.certifications} onChange={(value) => update("certifications", value, true)} />,
    languages: <CvLanguagesSection entries={resume.languages} onChange={(value) => update("languages", value, true)} />,
    volunteering: <CvVolunteeringSection entries={resume.volunteering} onChange={(value) => update("volunteering", value, true)} />,
    interests: <CvTextListSection title="Intereses relevantes" description="Puedes mostrar temas que conecten con tu perfil o con la oportunidad que buscas." singular="interés" placeholder="Ej. Robótica" optional values={resume.interests} onChange={(value) => update("interests", value, true)} />,
  };

  return (
    <section className="cv-builder" aria-labelledby="cv-title">
      <header className="cv-builder-header">
        <div>
          <p className="eyebrow">Herramientas Blue</p>
          <h1 id="cv-title">Creador de CV</h1>
          <p>Construye tu primer CV paso a paso, empezando por lo que ya sabes y has creado.</p>
        </div>
        <div className="cv-privacy-panel">
          <p>Tu CV se guarda localmente en este dispositivo.</p>
          <p className={`cv-save-status is-${saveStatus}`} role={saveStatus === "error" ? "alert" : "status"} aria-live="polite">
            {saveStatus === "saving" && "Guardando cambios…"}
            {saveStatus === "saved" && "Cambios guardados"}
            {saveStatus === "error" && "No fue posible guardar los cambios en este dispositivo."}
          </p>
          <button type="button" className="cv-delete-all" onClick={handleDeleteResume}>Eliminar datos del CV</button>
        </div>
      </header>

      <div className="cv-mobile-view-switch" aria-label="Modo del creador de CV">
        <button type="button" className={viewMode === "edit" ? "is-active" : ""} aria-pressed={viewMode === "edit"} onClick={() => setViewMode("edit")}>Editar</button>
        <button type="button" className={viewMode === "preview" ? "is-active" : ""} aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")}>Vista previa</button>
      </div>

      <div className={`cv-builder-workspace is-${viewMode}`}>
        <div className="cv-builder-layout">
          <CvSectionNavigation sections={SECTIONS} activeSection={activeSection} onChange={setActiveSection} />
          <main className="cv-editor" key={activeSection}>{sectionContent[activeSection]}</main>
        </div>
        <CvPreview resume={resume} />
      </div>
    </section>
  );
}
