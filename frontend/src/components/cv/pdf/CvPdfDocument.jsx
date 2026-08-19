import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  buildProfessionalSummary,
  cleanResumeText,
  formatResumeDate,
  formatResumePeriod,
  getResumeSectionOrder,
  getSafePortfolioUrl,
  getUsefulResumeEntries,
  getUsefulTextItems,
  sortEducationForPreview,
  sortExperienceForPreview,
} from "../../../utils/resumePreviewUtils.js";

const COLORS = {
  primary: "#16045d",
  text: "#202333",
  soft: "#5d6478",
  line: "#cfd3de",
  link: "#2c2fa8",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 42,
    paddingRight: 42,
    paddingBottom: 42,
    paddingLeft: 42,
    color: COLORS.text,
    backgroundColor: "#ffffff",
    fontFamily: "Helvetica",
    fontSize: 9.5,
    lineHeight: 1.45,
  },
  header: {
    paddingBottom: 11,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.primary,
  },
  name: {
    color: COLORS.primary,
    fontFamily: "Helvetica-Bold",
    fontSize: 24,
    lineHeight: 1.1,
  },
  contact: {
    marginTop: 6,
    color: COLORS.soft,
    fontSize: 8.6,
  },
  portfolio: {
    marginTop: 3,
    color: COLORS.link,
    fontSize: 8.6,
    textDecoration: "underline",
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    marginBottom: 6,
    paddingBottom: 3,
    color: COLORS.primary,
    borderBottomWidth: 0.7,
    borderBottomColor: COLORS.line,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  entry: {
    marginBottom: 8,
  },
  entryTitle: {
    color: COLORS.text,
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    lineHeight: 1.35,
  },
  subtitle: {
    marginTop: 1,
    color: "#3f4458",
    fontFamily: "Helvetica-Bold",
  },
  period: {
    marginTop: 1,
    color: COLORS.soft,
    fontSize: 8.4,
  },
  paragraph: {
    marginTop: 3,
  },
  label: {
    fontFamily: "Helvetica-Bold",
  },
  inlineText: {
    color: "#3f4458",
  },
  listLine: {
    marginTop: 2,
    paddingLeft: 9,
  },
});

function pdfPeriod(startDate, endDate, current = false) {
  return formatResumePeriod(startDate, endDate, current).replace(/–/g, "-");
}

function entryCanSplit(entry, fields) {
  const length = fields.reduce(
    (total, field) => total + cleanResumeText(entry[field]).length,
    0,
  );
  return length > 750;
}

function PdfSection({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} minPresenceAhead={42}>{title}</Text>
      {children}
    </View>
  );
}

function PdfEntry({ children, allowSplit = false }) {
  return <View style={styles.entry} wrap={allowSplit}>{children}</View>;
}

function OptionalText({ value, style }) {
  const text = cleanResumeText(value);
  return text ? <Text style={style}>{text}</Text> : null;
}

function Responsibilities({ value }) {
  const lines = cleanResumeText(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 1) return <Text style={styles.paragraph}>{lines[0]}</Text>;
  return lines.map((line, index) => (
    <Text key={`${line}-${index}`} style={styles.listLine}>- {line}</Text>
  ));
}

function EducationPdf({ entries }) {
  return (
    <PdfSection title="Educación">
      {sortEducationForPreview(entries).map((entry) => (
        <PdfEntry key={entry.id}>
          <OptionalText value={entry.program} style={styles.entryTitle} />
          <OptionalText value={entry.institution} style={styles.subtitle} />
          <OptionalText value={pdfPeriod(entry.startDate, entry.endDate, entry.current)} style={styles.period} />
        </PdfEntry>
      ))}
    </PdfSection>
  );
}

function ExperiencePdf({ entries }) {
  return (
    <PdfSection title="Experiencia laboral">
      {sortExperienceForPreview(entries).map((entry) => (
        <PdfEntry key={entry.id} allowSplit={entryCanSplit(entry, ["responsibilities"])}>
          <OptionalText value={entry.position} style={styles.entryTitle} />
          <OptionalText value={entry.company} style={styles.subtitle} />
          <OptionalText value={pdfPeriod(entry.startDate, entry.endDate, entry.current)} style={styles.period} />
          <Responsibilities value={entry.responsibilities} />
        </PdfEntry>
      ))}
    </PdfSection>
  );
}

