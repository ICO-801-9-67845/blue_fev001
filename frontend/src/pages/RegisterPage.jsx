import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthForm from "../components/AuthForm";
import { useAuth } from "../hooks/useAuth";

const initialValues = {
  name: "",
  email: "",
  password: "",
};

export default function RegisterPage() {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  function handleChange(event) {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await register(values);
      navigate("/chat");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "No fue posible crear la cuenta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <div className="auth-hero-copy">
          <span className="hero-pill">Amigable, discreto y util</span>
          <h2>Empieza una charla que puede ayudarte a descubrir tu proximo paso.</h2>
          <p>
            La experiencia esta pensada para sentirse humana, cercana y visualmente
            limpia desde el primer mensaje.
          </p>
        </div>
      </section>

      <section className="auth-panel">
        <AuthForm
          title="Crea tu cuenta"
          subtitle="Tu historial de conversaciones quedara guardado para que avances sin perder contexto."
          fields={[
            {
              name: "name",
              label: "Nombre",
              type: "text",
              placeholder: "Como te gusta que te llamen",
              autoComplete: "name",
            },
            {
              name: "email",
              label: "Email",
              type: "email",
              placeholder: "tu@email.com",
              autoComplete: "email",
            },
            {
              name: "password",
              label: "Password",
              type: "password",
              placeholder: "Minimo 6 caracteres",
              autoComplete: "new-password",
            },
          ]}
          submitLabel="Crear cuenta"
          footerText="Ya tienes cuenta?"
          footerLink="/login"
          footerLabel="Inicia sesion"
          onChange={handleChange}
          onSubmit={handleSubmit}
          values={values}
          error={error}
          loading={loading}
        />
      </section>
    </main>
  );
}
