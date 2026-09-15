import type { Invoice, PayInvoiceResult, PaymentLink, PaymentLinkRequest, QueryOf } from "../api.js";
import type { RequestOptions, Transport } from "../client.js";
import { attachMeta, type WithMeta } from "../meta.js";
import type { Page } from "../pagination.js";

export type InvoiceListParams = QueryOf<"list_invoices">;

export interface InvoicePdf {
  /** Raw PDF bytes. */
  data: Uint8Array;
  contentType: string;
  /** From `Content-Disposition`, e.g. `invoice-10231.pdf`; null when absent. */
  filename: string | null;
}

/** `GET /invoices`, `GET /invoices/{id}`, `/pdf`, `/pay`, `/payment-link`. */
export class InvoicesResource {
  constructor(private readonly t: Transport) {}

  /** Invoices, newest first (`invoices:read`). */
  list(params: InvoiceListParams = {}, options?: RequestOptions): Promise<Page<Invoice>> {
    return this.t.page<Invoice>({ method: "GET", path: "/invoices", query: { ...params }, ...options });
  }

  /** One invoice with line items (`invoices:read`). */
  get(invoiceId: number, options?: RequestOptions): Promise<WithMeta<Invoice>> {
    return this.t.json<Invoice>({ method: "GET", path: `/invoices/${invoiceId}`, ...options });
  }

  /** Invoice as PDF (`invoices:read`, expensive bucket). */
  async pdf(invoiceId: number, options?: RequestOptions): Promise<WithMeta<InvoicePdf>> {
    const { data, meta } = await this.t.request<Uint8Array>({
      method: "GET",
      path: `/invoices/${invoiceId}/pdf`,
      accept: "application/pdf",
      ...options,
    });
    const disposition = meta.headers.get("content-disposition") ?? "";
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    return attachMeta<InvoicePdf>(
      {
        data: data instanceof Uint8Array ? data : new Uint8Array(),
        contentType: meta.headers.get("content-type") ?? "application/pdf",
        filename: m?.[1] ? decodeURIComponent(m[1]) : null,
      },
      meta,
    );
  }

  /**
   * Pay an unpaid invoice from balance (`invoices:pay`). Idempotent.
   * `status: "provisioning"` (HTTP 202) means the ordered server is still being
   * created — poll `servers.orders.get(invoiceId)`.
   */
  pay(invoiceId: number, options?: RequestOptions): Promise<WithMeta<PayInvoiceResult>> {
    return this.t.json<PayInvoiceResult>({ method: "POST", path: `/invoices/${invoiceId}/pay`, idempotent: true, ...options });
  }

  /** Gateway payment link for an unpaid invoice (`invoices:pay`). */
  paymentLink(invoiceId: number, body: PaymentLinkRequest = {}, options?: RequestOptions): Promise<WithMeta<PaymentLink>> {
    return this.t.json<PaymentLink>({ method: "POST", path: `/invoices/${invoiceId}/payment-link`, body, ...options });
  }
}
