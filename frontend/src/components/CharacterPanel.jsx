import { useState } from "react";

export default function CharacterPanel() {
  const [imageAvailable, setImageAvailable] = useState(true);

  return (
    <aside className="character-panel">
      <div className="character-card">
        <div className="character-header">
          <p className="eyebrow">Compania visual</p>
          <h3>Blue</h3>
        </div>

        <div className="character-stage">
          <div className="character-backdrop" />
          <div className="character-pedestal" />

          {imageAvailable ? (
            <img
              className="character-image"
              src="/character.png"
              alt="Personaje del asistente"
              onError={() => setImageAvailable(false)}
            />
          ) : (
            <div className="character-placeholder" aria-hidden="true">
              <div className="character-orb" />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
