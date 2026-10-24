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
    async requestTrialAdmission({ accountId, planCode, siteType, intent, idempotencyKey }) {
      const result = await this.#request("POST", "/admissions/trial", {
        accountId,
        planCode,
        siteType,
        intent,
        idempotencyKey
      });
      return result.checkoutUrl ? { ...result, checkoutUrl: this.#hostedUrl(result.checkoutUrl) } : result;
    }
    readOnboarding(accountId) {
      return this.#request("GET", `/accounts/${pathId(accountId)}/onboarding`);
    }
    saveOnboarding(accountId, draft) {
      return this.#request("PUT", `/accounts/${pathId(accountId)}/onboarding`, { draft });
    }
    serviceOnboarding(_accountId, serviceId) {
      return this.#request("GET", `/services/${pathId(serviceId)}/onboarding`);
    }
    hostingAccess(accountId, serviceId) {
      return this.#request("POST", `/services/${pathId(serviceId)}/hosting-access`, { accountId });
    }
    wordpressAccess(accountId, serviceId, userId = "") {
      return this.#request("POST", `/services/${pathId(serviceId)}/wordpress-access`, {
        accountId,
        ...userId ? { userId } : {}
      });
    }
    domainStatus(_accountId, serviceId, domain2 = "") {
      const query = domain2 ? `?domain=${encodeURIComponent(domain2)}` : "";
      return this.#request("GET", `/services/${pathId(serviceId)}/domain${query}`);
    }
    connectDomain(accountId, serviceId, domain2, idempotencyKey) {
      return this.#request("POST", `/services/${pathId(serviceId)}/domain`, {
        accountId,
        domain: domain2,
        idempotencyKey
      });
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
        ...workspaceReadyOperationId ? { workspaceReadyOperationId } : {},
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
      return bounded(12e4, async (signal) => {
        const session = await this.identity.session();
        if (signal.aborted) throw new Error("The request timed out. Refresh and try again.");
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
            redirect: "error",
            signal
          });
          const body = await response.json();
          if (!response.ok || !body?.data) throw new Error(customerErrorMessage(body?.error));
        }
      });
    }
    async downloadSupportAttachment(attachment) {
      return bounded(6e4, async (signal) => {
        const session = await this.identity.session();
        if (signal.aborted) throw new Error("The request timed out. Refresh and try again.");
        if (!session?.access_token) throw new Error("Sign in to continue.");
        const response = await this.fetch(
          `${this.supportApiBase}/attachment/?attachmentId=${encodeURIComponent(attachment.id)}`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
            redirect: "error",
            signal
          }
        );
        if (!response.ok) throw new Error("This attachment could not be downloaded.");
        return response.blob();
      });
    }
    #hostedUrl(value) {
      const destination = new URL(value);
      if (destination.protocol !== "https:") {
        throw new Error("Billing provider returned an invalid hosted URL.");
      }
      return destination.toString();
    }
    async #request(method, path, payload) {
      return bounded(6e4, async (signal) => {
        const session = await this.identity.session();
        if (signal.aborted) throw new Error("The request timed out. Refresh and try again.");
        if (!session?.access_token) throw new Error("Sign in to continue.");
        const options = {
          method,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          redirect: "error",
          signal
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
      });
    }
    async #supportRequest(method, path, payload) {
      return bounded(6e4, async (signal) => {
        const session = await this.identity.session();
        if (signal.aborted) throw new Error("The request timed out. Refresh and try again.");
        if (!session?.access_token) throw new Error("Sign in to continue.");
        const options = {
          method,
          headers: { Accept: "application/json", Authorization: `Bearer ${session.access_token}` },
          redirect: "error",
          signal
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
      });
    }
  };
  function bounded(milliseconds, action) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("The request timed out. Refresh and try again."));
      }, milliseconds);
    });
    return Promise.race([Promise.resolve().then(() => action(controller.signal)), deadline]).catch((error) => {
      if (controller.signal.aborted)
        throw new Error("The request timed out. Refresh and try again.");
      throw error;
    }).finally(() => clearTimeout(timer));
  }
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
  var key = "ceasar:customer-preview";
  var parameters = new URLSearchParams(location.search);
  var state;
  try {
    state = JSON.parse(sessionStorage.getItem(key) || "{}");
  } catch {
    state = {};
  }
  if (parameters.has("previewReset")) state = {};
  if (parameters.has("previewNew")) state.mode = "new";
  if (parameters.has("previewReset") || parameters.has("previewNew")) {
    const url = new URL(location.href);
    url.searchParams.delete("previewReset");
    url.searchParams.delete("previewNew");
    history.replaceState(history.state, "", url);
  }
  state ||= {};
  state.account ||= state.mode === "new" ? null : { accountId: "account-1", displayName: "Example Studio" };
  state.signedIn ??= state.mode !== "new";
  state.draft ||= null;
  state.setups ||= [];
  state.services ||= [];
  state.progressReads ||= 0;
  function save() {
    sessionStorage.setItem(key, JSON.stringify(state));
  }
  save();
  if (parameters.has("previewCaptcha")) {
    const widgets = /* @__PURE__ */ new Map();
    globalThis.turnstile = {
      render(mount, options) {
        const id = `fixture-turnstile-${widgets.size + 1}`;
        const label = document.createElement("label");
        const check = document.createElement("input");
        check.type = "checkbox";
        check.addEventListener("change", () => {
          if (check.checked) options.callback(`fixture-token-${id}`);
        });
        label.append(check, document.createTextNode(" Complete the preview security check"));
        const expire = document.createElement("button");
        expire.type = "button";
        expire.textContent = "Expire preview challenge";
        expire.addEventListener("click", () => options["expired-callback"]());
        mount.append(label, expire);
        widgets.set(id, check);
        return id;
      },
      reset(id) {
        const check = widgets.get(id);
        if (check) check.checked = false;
      }
    };
  }
  var identity = {
    async session() {
      return state.signedIn ? { access_token: "fixture-customer-token" } : null;
    },
    async user() {
      return {
        id: "customer-1",
        email: "customer@example.test",
        user_metadata: { display_name: state.accountName || "" }
      };
    },
    async signIn() {
      if (state.pendingConfirmation)
        throw new Error("Use the preview email confirmation link first.");
      state.signedIn = true;
      save();
      return { access_token: "fixture-customer-token" };
    },
    async signUp(_email, _password, _accepted, _callback, _captcha, accountName) {
      state.mode = "new";
      state.account = null;
      state.accountName = accountName;
      state.signedIn = false;
      state.pendingConfirmation = true;
      save();
      return { id: "customer-1" };
    },
    async exchangeConfirmation() {
      state.pendingConfirmation = false;
      state.signedIn = true;
      save();
      return { access_token: "fixture-customer-token" };
    },
    async requestRecovery() {
    },
    async signOut() {
      state.signedIn = false;
      save();
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
  var capabilities = {
    trialDays: 7,
    setupMethods: {
      "wordpress-new": { trial: true, paid: true },
      "wordpress-move": { trial: true, paid: true },
      "php-import": { trial: false, paid: true },
      "php-static": { trial: true, paid: true }
    }
  };
  function offer() {
    const full = new URLSearchParams(location.search).get("previewCap") === "full";
    return {
      planCode: "starter",
      displayName: "Starter",
      monthlyPriceCadCents: 1295,
      currency: "CAD",
      websiteLimit: 1,
      storageBytes: 5368709120,
      transferBytes: 10737418240,
      trialAvailable: !full,
      paidAvailable: true
    };
  }
  function offers() {
    return [
      offer(),
      {
        ...offer(),
        planCode: "plus",
        displayName: "Plus",
        monthlyPriceCadCents: 2495,
        storageBytes: 10737418240
      }
    ];
  }
  function account() {
    return state.account;
  }
  function service(serviceId) {
    return state.services.find((item) => item.serviceId === serviceId);
  }
  function progress(serviceId) {
    const selected = state.services.find((service2) => service2.serviceId === serviceId) || state.services[0];
    if (!selected)
      return { status: "queued", stage: "allocation", message: "Waiting for a hosting request." };
    selected.progressReads = (selected.progressReads || 0) + 1;
    const migration = selected.intent === "migration";
    const ready = selected.progressReads >= 2;
    if (ready) {
      selected.status = migration && !state.migrationVerified ? "import_ready" : "active";
      state.setups = state.setups.map(
        (row) => row.serviceId === selected.serviceId ? { ...row, status: selected.status } : row
      );
    }
    save();
    return {
      status: !ready ? "running" : migration && !state.migrationVerified ? "needs_action" : "ready",
      stage: !ready ? "installing" : migration && !state.migrationVerified ? "transfer" : migration ? "verified" : "ready",
      message: !ready ? "Preparing the website workspace." : migration && !state.migrationVerified ? "Destination is ready. Transfer through WPvivid or upload your PHP files." : "The website is ready.",
      nextAction: !ready ? "Refresh progress" : migration && !state.migrationVerified ? "Complete and verify the import." : "Preview and connect a domain.",
      operationId: "fixture-operation-1",
      serviceId: selected.serviceId,
      previewUrl: "https://preview.example.test/",
      siteType: selected.siteType,
      intent: selected.intent
    };
  }
  function domain(domain2, connected = false) {
    return {
      status: connected ? "connected" : "awaiting_dns",
      dnsReady: connected,
      ownershipReady: connected,
      wwwReady: connected,
      certificateReady: connected,
      certificateStatus: connected ? "ready" : "pending",
      message: connected ? "Domain connected over HTTPS." : "Add these web records and keep your existing mail records.",
      records: [
        { type: "A", name: domain2, value: "192.0.2.24" },
        { type: "CNAME", name: `www.${domain2}`, value: domain2 },
        { type: "TXT", name: `_ceasar-verification.${domain2}`, value: "ceasar=fixture-domain-proof" }
      ]
    };
  }
  Object.assign(backend, {
    async sessionState() {
      return {
        identity: {
          userId: "customer-1",
          email: "customer@example.test",
          displayName: "Alex Morgan"
        },
        accounts: account() ? [account()] : [],
        selectedAccountId: account()?.accountId || null
      };
    },
    async accountState() {
      const selectedOffer = offer();
      return {
        services: state.services,
        setups: state.setups,
        billing: [],
        trialEligibility: selectedOffer.trialAvailable ? { status: "eligible", canStartTrial: true, reason: "trial_available" } : { status: "unavailable", canStartTrial: false, reason: "trial_capacity_full" },
        offers: offers()
      };
    },
    async createAccount(displayName) {
      state.account = { accountId: "account-1", displayName };
      save();
      return state.account;
    },
    async readOnboarding() {
      return { draft: state.draft, capabilities };
    },
    async saveOnboarding(_accountId, draft) {
      state.draft = { ...draft };
      save();
      return { draft: state.draft, capabilities };
    },
    async requestTrialAdmission(input) {
      return admission(input, "trial");
    },
    async requestPaidAdmission(input) {
      return admission(input, "paid");
    },
    async serviceOnboarding(_accountId, serviceId) {
      return progress(serviceId);
    },
    async serviceState(serviceId) {
      return { service: service(serviceId) };
    },
    async hostingAccess() {
      return {
        actionUrl: `${location.origin}/onboarding/access/`,
        token: "fixture-single-use-grant",
        expiresAt: new Date(Date.now() + 6e4).toISOString()
      };
    },
    async wordpressAccess() {
      return { url: "https://preview.example.test/wp-admin/", method: "single_use" };
    },
    async confirmMigration() {
      state.migrationVerified = true;
      save();
      return progress();
    },
    async domainStatus(_accountId, _serviceId, name) {
      return domain(name, state.domain === name);
    },
    async connectDomain(_accountId, _serviceId, name) {
      state.domain = name;
      save();
      return domain(name, true);
    },
    async supportCases() {
      return { cases: [], page: 1, totalPages: 1 };
    }
  });
  function admission(input, mode) {
    const existing = state.setups.find((setup) => setup.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    if (mode === "trial" && !offer().trialAvailable)
      throw new Error("Trial capacity is full. Review monthly hosting.");
    if (mode === "trial" && input.intent === "migration" && input.siteType === "php")
      throw new Error("PHP import uses monthly hosting.");
    const requestId = `fixture-${state.setups.length + 1}`;
    const serviceId = `service-${state.services.length + 1}`;
    const item = {
      idempotencyKey: input.idempotencyKey,
      requestId,
      serviceId,
      planCode: input.planCode,
      status: "preparing",
      kind: mode,
      hostname: "preview.example.test"
    };
    state.setups.unshift(item);
    state.services.unshift({
      serviceId,
      hostname: "preview.example.test",
      planCode: input.planCode,
      status: "preparing",
      intent: input.intent,
      siteType: input.siteType
    });
    state.progressReads = 0;
    state.migrationVerified = false;
    save();
    return item;
  }
  window.__CEASAR_CUSTOMER_PREVIEW__ = { identity, backend };
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-preview-confirm]")) return;
    event.preventDefault();
    const parameters2 = new URLSearchParams(location.search);
    for (const flag of ["previewReset", "previewNew", "previewCaptcha", "customer"]) {
      parameters2.delete(flag);
    }
    location.assign(`/customer-preview-callback?code=preview-code&${parameters2}`);
  });
})();
