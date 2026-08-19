import { useState } from "react";
import {
  buildProfessionalSummary,
  getResumePdfFilename,
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

function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z" />
      <path d="M17.5 11.5h.01" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}

export default function CvPreview({ resume }) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const summary = buildProfessionalSummary(resume);
  const sectionOrder = getResumeSectionOrder(resume);
  const canPrint = hasUsefulResumeData(resume);
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

  function handlePrint() {
    window.print();
  }

  async function handlePdfDownload() {
    if (!canPrint || isGeneratingPdf) return;

    setIsGeneratingPdf(true);
    setPdfError("");

    try {
      const [{ pdf }, { default: CvPdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("../pdf/CvPdfDocument.jsx"),
      ]);
      const blob = await pdf(<CvPdfDocument resume={resume} />).toBlob();
      const objectUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement("a");

      downloadLink.href = objectUrl;
      downloadLink.download = getResumePdfFilename(resume.basics.fullName);
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (_error) {
      setPdfError("No fue posible generar el PDF. Inténtalo de nuevo.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  return (
    <aside className="cv-preview-panel" aria-labelledby="cv-preview-title">
      <div className="cv-preview-heading">
        <div>
          <p className="eyebrow">Vista previa en vivo</p>
          <h2 id="cv-preview-title">Tu CV</h2>
        </div>
        <div className="cv-preview-actions">
          <div className="cv-preview-action-buttons">
            <button
              type="button"
              className="cv-preview-action is-print"
              disabled={!canPrint}
              aria-describedby={!canPrint ? "cv-export-hint" : undefined}
              onClick={handlePrint}
            >
              <PrinterIcon />
              <span>Imprimir</span>
            </button>
            <button
              type="button"
              className="cv-preview-action is-download"
              disabled={!canPrint || isGeneratingPdf}
              aria-busy={isGeneratingPdf}
              aria-describedby={!canPrint ? "cv-export-hint" : pdfError ? "cv-pdf-error" : undefined}
              onClick={handlePdfDownload}
            >
              <DownloadIcon />
              <span>{isGeneratingPdf ? "Generando PDF…" : "Descargar PDF"}</span>
            </button>
          </div>
          {!canPrint && (
            <p id="cv-export-hint">Agrega información a tu CV antes de imprimirlo.</p>
          )}
          {pdfError && <p id="cv-pdf-error" className="cv-pdf-error" role="alert">{pdfError}</p>}
        </div>
      </div>

      <article className="cv-document cv-preview-document">
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
