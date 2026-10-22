/**
 * Expected business-rule failures. Actions turn these into `{ ok: false }` results.
 * `code` is set explicitly (not from constructor.name) so it survives minification.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly field?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    opts: { field?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = code;
    this.code = code;
    this.field = opts.field;
    this.details = opts.details;
  }
}

export class InsufficientStock extends DomainError {
  constructor(details: { partId: string; sku: string; available: number; requested: number }) {
    super(
      "InsufficientStock",
      `Only ${details.available} of ${details.sku} in stock (requested ${details.requested})`,
      { details },
    );
  }
}

export class CreditLimitExceeded extends DomainError {
  constructor(details: { balance: string; limit: string; invoiceTotal: string }) {
    super(
      "CreditLimitExceeded",
      `Credit limit ${details.limit} exceeded (balance ${details.balance} + invoice ${details.invoiceTotal})`,
      { details },
    );
  }
}

export class DiscountNotAllowed extends DomainError {
  constructor(message = "Discount is above the allowed limit", details?: Record<string, unknown>) {
    super("DiscountNotAllowed", message, { details });
  }
}

export class ReturnQtyExceeded extends DomainError {
  constructor(details: { invoiceItemId: string; returnable: number; requested: number }) {
    super(
      "ReturnQtyExceeded",
      `Only ${details.returnable} can be returned (requested ${details.requested})`,
      { details },
    );
  }
}

export class PriceMissing extends DomainError {
  constructor(details: { partId: string; sku: string }) {
    super("PriceMissing", `No price set for ${details.sku}`, { details });
  }
}

export class InvalidState extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("InvalidState", message, { details });
  }
}

export class Forbidden extends DomainError {
  constructor(message = "You do not have permission to do this") {
    super("Forbidden", message);
  }
}

export class NotFound extends DomainError {
  constructor(message = "Not found", details?: Record<string, unknown>) {
    super("NotFound", message, { details });
  }
}
