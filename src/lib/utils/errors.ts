/**
 * Application error classes.
 * Typed errors for proper error handling across layers.
 */

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message, 401);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Insufficient permissions") {
    super("FORBIDDEN", message, 403);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super("NOT_FOUND", `${resource} not found`, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  public readonly details: Record<string, string[]>;

  constructor(details: Record<string, string[]>) {
    super("VALIDATION_ERROR", "Validation failed", 422);
    this.name = "ValidationError";
    this.details = details;
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class AIProviderError extends AppError {
  public readonly provider: string;

  constructor(provider: string, message: string) {
    super("AI_PROVIDER_ERROR", `[${provider}] ${message}`, 502);
    this.name = "AIProviderError";
    this.provider = provider;
  }
}

export class AIValidationError extends AppError {
  public readonly validationErrors: string[];

  constructor(errors: string[]) {
    super("AI_VALIDATION_ERROR", "AI output validation failed", 422);
    this.name = "AIValidationError";
    this.validationErrors = errors;
  }
}
