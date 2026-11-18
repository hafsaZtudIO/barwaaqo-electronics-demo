import { AccessError } from "./ports.js";
import { queryOptions } from "./validation.js";

const adminQueries = new Set([
  "employees", "reports", "settings", "suppliers", "export", "sale_revision",
  "expenses", "purchases", "purchase", "finance_summary",
]);

export async function employeeContext(repository, identity) {
  if (!identity) throw new AccessError(401);
  const employee = await repository.employee(identity);
  if (!employee) throw new AccessError(403);
  return { identity, employee };
}

export function readAuthorizedShop(repository, { identity, employee }, key, options) {
  if (adminQueries.has(key) && employee.role !== "admin") throw new AccessError(403);
  return repository.read(identity, key, queryOptions.parse(options));
}
