export class ApiError extends Error {
  constructor(status, message, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
export function requireValue(condition, message, fields = {}) {
  if (!condition) throw new ApiError(400, message, fields);
}
// The same public contract applies to HTTP errors and failed sync operations.
export function publicError(error) {
  let status = error instanceof ApiError ? error.status : 500;
  let message = error instanceof ApiError ? error.message : "Сервер не зміг обробити запит.";
  if (error.code === "23505") {
    status = 409;
    message = "Такий запис уже існує або подорож уже активна.";
  }
  if (["23503", "23514", "22P02"].includes(error.code)) {
    status = 400;
    message = "Дані порушують правила цілісності бази.";
  }
  if (error.type === "entity.parse.failed") {
    status = 400;
    message = "Некоректний JSON.";
  }
  if (error.type === "entity.too.large") {
    status = 413;
    message = "Тіло запиту перевищує 1 МБ.";
  }
  if (["charset.unsupported", "encoding.unsupported"].includes(error.type)) {
    status = 415;
    message = "Непідтримуваний формат або кодування запиту.";
  }
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  if (status >= 500) message = "Сервер не зміг обробити запит.";
  return { status, message, fields: error instanceof ApiError ? error.fields : {} };
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const response = publicError(error);
  // SQL, request bodies and token values never enter the diagnostic log.
  if (response.status >= 500)
    console.error(JSON.stringify({ event: "api_error", requestId: req.requestId, code: error.code || "internal_error" }));
  res
    .status(response.status)
    .json({
      ...response,
      requestId: req.requestId,
    });
}
