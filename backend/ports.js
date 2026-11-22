export class AccessError extends Error {
  constructor(status) {
    super(status === 401 ? "Sign in to continue." : "You do not have access to this operation.");
    this.status = status;
  }
}

export class ShopError extends Error {}
export class ConnectionError extends ShopError {}
export class DatabaseSchemaError extends ShopError {
    constructor() {
        super("The shop database schema is incomplete. Check pending database migrations.");
        this.name = "DatabaseSchemaError";
    }
}
