import React, { useState } from "react";
import Modal from "../components/Modal";
import Icon from "../components/Icon";
import { api, setToken } from "../api";
export default function AuthDialog({ onSuccess, onClose }) {
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s = await api(`/auth/${register ? "register" : "login"}`, {
        method: "POST",
        body: { email, password, ...(register ? { display_name: name } : {}) },
      });
      setToken(s.access_token);
      await onSuccess(s.user);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={register ? "Створіть обліковий запис" : "Раді бачити вас знову"}
      onClose={onClose}
    >
      <div className="auth-intro">
        <Icon name="mountain" size={34} />
        <p>
          Зберігайте маршрути, записуйте подорожі
          <br />
          та беріть свої плани із собою.
        </p>
      </div>
      <form onSubmit={submit}>
        {register && (
          <label>
            Ім’я
            <input
              autoComplete="name"
              minLength={2}
              maxLength={100}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label>
          Електронна адреса
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={10}
            maxLength={128}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <p className="muted">Щонайменше 10 символів.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? "Зачекайте…" : register ? "Зареєструватися" : "Увійти"}
        </button>
      </form>
      <p className="auth-switch">
        {register ? "Уже маєте обліковий запис?" : "Перший маршрут із нами?"}{" "}
        <button
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "Увійти" : "Реєстрація"}
        </button>
      </p>
      <details className="demo-login">
        <summary>Демонстраційні облікові записи</summary>
        <p>Турист: oleh@example.com / Tourist2026!</p>
        <p>Адміністратор: admin@example.com / Admin2026!</p>
        <button
          className="secondary"
          onClick={() => {
            setEmail("oleh@example.com");
            setPassword("Tourist2026!");
            setRegister(false);
          }}
        >
          Заповнити дані туриста
        </button>
      </details>
    </Modal>
  );
}
