const RESOURCES = [
  { name: "Spotify", url: "https://open.spotify.com/" },
  { name: "NotebookLM", url: "https://notebooklm.google.com/" },
  { name: "Notion", url: "https://www.notion.so/" },
  { name: "Gmail", url: "https://mail.google.com/" },
];

export default function FocusResources() {
  return (
    <section className="focus-support-section focus-resources" aria-labelledby="focus-resources-title">
      <div className="focus-support-heading">
        <div>
          <p className="eyebrow">Accesos externos</p>
          <h2 id="focus-resources-title">Recursos</h2>
        </div>
      </div>

      <div className="focus-resource-links">
        {RESOURCES.map((resource) => (
          <a
            key={resource.name}
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Abrir ${resource.name} en una pestaña nueva`}
          >
            <span>{resource.name}</span>
            <small>
              Abrir <span aria-hidden="true">↗</span>
            </small>
          </a>
        ))}
      </div>
    </section>
  );
}
