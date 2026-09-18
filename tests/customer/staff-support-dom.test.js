// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const ticket = {
	id: 'ticket-1',
	subject: 'Cannot publish',
	status: 'waiting_staff',
	priority: 'high',
	assigneeId: null,
	participants: [
		{ id: 'customer-1', displayName: 'Alex', email: 'alex@example.test', role: 'customer' },
	],
	messages: [
		{
			id: 'message-1',
			visibility: 'public',
			author: { displayName: 'Alex', role: 'customer' },
			body: 'Please help',
		},
		{
			id: 'message-2',
			visibility: 'internal',
			author: { displayName: 'Sam', role: 'staff' },
			body: 'Check logs first',
		},
	],
};

function response(data) {
	return new Response(JSON.stringify({ ok: true, data }), {
		headers: { 'content-type': 'application/json' },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

describe('staff support workspace', () => {
	it('does not skip a ticket page when loading more fails', async () => {
		document.body.innerHTML =
			'<main data-support-workspace data-csrf="fixture"><div data-support-error hidden><p></p></div><form data-support-filters><input data-support-query><select data-support-status><option value=""></option></select><select data-support-priority><option value=""></option></select><select data-support-assignee><option value=""></option></select><input data-support-unread type="checkbox"></form><button data-support-search></button><button data-support-new></button><div data-support-staff></div><span data-support-count></span><div data-support-tickets></div><button data-support-more hidden></button><section data-support-detail></section><p data-support-settings></p><div data-support-settings-editor></div><div data-support-outbox></div><div data-support-intake></div></main>';
		let pageTwoCalls = 0;
		const fetcher = vi.fn((url) => {
			const value = String(url);
			if (value.includes('action=identity'))
				return response({ userId: 'customer-1', role: 'customer', accounts: [] });
			if (value.includes('page=2')) {
				pageTwoCalls += 1;
				if (pageTwoCalls === 1) return Promise.reject(new Error('temporary failure'));
				return response({
					tickets: [{ ...ticket, id: 'ticket-2', subject: 'Second page' }],
					page: 2,
					total: 2,
					nextPage: null,
				});
			}
			return response({ tickets: [ticket], page: 1, total: 2, nextPage: 2 });
		});
		vi.stubGlobal('fetch', fetcher);
		vi.resetModules();
		await import('../../web/js/src/support.js');
		await vi.waitFor(() =>
			expect(document.querySelector('[data-support-more]').hidden).toBe(false),
		);
		document.querySelector('[data-support-more]').click();
		await vi.waitFor(() => expect(pageTwoCalls).toBe(1));
		await vi.waitFor(() =>
			expect(document.querySelector('[data-support-more]').disabled).toBe(false),
		);
		document.querySelector('[data-support-more]').click();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-support-tickets]').textContent).toContain('Second page'),
		);
		expect(pageTwoCalls).toBe(2);
		expect(fetcher.mock.calls.some(([url]) => String(url).includes('page=3'))).toBe(false);
	});

	it('filters cases and exposes accurate participants, notes, assignment, priority, and status actions', async () => {
		document.body.innerHTML =
			'<main data-support-workspace data-csrf="fixture"><div data-support-error hidden><p></p></div><form data-support-filters><input data-support-query><select data-support-status><option value=""></option><option value="open">Open</option></select><select data-support-priority><option value=""></option><option value="high">High</option></select><select data-support-assignee><option value=""></option></select><input data-support-unread type="checkbox"></form><button data-support-search></button><button data-support-new></button><div data-support-staff></div><span data-support-count></span><div data-support-tickets></div><button data-support-more hidden></button><section data-support-detail></section><p data-support-settings></p><div data-support-settings-editor></div><div data-support-outbox></div><div data-support-intake></div></main>';
		const fetcher = vi.fn((url) => {
			if (String(url).includes('action=identity'))
				return response({ userId: 'staff-1', role: 'staff', accounts: [] });
			if (String(url).includes('action=staff'))
				return response({ items: [{ id: 'staff-1', displayName: 'Sam' }] });
			if (String(url).includes('action=settings'))
				return response({
					transport: { configured: true, fromEmail: 'support@example.test' },
					imap: { configured: true, host: 'imap.example.test' },
				});
			if (String(url).includes('action=outbox'))
				return response({
					items: [
						{
							id: 'mail-1',
							recipient: 'alex@example.test',
							state: 'failed',
							lastError: 'SMTP rejected',
						},
					],
				});
			if (String(url).includes('action=intake'))
				return response({
					items: [
						{
							id: 'intake-1',
							sender: 'unknown@example.test',
							subject: 'Help',
							body: 'Please reply',
						},
					],
				});
			if (String(url).includes('id=ticket-1')) return response(ticket);
			if (/(action=status|action=note|action=assign|action=priority)/.test(String(url)))
				return response(ticket);
			return response({ tickets: [ticket], total: 1, page: 1, perPage: 25, nextPage: null });
		});
		vi.stubGlobal('fetch', fetcher);
		vi.resetModules();
		await import('../../web/js/src/support.js');
		await vi.waitFor(() =>
			expect(document.querySelector('[data-support-tickets]').textContent).toContain(
				'Cannot publish',
			),
		);
		document.querySelector('.support-ticket').click();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-support-detail]').textContent).toContain(
				'Internal note',
			),
		);
		const detail = document.querySelector('[data-support-detail]').textContent;
		expect(detail).toContain('Alex');
		expect(detail).toContain('Check logs first');
		expect(detail).toContain('Assigned to');
		expect(detail).toContain('Resolved');

		const status = document.querySelector('[data-support-detail] select');
		status.value = 'resolved';
		status.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() =>
			expect(
				fetcher.mock.calls.find(
					([url, options]) => String(url).includes('action=status') && options.method === 'POST',
				),
			).toBeTruthy(),
		);
		const statusCall = fetcher.mock.calls.find(
			([url, options]) => String(url).includes('action=status') && options.method === 'POST',
		);
		expect(statusCall[1].headers).toMatchObject({
			'X-Ceasar-CSRF': 'fixture',
			'Idempotency-Key': expect.any(String),
		});

		const mode = document.querySelector('[aria-label="Message visibility"]');
		mode.value = 'note';
		mode.dispatchEvent(new Event('change', { bubbles: true }));
		document.querySelector('[aria-label="Message"]').value = 'Private follow-up';
		document
			.querySelector('.support-composer')
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await vi.waitFor(() =>
			expect(
				fetcher.mock.calls.find(
					([url, options]) => String(url).includes('action=note') && options.method === 'POST',
				),
			).toBeTruthy(),
		);
		const noteCall = fetcher.mock.calls.find(
			([url, options]) => String(url).includes('action=note') && options.method === 'POST',
		);
		expect(JSON.parse(noteCall[1].body)).toEqual({ id: 'ticket-1', body: 'Private follow-up' });
		expect(noteCall[1].headers['X-Ceasar-CSRF']).toBe('fixture');
	});
});
