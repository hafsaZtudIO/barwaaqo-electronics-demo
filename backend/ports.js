export class AccessError extends Error {
  constructor(status) {
    super(status === 401 ? "Sign in to continue." : "You do not have access to this operation.");
    this.status = status;
  }
}

export class ShopError extends Error {}
export class ConnectionError extends ShopError {}
