import { useState } from "react";

export default function MessageComposer({ disabled, onSend }) {
  const [value, setValue] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();

    if (!value.trim() || disabled) {
      return;
    }

    const content = value;
    setValue("");
    await onSend(content);
  }

  return (
    <form className="message-composer" onSubmit={handleSubmit}>
      <textarea
        rows="3"
        placeholder="Escribe algo con confianza. Puede ser una idea, una duda o algo que te este dando vueltas..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={disabled}
      />
      <button className="primary-button" type="submit" disabled={disabled}>
        Enviar
      </button>
    </form>
  );
}
