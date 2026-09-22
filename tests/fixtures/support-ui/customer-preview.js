(() => {
  // web/js/src/customer/providers.js
  var CustomerBusinessBackend = class {
    constructor(identity2, apiBase, fetchImplementation = (...arguments_) => globalThis.fetch(...arguments_)) {
      this.identity = identity2;
      this.apiBase = customerApiBase(apiBase);
      this.fetch = fetchImplementation;
      this.supportApiBase = "/api/support/v1";
    }
    sessionState() {
      return this.#request("GET", "/session");
    }
    accountState(accountId) {
      return this.#request("GET", `/accounts/${pathId(accountId)}/state`);
    }
    serviceState(serviceId) {
      return this.#request("GET", `/services/${pathId(serviceId)}/state`);
    }
    async setupCheckout(accountId, requestId) {
      const result = await this.#request(
        "GET",
        `/accounts/${pathId(accountId)}/setups/${pathId(requestId)}/checkout`
      );
      return { ...result, checkoutUrl: this.#hostedUrl(result.checkoutUrl) };
    }
    supportCase(caseId, { before = "" } = {}) {
      const query = new URLSearchParams({ id: caseId });
      if (before) query.set("before", before);
      return this.#supportRequest("GET", `/tickets/?${query}`).then((ticket) => ({
        supportCase: supportTicket(ticket),
        messages: (ticket.messages || []).filter((message) => message.visibility !== "internal").map(supportMessage)
      }));
    }
    supportCases(options = {}) {
      const { page = 1, search = "" } = typeof options === "object" && options ? options : {};
      const query = new URLSearchParams();
      query.set("page", String(page));
      query.set("perPage", "25");
      if (search) query.set("query", search);
      const suffix = query.size ? `?${query}` : "";
      return this.#supportRequest("GET", `/tickets/${suffix}`).then((result) => {
        const { tickets, items, ...page2 } = result;
        return { ...page2, cases: (tickets || items || []).map(supportTicket) };
      });
    }
    createAccount(displayName, idempotencyKey) {
      return this.#request("POST", "/accounts", { displayName, idempotencyKey });
    }
    async requestTrialAdmission({ accountId, planCode, siteType, idempotencyKey }) {
      const result = await this.#request("POST", "/admissions/trial", {
        accountId,
        planCode,
        siteType,
        idempotencyKey
      });
      return result.checkoutUrl ? { ...result, checkoutUrl: this.#hostedUrl(result.checkoutUrl) } : result;
    }
    async requestPaidAdmission({ accountId, planCode, intent, siteType, idempotencyKey }) {
      const result = await this.#request("POST", "/billing/checkout-sessions", {
        accountId,
        planCode,
        intent,
        siteType,
        idempotencyKey
      });
      return result.checkoutUrl ? { ...result, checkoutUrl: this.#hostedUrl(result.checkoutUrl) } : result;
    }
    updateAnalyticsAttribution(accountId, attribution) {
      return this.#request(
        "POST",
        `/accounts/${pathId(accountId)}/analytics-attribution`,
        attribution
      );
    }
    confirmMigration(serviceId, { accountId, workspaceReadyOperationId, idempotencyKey }) {
      return this.#request("POST", `/migrations/${pathId(serviceId)}/confirm`, {
        accountId,
        workspaceReadyOperationId,
        customerAttestsImportComplete: true,
        idempotencyKey
      });
    }
    async billingPortal(accountId) {
      const result = await this.#request("POST", "/billing/portal-sessions", { accountId });
      return this.#hostedUrl(result.portalUrl || result.url);
    }
    openSupportCase({ accountId, subject, message, idempotencyKey }) {
      return this.#supportRequest("POST", "/tickets/", {
        action: "create",
        accountId,
        subject,
        body: message,
        idempotencyKey
      });
    }
    replyToSupportCase(caseId, message, idempotencyKey) {
      return this.#supportRequest("POST", "/tickets/", {
        action: "reply",
        id: caseId,
        body: message,
        idempotencyKey
      });
    }
    closeSupportCase(caseId, idempotencyKey) {
      return this.#supportRequest("POST", "/tickets/", {
        action: "status",
        id: caseId,
        status: "closed",
        idempotencyKey
      });
    }
    reopenSupportCase(caseId, idempotencyKey) {
      return this.#supportRequest("POST", "/tickets/", {
        action: "status",
        id: caseId,
        status: "open",
        idempotencyKey
      });
    }
    async uploadSupportAttachments(caseId, messageId, attachments, idempotencyKey = "") {
      const session = await this.identity.session();
      if (!session?.access_token) throw new Error("Sign in to continue.");
      for (const [index, file] of attachments.entries()) {
        const requestId = idempotencyKey ? `${idempotencyKey}:attachment:${index}` : crypto.randomUUID();
        const form = new FormData();
        form.set("action", "attachment");
        form.set("id", caseId);
        form.set("messageId", messageId);
        form.set("file", file);
        const response = await this.fetch(`${this.supportApiBase}/attachment/`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${session.access_token}`,
            "Idempotency-Key": requestId
          },
          body: form,
          redirect: "error"
        });
        const body = await response.json();
        if (!response.ok || !body?.data) throw new Error(customerErrorMessage(body?.error));
      }
    }
    async downloadSupportAttachment(attachment) {
      const session = await this.identity.session();
      if (!session?.access_token) throw new Error("Sign in to continue.");
      const response = await this.fetch(
        `${this.supportApiBase}/attachment/?attachmentId=${encodeURIComponent(attachment.id)}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          redirect: "error"
        }
      );
      if (!response.ok) throw new Error("This attachment could not be downloaded.");
      return response.blob();
    }
    #hostedUrl(value) {
      const destination = new URL(value);
      if (destination.protocol !== "https:") {
        throw new Error("Billing provider returned an invalid hosted URL.");
      }
      return destination.toString();
    }
    async #request(method, path, payload) {
      const session = await this.identity.session();
      if (!session?.access_token) throw new Error("Sign in to continue.");
      const options = {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        redirect: "error"
      };
      if (payload !== void 0) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(payload);
      }
      const response = await this.fetch(`${this.apiBase}${path}`, options);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Customer backend returned an invalid response.");
      }
      const body = await response.json();
      if (!response.ok) {
        throw new Error(customerErrorMessage(body?.error));
      }
      if (!Object.hasOwn(body, "data")) {
        throw new Error("Customer backend returned an invalid response.");
      }
      return body.data;
    }
    async #supportRequest(method, path, payload) {
      const session = await this.identity.session();
      if (!session?.access_token) throw new Error("Sign in to continue.");
      const options = {
        method,
        headers: { Accept: "application/json", Authorization: `Bearer ${session.access_token}` },
        redirect: "error"
      };
      if (payload !== void 0) {
        const requestId = payload.idempotencyKey;
        options.headers["Content-Type"] = "application/json";
        if (requestId) options.headers["Idempotency-Key"] = requestId;
        options.body = JSON.stringify({
          ...payload,
          ...requestId ? { requestId } : {}
        });
      }
      const response = await this.fetch(`${this.supportApiBase}${path}`, options);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json"))
        throw new Error("Support service returned an invalid response.");
      const body = await response.json();
      if (!response.ok) throw new Error(customerErrorMessage(body?.error));
      if (!Object.hasOwn(body, "data"))
        throw new Error("Support service returned an invalid response.");
      return body.data;
    }
  };
  function supportTicket(ticket) {
    return {
      ...ticket,
      caseId: ticket.id,
      permittedActions: ticket.permissions || {}
    };
  }
  function supportMessage(message) {
    return {
      ...message,
      message: message.body || "",
      createdAt: message.createdAt,
      authorName: message.author?.displayName || message.author?.email || "",
      authorRole: message.author?.role || "",
      attachments: message.attachments || []
    };
  }
  function customerApiBase(value) {
    if (typeof value !== "string" || value.length > 200 || !/^\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@/-]*\/?$/.test(value)) {
      throw new Error("Customer backend path is invalid.");
    }
    const normalized = value.replace(/\/$/, "");
    const segments = normalized.slice(1).split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("Customer backend path is invalid.");
    }
    return normalized;
  }
  function pathId(value) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!id || id.length > 200) throw new Error("A valid record ID is required.");
    return encodeURIComponent(id);
  }
  function customerErrorMessage(error) {
    const code = typeof error === "object" && error ? error.code : error;
    if (code === "authentication_required") return "Sign in to continue.";
    if (code === "account_context_forbidden") return "Choose an account you can access.";
    if (code === "trial_ineligible") return "A trial is not available for this account.";
    if (code === "setup_not_found") return "That hosting setup is no longer available.";
    if (code === "idempotency_conflict")
      return "This setup is already in progress. Refresh its status before trying again.";
    if (code === "upstream_rejected")
      return "That request could not be completed. Review the details and try again.";
    return "The request could not be completed. Please try again.";
  }

  // tests/fixtures/support-ui/customer-preview-entry.js
  var identity = {
    async session() {
      return { access_token: "fixture-customer-token" };
    },
    async user() {
      return { id: "customer-1", email: "customer@example.test" };
    },
    async signOut() {
    },
    async listPasskeys() {
      return [];
    },
    async updateProfile() {
    },
    async updateEmail() {
    },
    async updatePassword() {
    },
    async registerPasskey() {
    },
    async deletePasskey() {
    }
  };
  var backend = new CustomerBusinessBackend(identity, "/fixture/customer-api");
  Object.assign(backend, {
    async sessionState() {
      return {
        identity: {
          userId: "customer-1",
          email: "customer@example.test",
          displayName: "Alex Morgan"
        },
        accounts: [{ accountId: "account-1", displayName: "Example Studio" }],
        selectedAccountId: "account-1"
      };
    },
    async accountState() {
      const trialAvailable = new URLSearchParams(location.search).get("previewCap") !== "full";
      return {
        services: [],
        setups: [],
        billing: [],
        trialEligibility: trialAvailable ? { status: "eligible", canStartTrial: true, reason: "trial_available" } : { status: "unavailable", canStartTrial: false, reason: "trial_capacity_full" },
        offers: [{
          planCode: "starter",
          displayName: "Starter",
          monthlyPriceCadCents: 1295,
          websiteLimit: 1,
          storageBytes: 5368709120,
          transferBytes: 10737418240,
          trialAvailable,
          paidAvailable: true
        }]
      };
    }
  });
  if (new URLSearchParams(location.search).has("previewEmptySupport")) {
    backend.supportCases = async () => ({ cases: [], page: 1, totalPages: 1 });
  }
  window.__CEASAR_CUSTOMER_PREVIEW__ = { identity, backend };
})();
