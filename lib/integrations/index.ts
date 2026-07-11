/**
 * Integration adapters (rule #6) — payments, printing, notifications behind
 * pluggable interfaces, resolved per tenant. Concrete providers register
 * themselves; business logic only ever imports these interfaces + resolvers.
 */
export * from "./payments"
export * from "./printing"
export * from "./notifications"
