export class ValidationRequestError extends Error {
  constructor(public data: string) {
    super("Failed to validate request");
  }
}
