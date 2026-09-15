/**
 * Named aliases over the generated `types.ts` so users write `Server`
 * instead of `components["schemas"]["Server"]`. Everything here is a pure
 * type re-export; nothing exists at runtime.
 */
import type { components, operations } from "./types.js";

export type Schemas = components["schemas"];
export type Operations = operations;

/** Query parameters of an operation, as declared in the spec. */
export type QueryOf<K extends keyof operations> = NonNullable<operations[K]["parameters"]["query"]>;
/** JSON request body of an operation. */
export type BodyOf<K extends keyof operations> = NonNullable<operations[K]["requestBody"]>["content"]["application/json"];
/** JSON response body of an operation for a given status. */
export type ResponseOf<K extends keyof operations, S extends keyof operations[K]["responses"]> =
  operations[K]["responses"][S] extends { content: { "application/json": infer B } } ? B : never;

// ---------------------------------------------------------------- primitives
export type Money = Schemas["Money"];
export type Currency = Schemas["Currency"];
export type Timestamp = Schemas["Timestamp"];
export type Scope = Schemas["Scope"];
export type BillingCycle = Schemas["BillingCycle"];
export type ErrorCode = Schemas["ErrorCode"];
export type ErrorBody = Schemas["Error"];

// ---------------------------------------------------------------- meta
export type Health = Schemas["Health"];
export type Me = Schemas["Me"];

// ---------------------------------------------------------------- account
export type Account = Schemas["Account"];
export type ClientGroup = Schemas["ClientGroup"];
export type Balance = Schemas["Balance"];
export type Transaction = Schemas["Transaction"];
export type TransactionPage = Schemas["TransactionPage"];
export type TopupInfo = Schemas["TopupInfo"];
export type TopupRequest = Schemas["TopupRequest"];
export type TopupResult = Schemas["TopupResult"];

// ---------------------------------------------------------------- invoices
export type Invoice = Schemas["Invoice"];
export type InvoiceItem = Schemas["InvoiceItem"];
export type InvoiceStatus = Schemas["InvoiceStatus"];
export type InvoiceType = Schemas["InvoiceType"];
export type InvoicePage = Schemas["InvoicePage"];
export type PayInvoiceResult = Schemas["PayInvoiceResult"];
export type PaymentLinkRequest = Schemas["PaymentLinkRequest"];
export type PaymentLink = Schemas["PaymentLink"];

// ---------------------------------------------------------------- catalog
export type Tariff = Schemas["Tariff"];
export type Resources = Schemas["Resources"];
export type PeriodPrice = Schemas["PeriodPrice"];
export type OsImage = Schemas["OsImage"];
export type Location = Schemas["Location"];
export type Zone = Schemas["Zone"];
export type Discount = Schemas["Discount"];
export type Quote = Schemas["Quote"];

// ---------------------------------------------------------------- servers
export type Server = Schemas["Server"];
export type ServerDetail = Schemas["ServerDetail"];
export type ServerStatus = Schemas["ServerStatus"];
export type ServerFlags = Schemas["ServerFlags"];
export type ServerBilling = Schemas["ServerBilling"];
export type ServerRef = Schemas["ServerRef"];
export type ServerPage = Schemas["ServerPage"];
export type ServerLiveStatus = Schemas["ServerLiveStatus"];
export type ServerCreate = Schemas["ServerCreate"];
export type ServerCreated = Schemas["ServerCreated"];
export type ServerUpdate = Schemas["ServerUpdate"];
export type DeleteResult = Schemas["DeleteResult"];
export type RefundQuote = Schemas["RefundQuote"];
export type RefundBreakdownItem = Schemas["RefundBreakdownItem"];
export type RenewRequest = Schemas["RenewRequest"];
export type RenewResult = Schemas["RenewResult"];
export type PowerRequest = Schemas["PowerRequest"];
export type PowerAction = PowerRequest["action"];
export type ActionResult = Schemas["ActionResult"];
export type ReinstallRequest = Schemas["ReinstallRequest"];
export type ReinstallResult = Schemas["ReinstallResult"];
export type ResetPasswordResult = Schemas["ResetPasswordResult"];

