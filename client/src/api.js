let accessToken = null;
let refreshPromise = null;
let sessionGeneration = 0;
let authTransitions = 0;

export class ApiError extends Error {
  constructor(message, status = 0, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export class SessionChangedError extends ApiError {
  constructor() {
    super("Обліковий запис змінився. Повторіть дію.", 409);
    this.cancelled = true;
  }
}

export function setToken(token) {
  accessToken = token;
  sessionGeneration++;
}

async function decode(res) {
  if (res.status === 204) return null;
  const content = await res
    .json()
    .catch(() => ({ message: "Сервер повернув некоректну відповідь." }));
  if (!res.ok)
    throw new ApiError(
      content.message || "Не вдалося виконати запит.",
      res.status,
      content.fields,
    );
  return content;
}

export async function refreshSession() {
  if (authTransitions) throw new SessionChangedError();
  if (!refreshPromise) {
    const generation = sessionGeneration;
    refreshPromise = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(decode)
      .then((session) => {
        if (generation !== sessionGeneration) throw new SessionChangedError();
        accessToken = session.access_token;
        return session;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function api(path, { method = "GET", body, retry = true } = {}) {
  const transition = ["/auth/login", "/auth/register", "/auth/logout"].includes(
    path,
  );
  if (transition) {
    authTransitions++;
    sessionGeneration++;
    // An older refresh response must settle before login/logout writes its cookie.
    await refreshPromise?.catch(() => {});
  } else if (authTransitions) {
    throw new SessionChangedError();
  }
  const generation = sessionGeneration;
  try {
    let res;
    try {
      res = await fetch("/api" + path, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      if (generation !== sessionGeneration) throw new SessionChangedError();
      throw new ApiError(
        "Немає зв’язку із сервером. Зміни можна зберегти на пристрої.",
      );
    }
    if (generation !== sessionGeneration) throw new SessionChangedError();
    if (res.status === 401 && retry && !path.startsWith("/auth/")) {
      try {
        await refreshSession();
      } catch (error) {
        if (error.cancelled || generation !== sessionGeneration)
          throw new SessionChangedError();
        setToken(null);
        throw new ApiError("Сесія завершилась. Увійдіть знову.", 401);
      }
      if (generation !== sessionGeneration) throw new SessionChangedError();
      return api(path, { method, body, retry: false });
    }
    const result = await decode(res);
    if (generation !== sessionGeneration) throw new SessionChangedError();
    return result;
  } finally {
    if (transition) authTransitions--;
  }
}
