import { useRef, useState } from "react";
import {
  createResumeBackup,
  getResumeBackupFilename,
  isResumeBackupFileTooLarge,
  parseResumeBackup,
} from "../../utils/resumeBackupUtils.js";
import {
  getUsefulResumeEntries,
  hasUsefulResumeData,
} from "../../utils/resumePreviewUtils.js";

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 16V4M7 9l5-5 5 5M5 14v6h14v-6" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
    </svg>
  );
}

function downloadBackup(resume) {
  const backup = createResumeBackup(resume);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");

  downloadLink.href = objectUrl;
  downloadLink.download = getResumeBackupFilename(resume.basics.fullName);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function getImportSummary(resume) {
  return {
    name: resume.basics.fullName.trim() || "Sin nombre",
    education: getUsefulResumeEntries("education", resume.education).length,
    projects: getUsefulResumeEntries("projects", resume.projects).length,
    experience: getUsefulResumeEntries("experience", resume.experience).length,
  };
}

export default function CvBackupControls({ resume, onImport }) {
  const fileInputRef = useRef(null);
  const [pendingResume, setPendingResume] = useState(null);
  const [isReading, setIsReading] = useState(false);
  const [message, setMessage] = useState(null);
  const canExport = hasUsefulResumeData(resume);
  const summary = pendingResume ? getImportSummary(pendingResume) : null;

  function clearFileSelection() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleExport() {
    if (!canExport) return;

    setMessage(null);
    try {
      downloadBackup(resume);
    } catch (_error) {
      setMessage({ type: "error", text: "No fue posible exportar el respaldo." });
    }
  }

  async function handleFileChange(event) {
    const [file] = event.target.files;
    setPendingResume(null);
    setMessage(null);
    if (!file) return;

    if (isResumeBackupFileTooLarge(file.size)) {
      setMessage({
        type: "error",
        text: "El archivo es demasiado grande para ser un respaldo de CV.",
      });
      clearFileSelection();
      return;
    }

    setIsReading(true);
    try {
      const result = parseResumeBackup(await file.text());
      if (!result.ok) {
        setMessage({ type: "error", text: result.message });
        clearFileSelection();
        return;
      }

      setPendingResume(result.resume);
    } catch (_error) {
      setMessage({ type: "error", text: "No fue posible leer el archivo seleccionado." });
      clearFileSelection();
    } finally {
      setIsReading(false);
    }
  }

  function handleCancelImport() {
    setPendingResume(null);
    setMessage(null);
    clearFileSelection();
  }

  function handleConfirmImport() {
    if (!pendingResume) return;

    if (!onImport(pendingResume)) {
      setMessage({
        type: "error",
        text: "No fue posible guardar el respaldo en este dispositivo.",
      });
      return;
    }

    setPendingResume(null);
    setMessage({ type: "success", text: "Respaldo importado correctamente." });
    clearFileSelection();
  }

  return (
    <section className="cv-backup-controls" aria-labelledby="cv-backup-title">
      <div>
        <h2 id="cv-backup-title">Respaldo editable</h2>
        <p>Se procesa localmente y no se envía a servidores.</p>
      </div>

      <div className="cv-backup-actions">
        <button
          type="button"
          className="cv-backup-button"
          disabled={!canExport}
          onClick={handleExport}
        >
          <ExportIcon />
          <span>Exportar respaldo</span>
        </button>
        <button
          type="button"
          className="cv-backup-button"
          disabled={isReading}
          aria-controls="cv-backup-file"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImportIcon />
          <span>{isReading ? "Leyendo respaldo…" : "Importar respaldo"}</span>
        </button>
        <input
          ref={fileInputRef}
          id="cv-backup-file"
          className="cv-backup-file-input"
          type="file"
          accept=".json,application/json"
          tabIndex="-1"
          aria-label="Seleccionar respaldo JSON del CV"
          onChange={handleFileChange}
        />
      </div>

      {!canExport && (
        <p className="cv-backup-hint">Agrega información a tu CV antes de exportar un respaldo.</p>
      )}

      {message && (
        <p
          className={`cv-backup-message is-${message.type}`}
          role={message.type === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {message.text}
        </p>
      )}

      {pendingResume && (
        <div className="cv-import-confirmation" aria-labelledby="cv-import-confirmation-title">
          <h3 id="cv-import-confirmation-title">Respaldo válido</h3>
          <dl>
            <div><dt>Nombre</dt><dd>{summary.name}</dd></div>
            <div><dt>Educación</dt><dd>{summary.education}</dd></div>
            <div><dt>Proyectos</dt><dd>{summary.projects}</dd></div>
            <div><dt>Experiencias</dt><dd>{summary.experience}</dd></div>
          </dl>
          <p>Importar este respaldo reemplazará los datos actuales de tu CV.</p>
          <div className="cv-import-actions">
            <button type="button" className="primary-button" onClick={handleConfirmImport}>
              Importar y reemplazar
            </button>
            <button type="button" className="ghost-button" onClick={handleCancelImport}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
