export class ValidationRequestError extends Error {
  constructor(public data: string) {
    super("Failed to validate request");
  }
}

export class BadRequestError extends Error {
  constructor() {
    super("Bad Request");
  }
}