function ProjectsPdf({ entries }) {
  return (
    <PdfSection title="Proyectos">
      {getUsefulResumeEntries("projects", entries).map((entry) => (
        <PdfEntry key={entry.id} allowSplit={entryCanSplit(entry, ["description", "technologies", "result"])}>
          <OptionalText value={entry.name} style={styles.entryTitle} />
          <OptionalText value={entry.role} style={styles.subtitle} />
          <OptionalText value={entry.description} style={styles.paragraph} />
          {cleanResumeText(entry.technologies) && (
            <Text style={styles.paragraph}><Text style={styles.label}>Tecnologías / habilidades: </Text>{cleanResumeText(entry.technologies)}</Text>
          )}
          {cleanResumeText(entry.result) && (
            <Text style={styles.paragraph}><Text style={styles.label}>Resultado: </Text>{cleanResumeText(entry.result)}</Text>
          )}
        </PdfEntry>
      ))}
    </PdfSection>
  );
}

function CompactEntriesPdf({ title, section, entries, organizationField }) {
  return (
    <PdfSection title={title}>
      {getUsefulResumeEntries(section, entries).map((entry) => (
        <PdfEntry key={entry.id}>
          <OptionalText value={entry.name} style={styles.entryTitle} />
          <OptionalText value={entry[organizationField]} style={styles.subtitle} />
          <OptionalText value={formatResumeDate(entry.date)} style={styles.period} />
        </PdfEntry>
      ))}
    </PdfSection>
  );
}

function VolunteeringPdf({ entries }) {
  return (
    <PdfSection title="Voluntariado">
      {getUsefulResumeEntries("volunteering", entries).map((entry) => (
        <PdfEntry key={entry.id} allowSplit={entryCanSplit(entry, ["description"])}>
          <OptionalText value={entry.organization} style={styles.entryTitle} />
          <OptionalText value={entry.role} style={styles.subtitle} />
          <OptionalText value={pdfPeriod(entry.startDate, entry.endDate)} style={styles.period} />
          <Responsibilities value={entry.description} />
        </PdfEntry>
      ))}
    </PdfSection>
  );
}

function ResumeHeaderPdf({ basics = {} }) {
  const fullName = cleanResumeText(basics.fullName);
  const contacts = [basics.email, basics.phone, basics.location]
    .map(cleanResumeText)
    .filter(Boolean);
  const portfolioText = cleanResumeText(basics.portfolio);
  const portfolioUrl = getSafePortfolioUrl(portfolioText);

  if (!fullName && !contacts.length && !portfolioUrl) return null;

  return (
    <View style={styles.header} wrap={false}>
      {fullName && <Text style={styles.name}>{fullName}</Text>}
      {contacts.length > 0 && <Text style={styles.contact}>{contacts.join(" | ")}</Text>}
      {portfolioUrl && <Link src={portfolioUrl} style={styles.portfolio}>{portfolioText}</Link>}
    </View>
  );
}

export default function CvPdfDocument({ resume }) {
  const summary = buildProfessionalSummary(resume);
  const sectionOrder = getResumeSectionOrder(resume);
  const sectionComponents = {
    profile: <PdfSection title="Perfil profesional"><Text>{summary}</Text></PdfSection>,
    experience: <ExperiencePdf entries={resume.experience} />,
    education: <EducationPdf entries={resume.education} />,
    projects: <ProjectsPdf entries={resume.projects} />,
    skills: <PdfSection title="Habilidades"><Text style={styles.inlineText}>{getUsefulTextItems(resume.skills).join(" | ")}</Text></PdfSection>,
    courses: <CompactEntriesPdf title="Cursos" section="courses" entries={resume.courses} organizationField="institution" />,
    certifications: <CompactEntriesPdf title="Certificaciones" section="certifications" entries={resume.certifications} organizationField="issuer" />,
    languages: <PdfSection title="Idiomas"><Text style={styles.inlineText}>{getUsefulResumeEntries("languages", resume.languages).map((entry) => `${cleanResumeText(entry.language)}${cleanResumeText(entry.level) ? ` - ${cleanResumeText(entry.level)}` : ""}`).join(" | ")}</Text></PdfSection>,
    volunteering: <VolunteeringPdf entries={resume.volunteering} />,
    interests: <PdfSection title="Intereses"><Text style={styles.inlineText}>{getUsefulTextItems(resume.interests).join(" | ")}</Text></PdfSection>,
  };

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <ResumeHeaderPdf basics={resume.basics} />
        {sectionOrder.map((section) => (
          <View key={section}>{sectionComponents[section]}</View>
        ))}
      </Page>
    </Document>
  );
}
