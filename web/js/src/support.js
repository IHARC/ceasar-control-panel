import { initSupportSettings } from './support-settings.js';
const root = document.querySelector('[data-support-workspace]');
const $ = (selector) => root.querySelector(selector);
const state = {
	page: 1,
	tickets: [],
	selected: null,
	detailRequest: 0,
	staff: [],
	actor: null,
	outboxPage: 1,
	intakePage: 1,
};
const statusNames = {
	open: 'Open',
	waiting_staff: 'Waiting on staff',
	waiting_customer: 'Waiting on customer',
	resolved: 'Resolved',
	closed: 'Closed',
};
const titleCase = (value) => (value ? value[0].toUpperCase() + value.slice(1) : '');
const element = (tag, text, className) =>
	Object.assign(document.createElement(tag), {
		...(text !== undefined ? { textContent: text } : {}),
		...(className ? { className } : {}),
	});
const error = (message) => {
	$('[data-support-error]').hidden = !message;
	$('[data-support-error] p').textContent = message || '';
};
function headers(write = false, key) {
	return {
		Accept: 'application/json',
		...(write
			? { 'X-Ceasar-CSRF': root.dataset.csrf || '', 'Idempotency-Key': key || crypto.randomUUID() }
			: {}),
	};
}
async function supportAction(action, method = 'GET', payload, key) {
	const query = new URLSearchParams({ action, ...(method === 'GET' ? payload : {}) });
	const response = await fetch(`/api/support/v1/?${query}`, {
		method,
		credentials: 'same-origin',
		headers: {
			...headers(method !== 'GET', key),
			...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
		},
		...(method !== 'GET' ? { body: JSON.stringify(payload || {}) } : {}),
	});
	const data = await response.json();
	if (!response.ok || !data?.data)
		throw new Error(
			data?.error?.message || 'The request could not be completed. Please try again.',
		);
	return data.data;
}
async function busy(button, callback) {
	button.disabled = true;
	error('');
	try {
		await callback();
	} catch (e) {
		error(e.message);
	} finally {
		button.disabled = false;
	}
}
async function load(reset = false, requestedPage = reset ? 1 : state.page) {
	try {
		const data = await supportAction('tickets', 'GET', {
			page: requestedPage,
			perPage: 25,
			query: $('[data-support-query]').value.trim(),
			status: $('[data-support-status]').value,
			priority: $('[data-support-priority]').value,
			assigneeId: $('[data-support-assignee]').value,
			unreadOnly: $('[data-support-unread]').checked ? '1' : '',
		});
		state.tickets = reset ? data.tickets : [...state.tickets, ...data.tickets];
		state.page = data.page || requestedPage;
		$('[data-support-more]').hidden = !data.nextPage;
		$('[data-support-count]').textContent = data.total ?? state.tickets.length;
		renderTickets();
	} catch (e) {
		error(e.message);
	}
}
function renderTickets() {
	const list = $('[data-support-tickets]');
	list.replaceChildren();
	for (const ticket of state.tickets) {
		const button = element('button', undefined, 'support-ticket');
		button.type = 'button';
		button.setAttribute('aria-pressed', String(ticket.id === state.selected?.id));
		button.append(
			element('strong', ticket.subject),
			element(
				'small',
				`${ticket.unread ? 'Unread · ' : ''}${statusNames[ticket.status] || ticket.status} · ${titleCase(ticket.priority)}`,
			),
		);
		button.onclick = () => busy(button, () => detail(ticket.id));
		list.append(button);
	}
	if (!state.tickets.length)
		list.append(element('p', 'No tickets match these filters.', 'support-empty'));
}
async function detail(id) {
	const request = ++state.detailRequest;
	const selected = await supportAction('ticket', 'GET', { id });
	if (request !== state.detailRequest) return;
	state.selected = selected;
	renderDetail();
	renderTickets();
	if (matchMedia('(max-width:800px)').matches)
		$('[data-support-detail]').scrollIntoView({ behavior: 'smooth', block: 'start' });
	await supportAction('mark-read', 'POST', { id });
	if (request !== state.detailRequest) return;
	const summary = state.tickets.find((ticket) => ticket.id === id);
	if (summary) summary.unread = false;
	renderTickets();
}
function field(label, node) {
	const wrapper = element('label', label);
	wrapper.append(node);
	return wrapper;
}
function select(options, value) {
	const node = element('select');
	for (const [id, name] of options) node.append(new Option(name, id));
	node.value = value || '';
	return node;
}
function renderDetail() {
	const ticket = state.selected,
		container = $('[data-support-detail]');
	container.replaceChildren();
	if (!ticket) return;
	const heading = element('div', undefined, 'support-detail-header');
	heading.append(element('h2', ticket.subject));
	container.append(
		heading,
		element(
			'p',
			`#${ticket.id.slice(0, 8)} · ${(ticket.participants || []).map((p) => p.displayName || p.email).join(', ')}`,
			'support-meta',
		),
	);
	const staff = state.actor?.role === 'staff';
	const controls = element('div', undefined, 'support-controls');
	if (staff) {
		const status = select(Object.entries(statusNames), ticket.status);
		status.onchange = () =>
			busy(status, async () => {
				await supportAction('status', 'POST', { id: ticket.id, status: status.value });
				await detail(ticket.id);
				await load(true);
			});
		const priority = select(
			['low', 'normal', 'high', 'urgent'].map((p) => [p, titleCase(p)]),
			ticket.priority,
		);
		priority.onchange = () =>
			busy(priority, async () => {
				await supportAction('priority', 'POST', { id: ticket.id, priority: priority.value });
				await detail(ticket.id);
				await load(true);
			});
		const assignee = select(
			[['', 'Unassigned'], ...state.staff.map((p) => [p.id, p.displayName || p.email])],
			ticket.assigneeId,
		);
		assignee.onchange = () =>
			busy(assignee, async () => {
				await supportAction('assign', 'POST', {
					id: ticket.id,
					assigneeId: assignee.value || null,
				});
				await detail(ticket.id);
			});
		controls.append(
			field('Status', status),
			field('Priority', priority),
			field('Assigned to', assignee),
		);
	} else {
		controls.append(element('span', statusNames[ticket.status]));
		const close = element(
			'button',
			ticket.status === 'closed' ? 'Reopen ticket' : 'Close ticket',
			'button button-secondary',
		);
		close.type = 'button';
		close.onclick = () =>
			busy(close, async () => {
				await supportAction('status', 'POST', {
					id: ticket.id,
					status: ticket.status === 'closed' ? 'open' : 'closed',
				});
				await detail(ticket.id);
				await load(true);
			});
		controls.append(close);
	}
	container.append(controls);
	if (staff) container.append(participantControls(ticket));
	const conversation = element('div', undefined, 'support-conversation');
	renderConversation(conversation, ticket);
	container.append(conversation);
	renderComposer(container, ticket, staff);
}
function participantControls(ticket) {
	const panel = element('details', undefined, 'support-participants');
	panel.append(element('summary', 'Email participants'));
	panel.append(
		element('p', 'Participants receive public replies and can reply by email.', 'support-meta'),
	);
	for (const person of ticket.participants || []) {
		const row = element('div', undefined, 'support-participant');
		row.append(
			element(
				'span',
				`${person.displayName} · ${person.email} · ${person.role === 'staff' ? 'Support' : 'Customer'}`,
			),
		);
		if (person.role === 'customer') {
			const remove = element('button', 'Remove', 'button button-secondary');
			remove.type = 'button';
			remove.setAttribute('aria-label', `Remove ${person.displayName}`);
			remove.onclick = () =>
				busy(remove, async () => {
					await supportAction('participant-remove', 'POST', {
						id: ticket.id,
						participantId: person.id,
					});
					await detail(ticket.id);
				});
			row.append(remove);
		}
		panel.append(row);
	}
	const form = element('form', undefined, 'support-participant-form');
	const name = element('input');
	name.required = true;
	name.maxLength = 200;
	const email = element('input');
	email.type = 'email';
	email.required = true;
	const add = element('button', 'Add participant', 'button button-secondary');
	add.type = 'submit';
	form.append(field('Name', name), field('Email address', email), add);
	form.onsubmit = (event) => {
		event.preventDefault();
		busy(add, async () => {
			await supportAction('participant-add', 'POST', {
				id: ticket.id,
				displayName: name.value,
				email: email.value,
			});
			await detail(ticket.id);
		});
	};
	panel.append(form);
	return panel;
}
function renderConversation(conversation, ticket) {
	conversation.replaceChildren();
	if (ticket.nextBefore) {
		const earlier = element('button', 'Load earlier messages', 'button button-secondary');
		earlier.type = 'button';
		earlier.onclick = () =>
			busy(earlier, async () => {
				const page = await supportAction('ticket', 'GET', {
					id: ticket.id,
					before: ticket.nextBefore,
				});
				const oldHeight = conversation.scrollHeight;
				ticket.messages = [...page.messages, ...ticket.messages];
				ticket.nextBefore = page.nextBefore;
				renderConversation(conversation, ticket);
				conversation.scrollTop = conversation.scrollHeight - oldHeight;
			});
		conversation.append(earlier);
	}
	for (const message of ticket.messages || []) {
		const note = message.visibility === 'internal';
		const article = element('article', undefined, `support-message${note ? ' internal' : ''}`);
		const header = element('div', undefined, 'support-message-header');
		header.append(
			element('strong', message.author?.displayName || message.author?.email || 'Participant'),
			element(
				'span',
				note ? 'Internal note' : message.author?.role === 'staff' ? 'Support' : 'Customer',
				note ? 'support-note-label' : 'support-meta',
			),
		);
		if (message.createdAt) {
			const time = element('time', new Date(message.createdAt).toLocaleString());
			time.dateTime = message.createdAt;
			header.append(time);
		}
		article.append(header, element('p', message.body || ''));
		if (message.attachments?.length) {
			const links = element('div', undefined, 'support-attachments');
			for (const attachment of message.attachments) {
				const a = element('a', attachment.filename);
				a.href = `/api/support/v1/attachment/?attachmentId=${encodeURIComponent(attachment.id)}`;
				links.append(a);
			}
			article.append(links);
		}
		conversation.append(article);
	}
}
function renderComposer(container, ticket, staff) {
	if (ticket.status === 'closed') {
		container.append(
			element(
				'p',
				'This ticket is closed. Reopen it to continue the conversation.',
				'support-meta',
			),
		);
		return;
	}
	const form = element('form', undefined, 'support-composer');
	let requestKey = crypto.randomUUID();
	const mode = select(
		[['reply', 'Public reply'], ...(staff ? [['note', 'Internal note']] : [])],
		'reply',
	);
	mode.setAttribute('aria-label', 'Message visibility');
	const hint = element('p', 'Sent to ticket participants by email.', 'support-composer-hint');
	const top = element('div', undefined, 'support-composer-top');
	if (staff) top.append(mode, hint);
	else top.append(element('span', 'Reply', 'support-composer-hint'));
	const body = element('textarea');
	body.name = 'body';
	body.required = true;
	body.maxLength = 20000;
	body.setAttribute('aria-label', 'Message');
	const files = element('input');
	files.type = 'file';
	files.multiple = true;
	files.setAttribute('aria-label', 'Attach files');
	files.accept = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.zip';
	const send = element('button', 'Send reply', 'button');
	send.type = 'submit';
	const bottom = element('div', undefined, 'support-composer-bottom');
	bottom.append(files, send);
	form.append(top, body, bottom);
	mode.onchange = () => {
		form.classList.toggle('internal', mode.value === 'note');
		send.textContent = mode.value === 'note' ? 'Add internal note' : 'Send reply';
		hint.textContent =
			mode.value === 'note'
				? 'Visible to staff only. No customer email is sent.'
				: 'Sent to ticket participants by email.';
	};
	form.onsubmit = (event) => {
		event.preventDefault();
		busy(send, async () => {
			const updated = await supportAction(
				mode.value,
				'POST',
				{ id: ticket.id, body: body.value },
				requestKey,
			);
			const message = updated.messages.at(-1);
			for (const [index, file] of [...files.files].entries()) {
				const data = new FormData();
				data.set('action', 'attachment');
				data.set('id', ticket.id);
				data.set('messageId', message.id);
				data.set('file', file);
				const response = await fetch('/api/support/v1/attachment/', {
					method: 'POST',
					credentials: 'same-origin',
					headers: headers(true, `${requestKey}:attachment:${index}`),
					body: data,
				});
				if (!response.ok) {
					const result = await response.json();
					throw new Error(
						`Message saved. Attachment rejected: ${result?.error?.message || file.name}`,
					);
				}
			}
			await detail(ticket.id);
			await load(true);
		});
	};
	container.append(form);
}
function newTicket() {
	const container = $('[data-support-detail]');
	state.selected = null;
	renderTickets();
	container.replaceChildren(element('h2', 'New ticket'));
	const form = element('form', undefined, 'support-new-form');
	const account = select(
		(state.actor.accounts || []).map((a) => [a.accountId, a.displayName || a.accountId]),
		state.actor.accounts?.[0]?.accountId,
	);
	const subject = element('input');
	subject.required = true;
	subject.maxLength = 200;
	const body = element('textarea');
	body.required = true;
	body.maxLength = 20000;
	const submit = element('button', 'Create ticket', 'button');
	form.append(
		field('Account', account),
		field('Subject', subject),
		field('How can we help?', body),
		submit,
	);
	const key = crypto.randomUUID();
	form.onsubmit = (e) => {
		e.preventDefault();
		busy(submit, async () => {
			const ticket = await supportAction(
				'create',
				'POST',
				{ accountId: account.value, subject: subject.value, body: body.value },
				key,
			);
			await detail(ticket.id);
			await load(true);
		});
	};
	container.append(form);
}
$('[data-support-filters]').onsubmit = (e) => {
	e.preventDefault();
	load(true);
};
$('[data-support-more]').onclick = (e) =>
	busy(e.currentTarget, async () => {
		await load(false, state.page + 1);
	});
