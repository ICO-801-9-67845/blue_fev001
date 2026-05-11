import { useState } from "react";

export default function MessageComposer({ disabled, onSend }) {
  const [value, setValue] = useState("");

  async function sendCurrentMessage() {
    if (!value.trim() || disabled) {
      return;
    }

    const content = value;
    setValue("");
    await onSend(content);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await sendCurrentMessage();
  }

  async function handleKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    await sendCurrentMessage();
  }

  return (
    <form className="message-composer" onSubmit={handleSubmit}>
      <textarea
        rows="3"
        placeholder="Escribe algo con confianza. Puede ser una idea, una duda o algo que te este dando vueltas..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button className="primary-button" type="submit" disabled={disabled}>
        Enviar
      </button>
    </form>
  );
}
