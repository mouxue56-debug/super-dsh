const statuses = {
  INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_LARGE: 413
};
export class BoardError extends Error {
  constructor(code, message, httpStatus = statuses[code]) {
    super(message);
    this.name = 'BoardError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