$('[data-support-new]').onclick = newTicket;
async function loadOperations() {
	try {
		const [settings, outbox, intake, rejections] = await Promise.all([
			supportAction('settings'),
			supportAction('outbox', 'GET', { page: state.outboxPage }),
			supportAction('intake', 'GET', { page: state.intakePage }),
			supportAction('attachment-rejections'),
		]);
		$('[data-support-settings]').textContent =
			`Outgoing mail: ${settings.transport?.fromEmail || 'Not configured'}. Incoming mail: ${settings.imap?.configured ? 'Mailbox configured' : 'Not configured'}.`;
		const delivery = $('[data-support-outbox]');
		delivery.replaceChildren();
		for (const item of outbox.items || []) {
			const row = element('div', undefined, 'support-message');
			row.append(
				element('strong', item.recipient),
				element('p', item.subject),
				element('p', `${titleCase(item.state)}${item.lastError ? ': ' + item.lastError : ''}`),
			);
			if (item.state === 'accepted')
				row.append(
					element(
						'p',
						'Accepted by the mail server. Delivery has not been confirmed.',
						'support-meta',
					),
				);
			if (item.state === 'uncertain')
				row.append(
					element(
						'p',
						'The mail server may have accepted this message. Retrying could send a duplicate.',
						'support-meta',
					),
				);
			if (['failed', 'retrying', 'uncertain'].includes(item.state)) {
				const retry = element('button', 'Retry delivery', 'button button-secondary');
				retry.onclick = () =>
					busy(retry, async () => {
						await supportAction('retry', 'POST', { notificationId: item.id });
						await loadOperations();
					});
				row.append(retry);
			}
			delivery.append(row);
		}
		if (!outbox.items?.length) delivery.append(element('p', 'No delivery activity.'));
		delivery.append(operationPages(outbox, 'outboxPage'));
		const pending = $('[data-support-intake]');
		pending.replaceChildren();
		for (const item of intake.items || []) {
			const row = element('article', undefined, 'support-message');
			row.append(
				element('strong', item.subject),
				element('p', item.sender),
				element('p', item.body),
			);
			if (item.error) row.append(element('p', item.error, 'support-error'));
			if (item.state === 'pending') {
				const choose = select(
					[['', 'Choose a ticket'], ...state.tickets.map((t) => [t.id, t.subject])],
					'',
				);
				choose.setAttribute('aria-label', 'Attach message to ticket');
				const attach = element('button', 'Attach to ticket', 'button button-secondary');
				attach.onclick = () =>
					busy(attach, async () => {
						if (!choose.value)
							throw new Error('Choose the ticket that should receive this message.');
						await supportAction('intake-resolve', 'POST', {
							intakeId: item.id,
							ticketId: choose.value,
						});
						await loadOperations();
						await load(true);
					});
				row.append(choose, attach);
			}
			pending.append(row);
		}
		if (!intake.items?.length) pending.append(element('p', 'No unmatched messages.'));
		pending.append(operationPages(intake, 'intakePage'));
		const rejected = $('[data-support-rejections]');
		if (rejected) {
			rejected.replaceChildren();
			for (const item of rejections.items || []) {
				const row = element('div', undefined, 'support-message');
				row.append(element('strong', item.filename), element('p', item.reason));
				const open = element('button', 'Open ticket', 'button button-secondary');
				open.onclick = () => busy(open, () => detail(item.ticketId));
				row.append(open);
				rejected.append(row);
			}
			if (!rejections.items?.length)
				rejected.append(element('p', 'No rejected email attachments.'));
		}
	} catch (e) {
		error(e.message);
	}
}
function operationPages(data, key) {
	const nav = element('div', undefined, 'support-operation-pages');
	if (state[key] > 1) {
		const previous = element('button', 'Previous', 'button button-secondary');
		previous.onclick = () =>
			busy(previous, async () => {
				state[key]--;
				await loadOperations();
			});
		nav.append(previous);
	}
	if (data.nextPage) {
		const next = element('button', 'Next', 'button button-secondary');
		next.onclick = () =>
			busy(next, async () => {
				state[key] = data.nextPage;
				await loadOperations();
			});
		nav.append(next);
	}
	return nav;
}
async function init() {
	try {
		state.actor = await supportAction('identity');
		const staff = state.actor.role === 'staff';
		root.querySelectorAll('[data-support-staff]').forEach((n) => (n.hidden = !staff));
		$('[data-support-new]').hidden = staff;
		if (staff) {
			const result = await supportAction('staff');
			state.staff = result.items || [];
			for (const person of state.staff)
				$('[data-support-assignee]').append(
					new Option(person.displayName || person.email, person.id),
				);
		}
		await load(true);
		const requestedTicket = new URLSearchParams(location.search).get('ticket');
		if (requestedTicket) await detail(requestedTicket);
		if (staff) {
			await loadOperations();
			await initSupportSettings({ request: supportAction, error });
		}
	} catch (e) {
		error(e.message);
	}
}
init();
