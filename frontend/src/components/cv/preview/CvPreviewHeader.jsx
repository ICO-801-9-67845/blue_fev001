import {
  cleanResumeText,
  getSafePortfolioUrl,
} from "../../../utils/resumePreviewUtils.js";

export default function CvPreviewHeader({ basics = {} }) {
  const fullName = cleanResumeText(basics.fullName);
  const contactItems = [
    { key: "email", value: cleanResumeText(basics.email) },
    { key: "phone", value: cleanResumeText(basics.phone) },
    { key: "location", value: cleanResumeText(basics.location) },
  ].filter((item) => item.value);
  const portfolioText = cleanResumeText(basics.portfolio);
  const portfolioUrl = getSafePortfolioUrl(portfolioText);

  return (
    <header className="cv-document-header">
      <h1 className={fullName ? "" : "is-placeholder"}>
        {fullName || "Tu nombre"}
      </h1>

      {(contactItems.length > 0 || portfolioUrl) && (
        <address className="cv-document-contact">
          {contactItems.length > 0 && (
            <ul>
              {contactItems.map((item) => <li key={item.key}>{item.value}</li>)}
            </ul>
          )}
          {portfolioUrl && (
            <a href={portfolioUrl} target="_blank" rel="noopener noreferrer">
              {portfolioText}
            </a>
          )}
        </address>
      )}
    </header>
  );
}