// ---------------------------------------------------------------- orders
export type Order = Schemas["Order"];
export type OrderStatus = Schemas["OrderStatus"];
export type OrderPage = Schemas["OrderPage"];

// ---------------------------------------------------------------- ips
export type Ip = Schemas["Ip"];
export type IpQuote = Schemas["IpQuote"];
export type IpAddRequest = Schemas["IpAddRequest"];
export type IpAdded = Schemas["IpAdded"];
export type IpDeleted = Schemas["IpDeleted"];
export type PtrUpdate = Schemas["PtrUpdate"];
export type PtrRecord = Schemas["PtrRecord"];

// ---------------------------------------------------------------- ssh keys
export type SshKey = Schemas["SshKey"];
export type SshKeyCreate = Schemas["SshKeyCreate"];

// ---------------------------------------------------------------- domains
export type Domain = Schemas["Domain"];
export type DomainStatus = Schemas["DomainStatus"];
export type DomainPage = Schemas["DomainPage"];
export type AvailabilityResult = Schemas["AvailabilityResult"];
export type DomainRegister = Schemas["DomainRegister"];
export type DomainOrderResult = Schemas["DomainOrderResult"];
export type DomainRenew = Schemas["DomainRenew"];
export type DomainRenewResult = Schemas["DomainRenewResult"];
export type NameserversUpdate = Schemas["NameserversUpdate"];
export type DomainUpdate = Schemas["DomainUpdate"];
export type DomainTransfer = Schemas["DomainTransfer"];
// Ответ трансфера отличается от регистрации: ни периода, ни срока в нём нет —
// только состояние заявки, которая идёт у регистратора 5–7 дней.
export type DomainTransferResult = Schemas["DomainTransferResult"];

// ---------------------------------------------------------------- keys
export type ApiKey = Schemas["ApiKey"];
export type ApiKeyPage = Schemas["ApiKeyPage"];
export type ApiKeyRevoked = Schemas["ApiKeyRevoked"];

// ---------------------------------------------------------------- webhooks
export type WebhookEventType = Schemas["WebhookEventType"];
export type WebhookEventDescriptor = Schemas["WebhookEventDescriptor"];
export type WebhookSubscription = Schemas["WebhookSubscription"];
export type WebhookSubscriptionPage = Schemas["WebhookSubscriptionPage"];
export type WebhookSubscriptionWithSecret = Schemas["WebhookSubscriptionWithSecret"];
export type WebhookSubscriptionCreate = Schemas["WebhookSubscriptionCreate"];
export type WebhookSubscriptionUpdate = Schemas["WebhookSubscriptionUpdate"];
export type WebhookSecret = Schemas["WebhookSecret"];
export type WebhookDeleted = Schemas["WebhookDeleted"];
export type WebhookDelivery = Schemas["WebhookDelivery"];
export type WebhookDeliveryWithPayload = Schemas["WebhookDeliveryWithPayload"];
export type WebhookDeliveryPage = Schemas["WebhookDeliveryPage"];
export type WebhookRedelivery = Schemas["WebhookRedelivery"];
export type WebhookTestResult = Schemas["WebhookTestResult"];
export type WebhookEvent = Schemas["WebhookEvent"];
export type WebhookEventServer = Schemas["WebhookEventServer"];
export type WebhookEventInvoice = Schemas["WebhookEventInvoice"];
export type WebhookEventBalance = Schemas["WebhookEventBalance"];
export type WebhookEventDomain = Schemas["WebhookEventDomain"];
export type WebhookEventKey = Schemas["WebhookEventKey"];
export type WebhookEventPing = Schemas["WebhookEventPing"];
