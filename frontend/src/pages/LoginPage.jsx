import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthForm from "../components/AuthForm";
import { useAuth } from "../hooks/useAuth";

const initialValues = {
  email: "",
  password: "",
};

export default function LoginPage() {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  function handleChange(event) {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(values);
      navigate("/chat");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "No fue posible iniciar sesion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <div className="auth-hero-copy">
          <span className="hero-pill">Conversacion + orientacion gradual</span>
          <h2>Blue tu mejor amiga.</h2>
          <p>
            Habla con naturalidad y deja que la conversacion descubra intereses,
            habilidades y posibles caminos para tu futuro.
          </p>
        </div>
      </section>

      <section className="auth-panel">
        <AuthForm
          title="Bienvenido de vuelta"
          subtitle="Entra a tu espacio y retoma la conversacion donde la dejaste."
          fields={[
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
              placeholder: "Tu password",
              autoComplete: "current-password",
            },
          ]}
          submitLabel="Iniciar sesion"
          footerText="No tienes cuenta?"
          footerLink="/register"
          footerLabel="Registrate"
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
